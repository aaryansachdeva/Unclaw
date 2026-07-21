// Top-level orchestrator. Owns:
//   - the AudioContext + worklet feeding 32 ms frames
//   - a 30 s ring buffer of the last raw audio
//   - the Silero VAD session and prosody engine
//   - the endpointer state machine
//   - one Whisper transcription per utterance, fired on endpoint
//   - barge-in / AI-speaking awareness
//
// External contract is intentionally tiny: `start({ ... })`, `stop()`,
// and a stream of "events" you can subscribe to. The React hook on top
// (useVoiceAgent) maps those events into hook state.

import {
  BARGE_IN_FRAMES,
  BARGE_IN_PROB,
  FRAME_SIZE,
  MIN_UTTERANCE_PEAK,
  PRE_ROLL_MS,
  RING_BUFFER_SAMPLES,
  SAMPLE_RATE,
} from './constants';
import { Endpointer, type EndpointerState } from './endpointer';
import { ProsodyEngine, type ProsodySnapshot } from './prosodyEngine';
import { SileroVAD, preloadVAD } from './vadEngine';
// Whisper-batch ASR was removed; Moonshine streaming is the only path.
// `whisperClient.ts` lingers for historical reference but is unused.

// --- public event surface ---------------------------------------------
//
// 'state' fires on every endpointer state transition. The hook on top
// derives isUserSpeaking / silenceCountdown / etc. from it. This is the
// single source of truth for UI; we deliberately don't ship separate
// speechStart/speechEnd events because they can be derived from state
// transitions and the redundancy made it easy to forget one of them
// (see git log: speechStart was previously unreachable for ~3 weeks).

export type VoiceEvent =
  | { kind: 'state'; state: EndpointerState }
  | { kind: 'frame'; vadProb: number; smoothedProb: number; prosody: ProsodySnapshot }
  | { kind: 'silenceTimer'; requiredMs: number; elapsedMs: number }
  | { kind: 'transcript'; text: string; durationS: number; totalMs: number }
  | { kind: 'transcribing'; pending: boolean }
  | { kind: 'bargeIn' }
  | { kind: 'error'; message: string };

export type VoiceListener = (ev: VoiceEvent) => void;

/** Subset of StreamingTranscriber's API that VoiceController needs.
 *  Defined as a structural interface so this module doesn't import
 *  the streaming client (keeps the dependency direction clean). */
export interface StreamingFeed {
  startFeed(mode: 'continuous' | 'push'): Promise<void>;
  pushFrame(samples: Float32Array): void;
  finalize(): Promise<string>;
  stop(): Promise<void>;
}

export interface VoiceControllerOptions {
  /** Hook that returns whether AI is currently producing audio. */
  isAISpeaking: () => boolean;
  /** Optional persona / vocabulary hint to seed Whisper. */
  whisperPrompt?: () => string;
  /** When provided, VoiceController routes every audio frame to this
   *  streaming transcriber while the user is speaking, and reads the
   *  final transcription from `finalize()` instead of calling Whisper.
   *  Returns the live committed/tentative text via the transcriber's
   *  own event stream (subscribed by the React layer). */
  streaming?: StreamingFeed;
}

export class VoiceController {
  private listeners = new Set<VoiceListener>();
  private opts: VoiceControllerOptions;

  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private worklet = new Worklet(); // wraps the message handler closure

