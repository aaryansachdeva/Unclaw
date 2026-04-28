// Silero VAD v5 wrapper. Loads the ONNX model once and holds the recurrent
// state across `probe()` calls so we get continuous-time speech probability
// (not per-frame independent decisions).
//
// Model I/O (verified by inspecting the .onnx graph):
//   inputs:
//     input  : float32[B, T]    — raw audio at 16 kHz, T = 512 for v5
//     state  : float32[2, B, 128] — LSTM state, all-zeros to start
//     sr     : int64[]          — scalar 16000n
//   outputs:
//     output : float32[B, 1]    — speech probability in [0, 1]
//     stateN : float32[2, B, 128] — next LSTM state (feed back into `state`)
//
// Why we don't use @ricky0123/vad-web here:
//   - it bundles its own AudioWorklet, hard to compose with our ring buffer
//   - re-loads the model on every MicVAD.new(), so toggling voice mode
//     stutters; we want the session to live for the whole app session
//   - we want the same VAD prob feeding our endpointer + the visualizer,
//     not just callbacks at start/end of speech

import * as ort from 'onnxruntime-web';
import { FRAME_SIZE, SAMPLE_RATE, VAD_PROB_SMOOTH_ALPHA } from './constants';

// ORT 1.24 loads its wasm + glue-mjs files at runtime via dynamic import.
// Three different bundler workarounds all hit different walls:
//   - public/   -> Vite blocks dynamic import() of public files
//   - ?url     -> Vite served HTML fallback for the .wasm file
//   - subpath  -> ORT's `exports` field doesn't expose ./dist/*
// CDN sidesteps all of them. ORT loads its files directly from jsdelivr,
// no bundler involvement. Pinned version matches `package.json`.
//
// First run needs internet (Electron caches afterward). When we move to
// offline packaged builds, add `vite-plugin-static-copy` to copy the
// node_modules/onnxruntime-web/dist/* into the build output, then change
// this back to a local path.
const ORT_VERSION = '1.24.3';
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
// Single thread is fine for this model — it's tiny and runs every 32 ms.
// Multi-threading needs cross-origin-isolated headers which Electron /
// Vite dev don't ship by default, so leave it off.
ort.env.wasm.numThreads = 1;

const MODEL_URL = '/silero_vad.onnx';

let sessionPromise: Promise<ort.InferenceSession> | null = null;
function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  }
  return sessionPromise;
}

/** Pre-warm the model at app startup so the first mic toggle is instant. */
export async function preloadVAD(): Promise<void> {
  await getSession();
}

// Silero v5 was trained with a 64-sample CONTEXT prepended to every
// 512-sample frame. Without this prefix the model outputs near-zero
// probabilities forever regardless of audio level — the symptom we hit.
// Every working Silero v5 wrapper does this, including @ricky0123/vad-web.
const CONTEXT_SIZE = 64;
const MODEL_INPUT_SIZE = CONTEXT_SIZE + FRAME_SIZE;   // 64 + 512 = 576

export class SileroVAD {
  private session: ort.InferenceSession | null = null;
  private state: ort.Tensor;
  /** Last 64 samples of the previous frame; gets prepended to the next. */
  private prevTail: Float32Array;
  private readonly sr: ort.Tensor;
  /** Smoothed speech probability for visualizers. Raw value also exposed. */
  smoothedProb = 0;
  private debugged = false;

  constructor() {
    this.state = SileroVAD.zeroState();
    this.prevTail = new Float32Array(CONTEXT_SIZE);
    // Silero v5 wants `sr` as a rank-0 int64 scalar (graph dim list is `[]`).
    // Some ORT-web minor versions deserialize empty-shape tensors oddly; if
    // that ever bites us, fall back to shape `[1]` here.
    this.sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
  }

  /** Initialize the underlying ORT session. Cheap if preloadVAD ran first. */
  async init(): Promise<void> {
    if (!this.session) this.session = await getSession();
  }

