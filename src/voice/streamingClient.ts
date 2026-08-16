// WebSocket client for soul's /transcribe-stream endpoint.
//
// Owns:
//   * a 16 kHz mono AudioContext + voice-capture worklet
//   * a WebSocket to soul that pushes Float32 PCM frames as binary,
//     and receives JSON {partial, final, error} messages
//   * the local "committed / tentative" string state
//
// Two operational modes (set on start()):
//   * 'push'      , caller controls stop. We never auto-finalize.
//   * 'continuous', caller (the VAD endpointer in useVoiceAgent)
//                    decides when to call finalize(). Same code path
//                    as 'push', the mode is just a hint to the server
//                    for logging.
//
// External React state lives in useStreamingTranscriber; this file is
// a plain TypeScript class with an event emitter so the React layer
// stays thin.

import { getSoulBaseUrl } from '../services/soulBase';

// Derive ws:// from soul's live HTTP base. URL.parse + protocol swap
// is overkill; the host:port is loopback-only and predictable.
function soulWsUrl(): string {
  return getSoulBaseUrl().replace(/^http/, 'ws') + '/transcribe-stream';
}
const SAMPLE_RATE = 16_000;
// RELATIVE path (`./`), not absolute (`/`). See vadEngine.ts for the
// same Electron file:// trap.
const WORKLET_URL = './voice-worklet.js';

export type StreamingMode = 'push' | 'continuous';

export type StreamingEvent =
  | { kind: 'partial'; committed: string; tentative: string }
  | { kind: 'final'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'started' }
  | { kind: 'stopped' }
  /** RMS [0, 1] of the latest mic frame. Fired from BOTH the
   *  own-mic path (worklet message handler) and the feed path
   *  (every pushFrame call). Throttled to ~60 Hz so React state
   *  updates aren't shoved 31x/sec on top of every other tick. */
  | { kind: 'level'; value: number };

export type StreamingListener = (ev: StreamingEvent) => void;

interface ServerMessage {
  type: 'partial' | 'final' | 'error';
  committed?: string;
  tentative?: string;
  text?: string;
  message?: string;
}

interface WorkletFrameMessage {
  kind: 'frame';
  id: number;
  samples: Float32Array;
}

/** One persistent streaming session. Construct once, call start/stop
 *  /finalize as the user enters and leaves voice mode. */
export class StreamingTranscriber {
  private listeners = new Set<StreamingListener>();
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private wsOpenPromise: Promise<void> | null = null;
  private active = false;
  /** Resolved by the next 'final' message after a finalize() call.
   *  Stays null when no finalize is pending. */
  private finalResolver: ((text: string) => void) | null = null;
  private finalRejecter: ((err: Error) => void) | null = null;

  /** Last timestamp we emitted a 'level' event. Throttle target ~60 Hz
   *  is overkill for a UI cursor but cheap and keeps the visualization
   *  feeling truly live. The mic worklet fires ~31 Hz natively so this
   *  effectively passes everything through unfiltered. */
  private lastLevelEmitMs = 0;
  /** EMA-smoothed RMS so the visualizer doesn't strobe between frames. */
  private smoothedRms = 0;

  // --- Sample-rate safety net -----------------------------------------
  // We create the AudioContext at 16 kHz (what Moonshine/Whisper expect),
  // but some platforms IGNORE that hint and hand back a native-rate context
  // (48 kHz is common, and this Mac's UnclawSilentSink Core Audio driver can
  // force it). If we then ship those frames untouched, soul labels them as
  // 16 kHz and the model hears everything ~3x too fast → total gibberish.
  // So we resample to 16 kHz on the fly whenever the context isn't already
  // 16 kHz. Continuous linear resampler: `_rsPos` carries the fractional read
  // position across frames and `_rsPrev` holds the previous frame's last
  // sample for interpolation across the boundary.
  private _rsNeed = false;
  private _rsStep = 1;      // input samples consumed per 16 kHz output sample
  private _rsPos = 0;       // fractional read index into the current frame
  private _rsPrev = 0;      // last sample of the previous frame