  // Rate adaptation. Silero VAD (and the streaming transcriber we feed) both
  // require exactly 16 kHz. We ASK the AudioContext for 16 kHz, but some Core
  // Audio setups ignore the hint — notably this Mac's UnclawSilentSink driver,
  // which forces 48 kHz. So when the context comes back at another rate we
  // resample worklet frames to 16 kHz on the fly (continuous linear resampler,
  // identical to streamingClient's), then RE-CHUNK to exactly FRAME_SIZE (512)
  // samples before handing them to processFrame — vadEngine.probe() throws on
  // any other length. Previously this class hard-threw on a non-16 kHz context,
  // which is why continuous voice mode was dead on this machine.
  private _rsNeed = false;   // true when the context isn't 16 kHz
  private _rsStep = 1;       // input samples consumed per 16 kHz output sample
  private _rsPos = 0;        // fractional read index carried across frames
  private _rsPrev = 0;       // last sample of the previous frame (edge interp)
  // 16 kHz accumulator: resampled samples pile up here and drain out in
  // exact 512-sample frames.
  private _acc = new Float32Array(FRAME_SIZE * 8);
  private _accLen = 0;

  // Ring buffer of last RING_BUFFER_SAMPLES samples (Float32, [-1, 1]).
  private ring = new Float32Array(RING_BUFFER_SAMPLES);
  private ringWriteIdx = 0;     // next sample idx to write
  private ringFilled = 0;       // total samples written ever (monotonic)

  private vad = new SileroVAD();
  private prosody = new ProsodyEngine();
  private endpointer = new Endpointer();

  /** Last endpointer state we saw — used to detect transitions. */
  private prevState: EndpointerState = 'idle';

  /** AbortController for the in-flight Whisper request. */
  private finalAbort: AbortController | null = null;

  private inFlightTranscriptionId = 0;
  /** Per-utterance counter for log correlation. */
  private finalFireCounter = 0;

  // Conversational pacing — average ms between user turns.
  private lastTurnEndedAtMs = 0;
  private lastTurnPaceMs = 0;
  // Cold-start grace: ms since the AI finished speaking.
  private lastAIFinishedAtMs = 0;

  // Diagnostic: per-second peak VAD prob + peak RMS so we can tell from
  // the console whether the mic stream is silent (rms ~ 0), VAD is
  // miscalibrated (rms healthy, prob never high), or we're firing fine.
  private diagWindowFrames = 0;
  private diagPeakProb = 0;
  private diagPeakRms = 0;

  // Barge-in tracking when AI is talking.
  private bargeInFrames = 0;

  // Streaming-feed lifecycle. The streaming WS opens lazily at the
  // start of each utterance and closes after finalize. Tracking the
  // open promise + active flag keeps frame pushes from racing the
  // handshake and from leaking after a stop.
  private streamingOpen = false;
  private streamingOpenPromise: Promise<void> | null = null;

  private running = false;

  constructor(opts: VoiceControllerOptions) {
    this.opts = opts;
  }

