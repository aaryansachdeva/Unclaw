// Prosody features the endpointer fuses with VAD:
//
//   - RMS envelope shape over the last ~1 s. Tells us whether the speaker
//     is winding down (smooth taper), stopped decisively (sharp drop),
//     or hovering low (thinking pause).
//   - Zero-crossing rate trend. End on low ZCR (vowel) is more often a
//     real end than ending mid-fricative (high ZCR like "sss").
//   - Peak-to-tail ratio. Decisive endings have a clear high-amplitude
//     peak followed by a clean drop; rambling endings don't.
//
// We deliberately skip pitch tracking in v1 — YIN autocorrelation is
// surprisingly expensive in JS and the envelope+ZCR pair already gives
// most of the signal. Easy to add later if telemetry says it's needed.

import { FRAME_MS } from './constants';

const ENVELOPE_WINDOW_MS = 1000;
const ENVELOPE_SLOTS = Math.ceil(ENVELOPE_WINDOW_MS / FRAME_MS);  // ~31 slots

export interface ProsodySnapshot {
  /** RMS of this frame, [0, 1] (most speech sits 0.05–0.3). */
  rms: number;
  /** Zero-crossing count this frame, normalized by frame size. */
  zcr: number;
  /**
   * Envelope-decay signal in [-1, +1].
   *   ~ +1: amplitude is rising / sustaining (speaker is on a roll)
   *   ~  0: flat (steady or paused-flat)
   *   ~ -1: dropping fast (speaker is wrapping up)
   * Computed as a simple slope of recent RMS values, smoothed and clipped.
   */
  envelopeDecay: number;
  /**
   * Peak-to-tail ratio in [0, 1]: how much louder the *peak* of the last
   * second was vs the *tail* (last few frames). Values near 1 mean a
   * decisive trail-off; values near 0 mean the speaker is still loud.
   */
  peakToTailRatio: number;
  /** True if the last frame was likely a fricative (high ZCR + low RMS). */
  endedOnFricative: boolean;
}

export class ProsodyEngine {
  private rmsHistory: number[] = [];   // ring of recent RMS values
  private rmsIdx = 0;

  constructor() {
    this.rmsHistory = new Array(ENVELOPE_SLOTS).fill(0);
  }

  reset(): void {
    this.rmsHistory.fill(0);
    this.rmsIdx = 0;
  }

  /**
   * Consume one 32 ms frame and produce updated prosody features.
   * Cost: O(FRAME_SIZE + ENVELOPE_SLOTS) = ~540 ops per call. Negligible.
   */
  feed(frame: Float32Array): ProsodySnapshot {
    // -- RMS + ZCR in a single pass -------------------------------------
    let sumSq = 0;
    let zc = 0;
    let prev = frame[0];
    for (let i = 1; i < frame.length; i++) {
      const v = frame[i];
      sumSq += v * v;
      // Sign change = zero crossing (with a small dead-band to ignore
      // sub-audible noise wiggle around 0).
      if ((prev >= 0.001 && v < -0.001) || (prev <= -0.001 && v > 0.001)) zc++;
      prev = v;
    }
    const rms = Math.sqrt(sumSq / frame.length);
    const zcr = zc / frame.length;

    // -- Update RMS ring ------------------------------------------------
    this.rmsHistory[this.rmsIdx] = rms;
    this.rmsIdx = (this.rmsIdx + 1) % this.rmsHistory.length;

    // -- Envelope decay: slope of last ~300 ms of RMS over its own peak -
    // We measure the linear slope of the last N RMS values, normalize by
    // the window's peak, and clip. Negative slope = decay, positive = rise.
    const TAIL = Math.min(this.rmsHistory.length, 10);  // ~320 ms tail
    let peak = 0;
    let s = 0;
    for (let k = 0; k < TAIL; k++) {
      const idx = (this.rmsIdx - 1 - k + this.rmsHistory.length) % this.rmsHistory.length;
      const v = this.rmsHistory[idx];
      if (v > peak) peak = v;
      // Newer samples (small k) get more weight, older samples less. Slope-ish.
      s += (TAIL / 2 - k) * v;
    }
    const slope = TAIL > 0 ? s / (peak * TAIL * TAIL / 2 + 1e-6) : 0;
    const envelopeDecay = clamp(-slope, -1, 1);

    // -- Peak-to-tail: how much louder peak was vs current frame -------
    const peakToTailRatio = peak > 1e-4 ? clamp(1 - rms / peak, 0, 1) : 0;

    // -- Fricative-end heuristic ---------------------------------------
    // Fricatives ("sss", "fff", "shh") have very high ZCR and low RMS.
    const endedOnFricative = zcr > 0.25 && rms > 0.005 && rms < 0.05;

    return { rms, zcr, envelopeDecay, peakToTailRatio, endedOnFricative };
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