  /** Reset recurrent state. Call at the end of an utterance / pause. */
  reset(): void {
    this.state = SileroVAD.zeroState();
    this.prevTail = new Float32Array(CONTEXT_SIZE);
    this.smoothedProb = 0;
  }

  /**
   * Run VAD on one frame and return speech probability.
   * Throws if `init()` wasn't awaited first.
   */
  async probe(frame: Float32Array): Promise<number> {
    if (!this.session) throw new Error('SileroVAD: call init() before probe()');
    if (frame.length !== FRAME_SIZE) {
      throw new Error(`SileroVAD: frame must be ${FRAME_SIZE} samples, got ${frame.length}`);
    }

    // Build the 576-sample model input: 64-sample context (last 64 of the
    // previous frame, zero on the very first call) + this frame's 512
    // samples. This is the missing piece that makes Silero v5 actually
    // produce non-zero probabilities on real speech.
    const inp = new Float32Array(MODEL_INPUT_SIZE);
    inp.set(this.prevTail, 0);
    inp.set(frame, CONTEXT_SIZE);
    // Stash the last 64 samples of THIS frame for the next probe. Slice
    // returns a fresh Float32Array so future writes to `frame` won't bleed
    // into our context buffer.
    this.prevTail = frame.slice(FRAME_SIZE - CONTEXT_SIZE);

    const input = new ort.Tensor('float32', inp, [1, MODEL_INPUT_SIZE]);
    const out = await this.session.run({
      input,
      state: this.state,
      sr: this.sr,
    });

    // One-shot diagnostic on the first call so we can verify I/O bindings.
    // Logs the actual returned keys, shapes, and a sample of values. If
    // the output is stuck at 0.00 for every frame, the cause is almost
    // always visible here (wrong output name, wrong shape, NaN, etc.).
    if (!this.debugged) {
      this.debugged = true;
      const outNames = Object.keys(out);
      const probData = out.output ? Array.from(out.output.data as Float32Array) : null;
      console.info('[vad] outputs:', outNames,
        'output.dims:', out.output?.dims,
        'output.data:', probData?.slice(0, 4),
        'stateN.dims:', (out.stateN as ort.Tensor | undefined)?.dims,
        'inputPeak:', Math.max(...Array.from(frame).map(Math.abs)).toFixed(3),
      );
    }

    // Roll forward the recurrent state. Defensive: if a future ORT/Silero
    // version renames the output, fall back to whichever 3D float tensor
    // showed up so the recurrent loop keeps working.
    const next = (out.stateN as ort.Tensor | undefined)
      ?? (Object.values(out).find(t => (t as ort.Tensor).dims?.length === 3) as ort.Tensor | undefined);
    if (next) {
      // CRITICAL: ort-web returns output tensors backed by WASM memory that
      // is reused on the next run() call. Reading the data later (or passing
      // the tensor back as input) gives stale/zero bytes, which collapses
      // VAD probability to near-0 regardless of input. Copy the data into
      // a fresh JS-owned buffer + tensor so the recurrent state survives.
      const data = new Float32Array((next.data as Float32Array).slice());
      this.state = new ort.Tensor('float32', data, next.dims);
    }

    // Same hazard applies to the output tensor — copy the single prob value
    // out before its backing memory gets reused on the next run().
    const probTensor = out.output as ort.Tensor | undefined;
    const prob = probTensor ? (probTensor.data as Float32Array)[0] : 0;
    // Cheap EMA so the visualizer doesn't flicker. Endpointer reads `prob`
    // directly — its own state machine handles smoothing semantically.
    this.smoothedProb = (1 - VAD_PROB_SMOOTH_ALPHA) * this.smoothedProb
                      + VAD_PROB_SMOOTH_ALPHA * prob;
    return prob;
  }

  private static zeroState(): ort.Tensor {
    return new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
  }
}