  on(listener: VoiceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(ev: VoiceEvent): void {
    for (const l of this.listeners) {
      try { l(ev); } catch (err) { console.error('[voice] listener threw', err); }
    }
  }

  /** Start mic capture + VAD pipeline. Idempotent. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.info('[voice] start() — preloading Silero VAD + requesting mic');

    try {
      // Pre-load model in parallel with mic permission grant.
      const vadInitP = (async () => {
        try {
          await preloadVAD();
          await this.vad.init();
          console.info('[voice] Silero VAD ready');
        } catch (err) {
          console.error('[voice] Silero load failed (check ./silero_vad.onnx + ORT wasm CDN reachable):', err);
          throw err;
        }
      })();

      // Browsers honor sampleRate hints best-effort. With a 16 kHz hint
      // most modern browsers give us 16 kHz directly; otherwise the
      // AudioContext does the resample for us before the worklet sees it.
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: SAMPLE_RATE,
          } as MediaTrackConstraints,
        });
        const track = this.mediaStream.getAudioTracks()[0];
        console.info('[voice] mic granted:',
          track?.label, track?.getSettings?.());
      } catch (err) {
        console.error('[voice] getUserMedia failed (mic permission?):', err);
        throw err;
      }

      // Constructing the AudioContext at 16 kHz lets the worklet receive
      // frames at the rate Silero wants. If the device only supports 48 kHz,
      // the browser will downsample for us at the input boundary.
      // Some platforms refuse a 16 kHz AudioContext outright (Safari, certain
      // Linux configs). Fall back to the device's default rate and let the
      // worklet receive whatever rate; we'll resample via the AudioContext
      // when constructing the MediaStreamSource.
      try {
        this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
      } catch (err) {
        console.warn('[voice] 16kHz AudioContext rejected, falling back:', err);
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
      }
      // The context may not honor the 16 kHz hint (this Mac's UnclawSilentSink
      // driver forces 48 kHz). Rather than bail — which killed continuous voice
      // mode entirely — set up an on-the-fly resampler to 16 kHz. Frames get
      // resampled + re-chunked to exactly FRAME_SIZE in the worklet onmessage
      // handler below. Reset the resampler state for this session.
      const actualRate = this.ctx.sampleRate;
      this._rsNeed = actualRate !== SAMPLE_RATE;
      this._rsStep = actualRate / SAMPLE_RATE;
      this._rsPos = 0;
      this._rsPrev = 0;
      this._accLen = 0;
      console.info(
        '[voice] AudioContext at', actualRate, 'Hz',
        this._rsNeed ? `→ resampling to ${SAMPLE_RATE}Hz` : '(native 16k)',
      );

      try {
        // RELATIVE path (`./`), not absolute (`/`). See vadEngine.ts +
        // services/onboardingAudio.ts for the same Electron file:// trap.
        await this.ctx.audioWorklet.addModule('./voice-worklet.js');
      } catch (err) {
        console.error('[voice] worklet load failed (is ./voice-worklet.js served?):', err);
        throw err;
      }
      const source = this.ctx.createMediaStreamSource(this.mediaStream);
      this.node = new AudioWorkletNode(this.ctx, 'voice-capture-worklet', {
        numberOfInputs: 1,
        // Output 1 silent channel so the audio graph has a complete path
        // to destination. Without this Chromium/Electron will sometimes
        // skip calling process() entirely.
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      let frameCount = 0;
      this.node.port.onmessage = (e) => {
        const msg = e.data;
        if (msg && msg.kind === 'frame') {
          frameCount += 1;
          // Telemetry: prove frames are flowing without spamming the log.
          if (frameCount === 1) console.info('[voice] first audio frame');
          else if (frameCount % 150 === 0) console.debug('[voice] frame', frameCount);
          // Resample to 16 kHz if the context isn't already there, then drain
          // exact FRAME_SIZE (512-sample) frames into processFrame.
          const in16k = this._rsNeed ? this.resampleTo16k(msg.samples) : msg.samples;
          this.feed16k(in16k);
        }
      };

      // Wait for the VAD model BEFORE wiring the audio graph, so the very
      // first frame the worklet emits goes straight into processFrame.
      // Wiring after `source.connect(...)` would stream the first ~6
      // frames into a no-op handler and silently drop them.
      await vadInitP;
      this.worklet.handleFrame = async (samples: Float32Array) => {
        await this.processFrame(samples);
      };
      source.connect(this.node);
      // Complete the graph: silent worklet output → destination. Speaker
      // output is identically zero so no audible feedback.
      this.node.connect(this.ctx.destination);
    } catch (err) {
      this.running = false;
      this.emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      await this.cleanup();
      throw err;
    }
  }

  /** Stop mic + worklet. Cancels any in-flight transcription. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.finalAbort?.abort();
    this.finalAbort = null;
    // Tear down any open streaming session — the user toggled voice
    // off mid-utterance.
    if (this.streamingOpen && this.opts.streaming) {
      this.streamingOpen = false;
      this.streamingOpenPromise = null;
      try { await this.opts.streaming.stop(); } catch { /* nothing */ }
    }
    await this.cleanup();
  }

  /** Caller can mark "AI just finished" to enable cold-start grace. */
  notifyAIFinished(): void {
    this.lastAIFinishedAtMs = performance.now();
  }

  // -------------------------------------------------------------------
  //  Rate adaptation (48 kHz → 16 kHz + exact FRAME_SIZE re-chunking)
  // -------------------------------------------------------------------

  /** Continuous linear resampler from the context rate to 16 kHz. `_rsPos`
   *  carries the fractional read position across frames and `_rsPrev` holds
   *  the previous frame's last sample for interpolation across the boundary.
   *  Identical to streamingClient's so both audio consumers agree. */
  private resampleTo16k(frame: Float32Array): Float32Array {
    const step = this._rsStep;
    const n = frame.length;
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

  /** Append 16 kHz samples and drain exact FRAME_SIZE (512-sample) frames into
   *  processFrame. Silero VAD throws on any other length, and the streaming
   *  transcriber (fed via pushFrame inside processFrame) expects 16 kHz too.
   *  Whether the context is native 16 kHz or resampled, everything downstream
   *  sees identical 512-sample frames at a steady ~32 ms cadence. */
  private feed16k(samples: Float32Array): void {
    if (this._accLen + samples.length > this._acc.length) {
      const grown = new Float32Array(
        Math.max(this._acc.length * 2, this._accLen + samples.length),
      );
      grown.set(this._acc.subarray(0, this._accLen));
      this._acc = grown;
    }
    this._acc.set(samples, this._accLen);
    this._accLen += samples.length;

    let off = 0;
    while (this._accLen - off >= FRAME_SIZE) {
      // slice() copies — processFrame + pushFrame retain the buffer, so it must
      // not be aliased to the accumulator we're about to compact.
      const frame = this._acc.slice(off, off + FRAME_SIZE);
      off += FRAME_SIZE;
      this.worklet.handleFrame(frame).catch((err) => {
        this.emit({ kind: 'error', message: `frame handler: ${err}` });
      });
    }
    if (off > 0) {
      this._acc.copyWithin(0, off, this._accLen);
      this._accLen -= off;
    }
  }

  // -------------------------------------------------------------------
  //  Frame processor
  // -------------------------------------------------------------------
  private async processFrame(samples: Float32Array): Promise<void> {
    if (!this.running) return;

    // 1. Push to ring buffer.
    this.writeRing(samples);

    // 2. Run VAD + prosody.
    const vadProb = await this.vad.probe(samples);
    const prosody = this.prosody.feed(samples);

    // Per-second diagnostic. Tells us at a glance whether mic is silent
    // (peak rms ~ 0), VAD is miscalibrated for this user/mic (rms fine
    // but prob stays low), or everything's working.
    if (vadProb > this.diagPeakProb) this.diagPeakProb = vadProb;
    if (prosody.rms > this.diagPeakRms) this.diagPeakRms = prosody.rms;
    this.diagWindowFrames += 1;
    if (this.diagWindowFrames >= 31) {  // ~1s at 32 ms/frame
      console.info(
        `[voice] 1s peak: vad=${this.diagPeakProb.toFixed(2)} ` +
        `rms=${this.diagPeakRms.toFixed(3)}`,
      );
      this.diagPeakProb = 0;
      this.diagPeakRms = 0;
      this.diagWindowFrames = 0;
    }

    // 3. Barge-in path: if AI is currently talking, raise the bar and only
    //    interrupt on a sustained, confident speech signal.
    if (this.opts.isAISpeaking()) {
      if (vadProb >= BARGE_IN_PROB) this.bargeInFrames += 1;
      else this.bargeInFrames = 0;

      if (this.bargeInFrames >= BARGE_IN_FRAMES) {
        this.bargeInFrames = 0;
        this.emit({ kind: 'bargeIn' });
        // Fall through to normal endpointer processing — once the host
        // hook mutes AI playback, isAISpeaking() returns false and the
        // user's words are captured normally.
      }
      // While AI is speaking, don't run the endpointer — it would
      // false-trigger on echo. We resume on the very next frame after
      // isAISpeaking() flips back.
      this.emit({ kind: 'frame', vadProb, smoothedProb: this.vad.smoothedProb, prosody });
      return;
    }

    this.bargeInFrames = 0;

    // 4. Endpointer step.
    const snap = this.endpointer.feed({
      vadProb,
      prosody,
      msSinceAIFinished: this.lastAIFinishedAtMs > 0
        ? performance.now() - this.lastAIFinishedAtMs : 0,
      recentTurnPaceMs: this.lastTurnPaceMs,
    });

    this.emit({ kind: 'frame', vadProb, smoothedProb: this.vad.smoothedProb, prosody });

    // State transitions drive UI. We emit `state` ON CHANGE and
    // `silenceTimer` only while trailing — the hook resets the
    // countdown UI on any transition out of trailing.
    if (snap.state !== this.prevState) {
      const wasState = this.prevState;
      this.prevState = snap.state;
      this.emit({ kind: 'state', state: snap.state });

      // Open the streaming feed at the moment the user starts
      // speaking. We open ONCE per utterance and close in handleEnded
      // (after finalize). 'armed' is the first non-idle state — it
      // means VAD has seen sustained speech onset.
      if (this.opts.streaming
          && wasState === 'idle'
          && (snap.state === 'armed' || snap.state === 'speech')
          && !this.streamingOpen) {
        this.streamingOpen = true;
        this.streamingOpenPromise = this.opts.streaming
          .startFeed('continuous')
          .catch((err) => {
            this.streamingOpen = false;
            this.streamingOpenPromise = null;
            console.warn('[voice] streaming startFeed failed', err);
          });
      }
    }

    // While the streaming WS is open, push every frame through it.
    // pushFrame() is a no-op until the WS handshake completes, so
    // we don't need to await the open promise on the hot path.
    if (this.opts.streaming && this.streamingOpen) {
      this.opts.streaming.pushFrame(samples);
    }

    if (snap.state === 'trailing') {
      this.emit({
        kind: 'silenceTimer',
        requiredMs: snap.silenceRequiredMs,
        elapsedMs: snap.silenceElapsedMs,
      });
    }

    if (snap.justEnded) {
      // Snapshot the ring write position and the trailing-silence amount
      // RIGHT NOW, at speech-end. handleEnded runs as a microtask and
      // more frames may land in the ring before it executes — without
      // these snapshots, the slice would drift later in the buffer (i.e.
      // grab even more silence) on every invocation.
      const ringFilledAtEnd = this.ringFilled;
      const trailingSilenceMs = snap.silenceElapsedMs;
      this.handleEnded(
        snap.utteranceMs,
        trailingSilenceMs,
        ringFilledAtEnd,
      ).catch((err) => {
        this.emit({ kind: 'error', message: `endpoint handler: ${err}` });
      });
    }
  }

  // -------------------------------------------------------------------
  //  Transcription
  // -------------------------------------------------------------------

  /** Reset every per-utterance subsystem and notify UI we're back to idle. */
  private resetForNextUtterance(): void {
    this.endpointer.reset();
    this.vad.reset();
    this.prosody.reset();
    if (this.prevState !== 'idle') {
      this.prevState = 'idle';
      this.emit({ kind: 'state', state: 'idle' });
    }
  }

  private async handleEnded(
    durationMs: number,
    trailingSilenceMs: number,
    ringFilledAtEnd: number,
  ): Promise<void> {
    const audio = this.sliceUtteranceWithPreroll(
      durationMs,
      trailingSilenceMs,
      ringFilledAtEnd,
    );
    if (!audio || audio.length < SAMPLE_RATE * 0.15) {
      // Too short — ignore (likely a misfire).
      console.info(
        `[stt] endpoint fired but utterance too short ` +
        `(${audio ? (audio.length / SAMPLE_RATE).toFixed(2) : 0}s) — discarded`,
      );
      this.resetForNextUtterance();
      return;
    }

    // Pre-flight energy gate. Whisper turbo hallucinates "Thank you" /
    // "Thanks for watching" on near-silent audio. Two complementary
    // measurements:
    //   - peak: max absolute sample value across the speech portion.
    //     Robust to pause-heavy utterances ("um... ok") where the RMS
    //     averages out low even though the speaker actually said words.
    //   - rms: total energy. Useful as a sanity check + log signal.
    // We gate on PEAK, not RMS — a real spoken word always crosses
    // peak ≥ ~0.05 even on a quiet mic, while pure-silence audio is
    // bounded by the noise floor (typically ≤ 0.01).
    const preRollSamples = Math.round((PRE_ROLL_MS / 1000) * SAMPLE_RATE);
    const speechView = audio.subarray(Math.min(preRollSamples, audio.length));
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < speechView.length; i++) {
      const v = speechView[i];
      sumSq += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    const rms = speechView.length > 0 ? Math.sqrt(sumSq / speechView.length) : 0;

    const audioSec = audio.length / SAMPLE_RATE;
    const silenceThr = this.endpointer.currentSilenceRequiredMs;

    if (peak < MIN_UTTERANCE_PEAK) {
      console.info(
        `[stt] endpoint fired but audio too quiet ` +
        `(peak=${peak.toFixed(4)} rms=${rms.toFixed(4)} ` +
        `audio=${audioSec.toFixed(2)}s utterance=${(durationMs/1000).toFixed(2)}s) ` +
        `— discarded`,
      );
      this.resetForNextUtterance();
      return;
    }

    console.info(
      `[stt] endpoint fired  ` +
      `utterance=${(durationMs/1000).toFixed(2)}s  ` +
      `audio-with-preroll=${audioSec.toFixed(2)}s  ` +
      `peak=${peak.toFixed(3)}  rms=${rms.toFixed(3)}  ` +
      `silence-threshold-was=${silenceThr.toFixed(0)}ms`,
    );

    const ourId = ++this.inFlightTranscriptionId;
    this.emit({ kind: 'transcribing', pending: true });

    let finalText = '';
    let totalMs = 0;
    const fireId = ++this.finalFireCounter;
    console.info(
      `[stt] FINAL #${fireId}  audio=${audioSec.toFixed(2)}s (${audio.length} samples)`,
    );
    const t0 = performance.now();

    // Moonshine is the only ASR path. Audio frames were pushed to the
    // WS as they arrived; here we just ask the server for the final
    // transcription and close the streaming session. There is no
    // Whisper fallback — the controller refuses to run without a
    // streaming feed wired (see start()).
    if (!this.opts.streaming) {
      this.emit({ kind: 'error', message: 'no streaming transcriber wired' });
      this.emit({ kind: 'transcribing', pending: false });
      this.resetForNextUtterance();
      return;
    }
    try {
      // Wait for the open handshake in case finalize lands while
      // the WS is still connecting (very fast utterances).
      if (this.streamingOpenPromise) {
        await this.streamingOpenPromise;
      }
      finalText = await this.opts.streaming.finalize();
      totalMs = performance.now() - t0;
      console.info(
        `[stt] FINAL #${fireId} resp (moonshine)  ` +
        `wall=${totalMs.toFixed(0)}ms  text="${finalText}"`,
      );
    } catch (err) {
      console.error(`[stt] FINAL #${fireId} streaming finalize failed:`, err);
      this.emit({ kind: 'error', message: `streaming finalize failed: ${err}` });
    } finally {
      try { await this.opts.streaming.stop(); } catch { /* nothing */ }
      this.streamingOpen = false;
      this.streamingOpenPromise = null;
    }

    this.emit({ kind: 'transcribing', pending: false });
    this.resetForNextUtterance();

    const now = performance.now();
    if (this.lastTurnEndedAtMs > 0) this.lastTurnPaceMs = now - this.lastTurnEndedAtMs;
    this.lastTurnEndedAtMs = now;

    if (this.inFlightTranscriptionId !== ourId) return;
    const text = finalText.trim();
    if (!text) return;
    this.emit({
      kind: 'transcript',
      text,
      durationS: audio.length / SAMPLE_RATE,
      totalMs,
    });
  }

  // -------------------------------------------------------------------
  //  Ring buffer
  // -------------------------------------------------------------------
  private writeRing(samples: Float32Array): void {
    let n = samples.length;
    let src = 0;
    while (n > 0) {
      const room = this.ring.length - this.ringWriteIdx;
      const take = Math.min(room, n);
      this.ring.set(samples.subarray(src, src + take), this.ringWriteIdx);
      this.ringWriteIdx = (this.ringWriteIdx + take) % this.ring.length;
      this.ringFilled += take;
      src += take;
      n -= take;
    }
  }

  /**
   * Produce a contiguous Float32Array from the ring covering pre-roll +
   * speech only — NO trailing silence. The endpointer fires after several
   * hundred ms of confirmed silence, so the live ring tail at handleEnded
   * time is silence; anchoring the slice at the live tail (the previous
   * implementation did) gave Whisper a buffer that was mostly silence,
   * which is exactly what triggers the "Thank you" / "Thanks for
   * watching" hallucinations the model loves so much.
   *
   * Anchoring at `ringFilledAtEnd - trailingSilenceSamples` gives us the
   * actual end-of-speech in absolute sample coordinates; we then walk
   * backwards `utteranceMs + PRE_ROLL_MS` to get the start.
   */
  private sliceUtteranceWithPreroll(
    utteranceMs: number,
    trailingSilenceMs: number,
    ringFilledAtEnd: number,
  ): Float32Array | null {
    const preRollSamples = Math.round((PRE_ROLL_MS / 1000) * SAMPLE_RATE);
    const utteranceSamples = Math.round((utteranceMs / 1000) * SAMPLE_RATE);
    const trailingSilenceSamples = Math.max(
      0, Math.round((trailingSilenceMs / 1000) * SAMPLE_RATE),
    );

    // Anchor: end of speech in absolute coords (samples-ever-written).
    // Clamp to 0 in case something upstream gave us nonsense.
    const speechEndAbs = Math.max(0, ringFilledAtEnd - trailingSilenceSamples);
    const speechStartAbs = Math.max(0, speechEndAbs - utteranceSamples);
    const preRollStartAbs = Math.max(0, speechStartAbs - preRollSamples);

    // Don't read past what the ring still holds — only the most recent
    // `ring.length` samples are available.
    const oldestAvailableAbs = Math.max(0, this.ringFilled - this.ring.length);
    const sliceStartAbs = Math.max(preRollStartAbs, oldestAvailableAbs);
    const sliceEndAbs = Math.min(speechEndAbs, this.ringFilled);

    const want = sliceEndAbs - sliceStartAbs;
    if (want < SAMPLE_RATE * 0.1) return null;

    const startIdx = ((sliceStartAbs % this.ring.length) + this.ring.length) % this.ring.length;
    const out = new Float32Array(want);
    if (startIdx + want <= this.ring.length) {
      out.set(this.ring.subarray(startIdx, startIdx + want));
    } else {
      const first = this.ring.length - startIdx;
      out.set(this.ring.subarray(startIdx, this.ring.length), 0);
      out.set(this.ring.subarray(0, want - first), first);
    }
    return out;
  }

  // -------------------------------------------------------------------
  //  Cleanup
  // -------------------------------------------------------------------
  private async cleanup(): Promise<void> {
    try {
      this.node?.disconnect();
      this.node = null;
      this.mediaStream?.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
      if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close();
      this.ctx = null;
    } catch (err) {
      console.warn('[voice] cleanup err:', err);
    }
  }
}

// Trivial wrapper so the worklet message handler is a hot-swappable closure.
class Worklet {
  handleFrame: (samples: Float32Array) => Promise<void> = async () => {};
}
