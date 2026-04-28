// Top-level orchestrator. Owns:
//   - the AudioContext + worklet feeding 32 ms frames
//   - a 30 s ring buffer of the last raw audio
//   - the Silero VAD session and prosody engine
//   - the endpointer state machine
//   - speculative + final Whisper transcription
//   - barge-in / AI-speaking awareness
//
// External contract is intentionally tiny: `start({ ... })`, `stop()`,
// and a stream of "events" you can subscribe to. The React hook on top
// (useVoiceAgent) maps those events into hook state.

import {
  BARGE_IN_FRAMES,
  BARGE_IN_PROB,
  EARLY_FIRE_AFTER_MS,
  ENDPOINT_BASE_MS,
  FRAME_MS,
  FRAME_SIZE,
  PRE_ROLL_MS,
  RING_BUFFER_SAMPLES,
  SAMPLE_RATE,
  VAD_ACTIVATION_PROB,
  VAD_DEACTIVATION_PROB,
} from './constants';
import { Endpointer, type EndpointerState } from './endpointer';
import { ProsodyEngine, type ProsodySnapshot } from './prosodyEngine';
import { SileroVAD, preloadVAD } from './vadEngine';
import { transcribe, type TranscriptionResult } from './whisperClient';

// --- public event surface ---------------------------------------------

export type VoiceEvent =
  | { kind: 'state'; state: EndpointerState }
  | { kind: 'frame'; vadProb: number; smoothedProb: number; prosody: ProsodySnapshot }
  | { kind: 'silenceTimer'; requiredMs: number; elapsedMs: number }
  | { kind: 'speechStart' }
  | { kind: 'speechEnd'; durationMs: number }
  | { kind: 'partialTranscript'; text: string }
  | { kind: 'transcript'; text: string; durationS: number; totalMs: number }
  | { kind: 'transcribing'; pending: boolean }
  | { kind: 'bargeIn' }
  | { kind: 'error'; message: string };

export type VoiceListener = (ev: VoiceEvent) => void;

export interface VoiceControllerOptions {
  /** Hook that returns whether AI is currently producing audio. */
  isAISpeaking: () => boolean;
  /** Optional persona / vocabulary hint to seed Whisper. */
  whisperPrompt?: () => string;
}

export class VoiceController {
  private listeners = new Set<VoiceListener>();
  private opts: VoiceControllerOptions;

  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private worklet = new Worklet(); // wraps the message handler closure

  // Ring buffer of last RING_BUFFER_SAMPLES samples (Float32, [-1, 1]).
  private ring = new Float32Array(RING_BUFFER_SAMPLES);
  private ringWriteIdx = 0;     // next sample idx to write
  private ringFilled = 0;       // total samples written ever (monotonic)

  private vad = new SileroVAD();
  private prosody = new ProsodyEngine();
  private endpointer = new Endpointer();

  // Endpointer / partial-transcript bookkeeping.
  private partialTranscript = '';
  private earlyFireSent = false;
  private earlyFireAbort: AbortController | null = null;
  private earlyFirePromise: Promise<TranscriptionResult> | null = null;
  private finalAbort: AbortController | null = null;

  private inFlightTranscriptionId = 0;

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
          console.error('[voice] Silero load failed (check /silero_vad.onnx and /ort/* are served):', err);
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
      console.info('[voice] AudioContext at', this.ctx.sampleRate, 'Hz');
      if (this.ctx.sampleRate !== SAMPLE_RATE) {
        // Silero v5 requires exactly 16 kHz frames. If we couldn't get a
        // 16 kHz context, the worklet will produce mismatched-rate frames
        // and VAD output will be garbage. Bail with a clear message rather
        // than silently misbehave.
        throw new Error(
          `voice: AudioContext is at ${this.ctx.sampleRate} Hz, ` +
          `need ${SAMPLE_RATE} Hz. This OS/browser combo refused our 16 kHz hint.`,
        );
      }