  private resampleTo16k(frame: Float32Array): Float32Array {
    const step = this._rsStep;
    const n = frame.length;
    // Upper bound on output length; trim at the end.
    const out = new Float32Array(Math.ceil((n - this._rsPos) / step) + 1);
    let k = 0;
    let pos = this._rsPos;
    while (pos < n) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = i < 0 ? this._rsPrev : frame[i];
      const j = i + 1;
      const b = j < 0 ? this._rsPrev : (j < n ? frame[j] : frame[n - 1]);
      out[k++] = a + (b - a) * frac;
      pos += step;
    }
    this._rsPos = pos - n;          // carry remainder into next frame
    this._rsPrev = frame[n - 1];
    return out.subarray(0, k);
  }

  on(listener: StreamingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isActive(): boolean {
    return this.active;
  }

  /** Open a streaming session WITHOUT taking the mic. The caller
   *  feeds audio in via `pushFrame()`. Used by VoiceController
   *  in continuous mode so a single mic + worklet drives both VAD
   *  and Moonshine, no double-capture. */
  async startFeed(mode: StreamingMode): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      this.ws = new WebSocket(soulWsUrl());
      this.ws.binaryType = 'arraybuffer';
      this.wsOpenPromise = new Promise<void>((resolve, reject) => {
        const ws = this.ws!;
        const onOpen = () => {
          ws.removeEventListener('open', onOpen);
          ws.removeEventListener('error', onErr);
          ws.send(JSON.stringify({ type: 'config', mode }));
          resolve();
        };
        const onErr = (e: Event) => {
          ws.removeEventListener('open', onOpen);
          ws.removeEventListener('error', onErr);
          reject(new Error(`WebSocket connect failed: ${e.type}`));
        };
        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onErr);
      });
      this.ws.addEventListener('message', this.handleWsMessage);
      this.ws.addEventListener('close', this.handleWsClose);
      this.ws.addEventListener('error', this.handleWsError);
      await this.wsOpenPromise;
      this.emit({ kind: 'started' });
    } catch (err) {
      await this.stop();
      const message = err instanceof Error ? err.message : 'voice start failed';
      this.emit({ kind: 'error', message });
      throw err;
    }
  }

  /** Forward a Float32 PCM frame to the open WebSocket. Silently
   *  drops if the WS isn't open yet (frames captured during the
   *  ~10 ms handshake window). Caller can fire this at the worklet
   *  rate (31 fps for 512-sample frames at 16 kHz) without ceremony.
   *  Also updates the amplitude level used by the cursor visualizer. */
  pushFrame(samples: Float32Array): void {
    this.updateLevel(samples);
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Float32Array.buffer is the right thing to send, typed-array
    // copy isn't necessary because send() schedules from the buffer
    // pointer and the renderer's worklet just allocated this frame.
    ws.send(samples.buffer as ArrayBuffer);
  }

  /** Compute RMS of a frame, smooth with an EMA, and emit a 'level'
   *  event throttled to ~60 Hz. Cheap (one pass over 512 samples). */
  private updateLevel(samples: Float32Array): void {
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSq += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSq / Math.max(1, samples.length));
    // EMA smoothing: 0.4 weight on the new sample feels responsive
    // without strobing between frames at typical speech rates.
    this.smoothedRms = this.smoothedRms * 0.6 + rms * 0.4;
    const now = performance.now();
    if (now - this.lastLevelEmitMs >= 16) {
      this.lastLevelEmitMs = now;
      this.emit({ kind: 'level', value: this.smoothedRms });
    }
  }

  /** Open mic + WebSocket and begin streaming. Idempotent, calling
   *  start() while already running is a no-op. */
  async start(mode: StreamingMode): Promise<void> {
    if (this.active) return;
    this.active = true;

    try {
      // 1. Mic capture at 16 kHz mono. The AudioContext is created at
      //    SAMPLE_RATE so the worklet receives audio at the rate
      //    Moonshine wants, no resampling needed downstream.
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      // Some browsers / Electron versions return a context that's
      // suspended until a user gesture. Sign-in flow ensures we have
      // a gesture by the time start() runs, but be safe.
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      // The 16 kHz hint above is best-effort. If the platform gave us a
      // different rate, resample frames to 16 kHz before sending (see the
      // resampler fields). Reset the resampler state for this session.
      const actualRate = this.ctx.sampleRate;
      this._rsNeed = actualRate !== SAMPLE_RATE;
      this._rsStep = actualRate / SAMPLE_RATE;
      this._rsPos = 0;
      this._rsPrev = 0;
      console.info('[stt] AudioContext', actualRate, 'Hz',
        this._rsNeed ? `→ resampling to ${SAMPLE_RATE}Hz` : '(native 16k)');

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      await this.ctx.audioWorklet.addModule(WORKLET_URL);
      const source = this.ctx.createMediaStreamSource(this.mediaStream);
      this.node = new AudioWorkletNode(this.ctx, 'voice-capture-worklet');
      source.connect(this.node);
      // Worklet declares an output channel (silent) so the runtime
      // keeps calling process(); route it to destination.
      this.node.connect(this.ctx.destination);

      this.node.port.onmessage = (e: MessageEvent<WorkletFrameMessage>) => {
        const data = e.data;
        if (!data || data.kind !== 'frame') return;
        // Update level visualizer state. Computed on every frame
        // regardless of WS state so the cursor responds even during
        // the connect handshake.
        this.updateLevel(data.samples);
        // Only forward when the WS is open. Frames captured before the
        // connect handshake completes are dropped, typically tens of
        // ms of leading audio, well within the pre-roll the user
        // hasn't started speaking through yet.
        const ws = this.ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
          // Resample to 16 kHz if the context isn't already there, then ship.
          // (A no-op copy-free pass-through when the 16 kHz hint was honored.)
          if (this._rsNeed) {
            const rs = this.resampleTo16k(data.samples);
            // subarray shares the backing buffer; slice to send just our span.
            ws.send(rs.slice().buffer);
          } else {
            ws.send(data.samples.buffer as ArrayBuffer);
          }
        }
      };

      // 2. WebSocket. Open in parallel with the mic setup above; the
      //    onmessage handler above gates frame sends on readyState so
      //    nothing leaks before handshake completes.
      this.ws = new WebSocket(soulWsUrl());
      this.ws.binaryType = 'arraybuffer';

      this.wsOpenPromise = new Promise<void>((resolve, reject) => {
        const ws = this.ws!;
        const onOpen = () => {
          ws.removeEventListener('open', onOpen);
          ws.removeEventListener('error', onErr);
          // Send the mode hint so the server log knows what's happening.
          ws.send(JSON.stringify({ type: 'config', mode }));
          resolve();
        };
        const onErr = (e: Event) => {
          ws.removeEventListener('open', onOpen);
          ws.removeEventListener('error', onErr);
          reject(new Error(`WebSocket connect failed: ${e.type}`));
        };
        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onErr);
      });

      this.ws.addEventListener('message', this.handleWsMessage);
      this.ws.addEventListener('close', this.handleWsClose);
      this.ws.addEventListener('error', this.handleWsError);

      await this.wsOpenPromise;
      this.emit({ kind: 'started' });
    } catch (err) {
      // Tear down anything that opened before bailing.
      await this.stop();
      const message = err instanceof Error ? err.message : 'voice start failed';
      this.emit({ kind: 'error', message });
      throw err;
    }
  }

  /** Send a `finalize` control message and resolve with the server's
   *  final text. Caller can then call stop() (push mode) or just keep
   *  the connection open for the next utterance (continuous mode). */
  async finalize(): Promise<string> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return '';
    }
    // Dedupe: if a finalize is already pending, wait on the same
    // resolver. Defensive, the renderer's keyup handler shouldn't
    // race itself, but spurious double-fire from the OS does happen.
    if (this.finalResolver) {
      return new Promise<string>((resolve, reject) => {
        const prev = this.finalResolver!;
        this.finalResolver = (text) => { prev(text); resolve(text); };
        const prevRej = this.finalRejecter!;
        this.finalRejecter = (err) => { prevRej(err); reject(err); };
      });
    }
    return new Promise<string>((resolve, reject) => {
      this.finalResolver = resolve;
      this.finalRejecter = reject;
      ws.send(JSON.stringify({ type: 'finalize' }));
    });
  }

  /** Reset the server-side buffer + committed state without closing
   *  the connection. Continuous mode uses this between utterances. */
  reset(): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'reset' }));
    }
  }

  /** Close mic + WebSocket. Idempotent. Safe to call from anywhere. */
  async stop(): Promise<void> {
    this.active = false;
    if (this.finalRejecter) {
      this.finalRejecter(new Error('stopped before finalize completed'));
      this.finalResolver = null;
      this.finalRejecter = null;
    }
    if (this.node) {
      try { this.node.disconnect(); } catch { /* already gone */ }
      this.node = null;
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        try { track.stop(); } catch { /* nothing */ }
      }
      this.mediaStream = null;
    }
    if (this.ctx) {
      try { await this.ctx.close(); } catch { /* nothing */ }
      this.ctx = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* nothing */ }
      this.ws = null;
    }
    this.emit({ kind: 'stopped' });
  }

  // ----- internals -----

  private emit(ev: StreamingEvent): void {
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch (err) {
        console.error('[streaming] listener threw', err);
      }
    }
  }

  private handleWsMessage = (e: MessageEvent) => {
    if (typeof e.data !== 'string') return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(e.data) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === 'partial') {
      this.emit({
        kind: 'partial',
        committed: msg.committed ?? '',
        tentative: msg.tentative ?? '',
      });
    } else if (msg.type === 'final') {
      const text = (msg.text ?? '').trim();
      this.emit({ kind: 'final', text });
      const resolver = this.finalResolver;
      this.finalResolver = null;
      this.finalRejecter = null;
      resolver?.(text);
    } else if (msg.type === 'error') {
      const message = msg.message ?? 'streaming error';
      this.emit({ kind: 'error', message });
    }
  };

  private handleWsClose = () => {
    if (this.active) {
      // Server closed on us mid-session.
      this.emit({ kind: 'error', message: 'connection closed unexpectedly' });
      void this.stop();
    }
  };

  private handleWsError = () => {
    // Most WebSocket errors fire `close` right after, so let close
    // do the cleanup. We just emit the error event for visibility.
    this.emit({ kind: 'error', message: 'connection error' });
  };
}