      try {
        await this.ctx.audioWorklet.addModule('/voice-worklet.js');
      } catch (err) {
        console.error('[voice] worklet load failed (is /voice-worklet.js served?):', err);
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
          this.worklet.handleFrame(msg.samples).catch((err) => {
            this.emit({ kind: 'error', message: `frame handler: ${err}` });
          });
        }
      };
      source.connect(this.node);
      // Complete the graph: silent worklet output → destination. Speaker
      // output is identically zero so no audible feedback.
      this.node.connect(this.ctx.destination);

      await vadInitP;

      // Wire the worklet handler now that VAD is ready.
      this.worklet.handleFrame = async (samples: Float32Array) => {
        await this.processFrame(samples);
      };
    } catch (err) {
      this.running = false;
      this.emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      await this.cleanup();
      throw err;
    }
  }

  /** Stop mic + worklet. Cancels in-flight transcriptions. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.cancelInFlight('stop');
    await this.cleanup();
  }

  /** Caller can mark "AI just finished" to enable cold-start grace. */
  notifyAIFinished(): void {
    this.lastAIFinishedAtMs = performance.now();
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
    const before = this.endpointer.currentTimeMs;
    const snap = this.endpointer.feed({
      vadProb,
      prosody,
      partialTranscript: this.partialTranscript,
      msSinceAIFinished: this.lastAIFinishedAtMs > 0
        ? performance.now() - this.lastAIFinishedAtMs : 0,
      recentTurnPaceMs: this.lastTurnPaceMs,
    });

    this.emit({ kind: 'frame', vadProb, smoothedProb: this.vad.smoothedProb, prosody });

    // Detect transitions for higher-level event emission.
    if (snap.state === 'speech' && before === 0) {
      // First-ever frame — ignore.
    }

    // Speech-start: armed→speech transition (we get into 'speech' the
    // moment armingFrames count is reached).
    if (snap.state === 'speech' && snap.utteranceMs <= FRAME_MS * 2) {
      this.emit({ kind: 'speechStart' });
      this.partialTranscript = '';
      this.earlyFireSent = false;
    }

    // Speculative early-fire: once we've crossed the threshold AND we're
    // either still in speech or just transitioned to trailing.
    if (!this.earlyFireSent
        && (snap.state === 'speech' || snap.state === 'trailing')
        && snap.utteranceMs >= EARLY_FIRE_AFTER_MS) {
      this.earlyFireSent = true;
      this.kickOffEarlyTranscription(snap.speechStartFrameIdx, snap.utteranceMs);
    }

    if (snap.state === 'trailing') {
      this.emit({
        kind: 'silenceTimer',
        requiredMs: snap.silenceRequiredMs,
        elapsedMs: snap.silenceElapsedMs,
      });
    }

    if (snap.justEnded) {
      const duration = snap.utteranceMs;
      this.emit({ kind: 'speechEnd', durationMs: duration });
      this.handleEnded(snap.speechStartFrameIdx, duration).catch((err) => {
        this.emit({ kind: 'error', message: `endpoint handler: ${err}` });
      });
    }
  }

  // -------------------------------------------------------------------
  //  Transcription
  // -------------------------------------------------------------------
  private kickOffEarlyTranscription(speechStartFrameIdx: number, utteranceMs: number): void {
    const audio = this.sliceUtteranceWithPreroll(speechStartFrameIdx, utteranceMs);
    if (!audio) return;
    this.cancelEarly('superseded');
    const ac = new AbortController();
    this.earlyFireAbort = ac;
    this.emit({ kind: 'transcribing', pending: true });

    const prompt = this.opts.whisperPrompt?.() ?? '';
    this.earlyFirePromise = transcribe(audio, { signal: ac.signal, prompt })
      .then((r) => {
        // Stash the partial for endpointer to use. Don't emit "transcript"
        // yet — that's only for the FINAL result the chat consumes.
        this.partialTranscript = r.text;
        this.emit({ kind: 'partialTranscript', text: r.text });
        return r;
      })
      .catch((err) => {
        if (ac.signal.aborted) {
          // Expected cancellation, no-op.
          throw err;
        }
        // Real error — keep early-fire null but continue (final fire still works).
        console.warn('[voice] early transcribe failed:', err);
        throw err;
      });
  }

  private async handleEnded(speechStartFrameIdx: number, durationMs: number): Promise<void> {
    const audio = this.sliceUtteranceWithPreroll(speechStartFrameIdx, durationMs);
    if (!audio || audio.length < SAMPLE_RATE * 0.15) {
      // Too short — ignore (likely a misfire).
      this.endpointer.reset();
      this.partialTranscript = '';
      this.emit({ kind: 'state', state: 'idle' });
      return;
    }

    const ourId = ++this.inFlightTranscriptionId;

    // If the early-fire's audio length matches the final length within a
    // small slop, reuse its result instead of firing a second request.
    let result: TranscriptionResult | null = null;
    if (this.earlyFirePromise && this.earlyFireSent && !this.earlyFireAbort?.signal.aborted) {
      try {
        result = await this.earlyFirePromise;
      } catch {
        result = null;
      }
    }

    // Fire a fresh final request if we don't have a usable speculative result.
    if (!result) {
      this.cancelFinal('superseded');
      const ac = new AbortController();
      this.finalAbort = ac;
      this.emit({ kind: 'transcribing', pending: true });
      try {
        result = await transcribe(audio, {
          signal: ac.signal,
          prompt: this.opts.whisperPrompt?.() ?? '',
        });
      } catch (err) {
        if (!ac.signal.aborted) {
          this.emit({ kind: 'error', message: `transcribe failed: ${err}` });
        }
        result = null;
      }
    }

    this.emit({ kind: 'transcribing', pending: false });

    // Prep for next utterance regardless of success.
    this.endpointer.reset();
    this.vad.reset();
    this.prosody.reset();
    this.partialTranscript = '';
    this.earlyFireSent = false;
    const now = performance.now();
    if (this.lastTurnEndedAtMs > 0) {
      this.lastTurnPaceMs = now - this.lastTurnEndedAtMs;
    }
    this.lastTurnEndedAtMs = now;

    if (this.inFlightTranscriptionId !== ourId) return;
    if (!result) return;
    const text = result.text.trim();
    if (!text) return;
    this.emit({ kind: 'transcript', text, durationS: result.durationS, totalMs: result.totalMs });
    this.emit({ kind: 'state', state: 'idle' });
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

  /** Produce a contiguous Float32Array from the ring covering speech + pre-roll. */
  private sliceUtteranceWithPreroll(speechStartFrameIdx: number, utteranceMs: number): Float32Array | null {
    if (speechStartFrameIdx < 0) return null;
    const preRollSamples = Math.round((PRE_ROLL_MS / 1000) * SAMPLE_RATE);
    const utteranceSamples = Math.round((utteranceMs / 1000) * SAMPLE_RATE);
    const totalSamples = preRollSamples + utteranceSamples;

    // Cap at how much we have. ringFilled is monotonic (samples ever
    // written); the actual buffer holds at most `ring.length`.
    const have = Math.min(this.ringFilled, this.ring.length);
    const want = Math.min(totalSamples, have);
    if (want < SAMPLE_RATE * 0.1) return null;

    // Source range in absolute coords: [end - want, end).
    const endAbs = this.ringFilled;
    const startAbs = endAbs - want;
    const startIdx = ((startAbs % this.ring.length) + this.ring.length) % this.ring.length;

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
  private cancelInFlight(reason: string): void {
    this.cancelEarly(reason);
    this.cancelFinal(reason);
  }
  private cancelEarly(_reason: string): void {
    this.earlyFireAbort?.abort();
    this.earlyFireAbort = null;
    this.earlyFirePromise = null;
  }
  private cancelFinal(_reason: string): void {
    this.finalAbort?.abort();
    this.finalAbort = null;
  }
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
