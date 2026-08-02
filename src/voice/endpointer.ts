// The "smart" turn-taking decision. Combines per-frame VAD probability
// and prosody features into a single signal: should we end the user's
// turn now?
//
// Most voice systems use a fixed silence timeout (e.g. 640 ms after
// VAD drops). That's wrong in two opposite directions:
//   - cuts off thoughtful pauses ("I want to..." → cut → user frustrated)
//   - dawdles on completed sentences ("hi" → 640 ms wait → feels laggy)
//
// We keep a base ~600 ms but ADJUST it every frame based on:
//   * Is the energy envelope flat-and-low (thinking pause)? +200
//   * Sharp amplitude drop after a high peak (decisive end)?  -150
//   * Is this a quick back-and-forth conversation?            -100
//   * First turn after the AI just finished?                  +200
//
// Net: 400 ms when confidently done, 800 ms when clearly mid-thought,
// 600 ms in ambiguous cases. A fixed-threshold system can't do this.

import {
  ENDPOINT_BASE_MS,
  ENDPOINT_MIN_MS,
  ENDPOINT_MAX_MS,
  ENDPOINT_THINKING_BONUS_MS,
  ENDPOINT_DECISIVE_END_BONUS_MS,
  ENDPOINT_RAPID_TURN_BONUS_MS,
  ENDPOINT_COLD_START_BONUS_MS,
  FRAME_MS,
  VAD_ACTIVATION_PROB,
  VAD_DEACTIVATION_PROB,
  VAD_ACTIVATION_FRAMES,
  MAX_UTTERANCE_MS,
  DEAD_BAND_TRAILING_FRAMES,
} from './constants';
import type { ProsodySnapshot } from './prosodyEngine';

export type EndpointerState = 'idle' | 'armed' | 'speech' | 'trailing' | 'ended';

export interface EndpointerInput {
  /** Speech probability for this frame from Silero, [0, 1]. */
  vadProb: number;
  /** Prosody features for this frame. */
  prosody: ProsodySnapshot;
  /** ms since the AI finished its previous reply. Used for cold-start grace. */
  msSinceAIFinished: number;
  /** Average ms-per-turn over the last few user turns. Faster = shorter wait. */
  recentTurnPaceMs: number;
}

export interface EndpointerSnapshot {
  state: EndpointerState;
  /** Currently-required trailing silence (ms) for the endpoint to fire. */
  silenceRequiredMs: number;
  /** Currently-elapsed trailing silence (ms). UI can show silenceRequired - silenceElapsed countdown. */
  silenceElapsedMs: number;
  /** ms since the speech segment started (or 0 if not in speech/trailing). */
  utteranceMs: number;
  /** True when the endpoint just fired this frame. Caller transitions out of trailing on next reset. */
  justEnded: boolean;
}

export class Endpointer {
  private state: EndpointerState = 'idle';
  private armingFrames = 0;
  private speechStartTimeMs = 0;
  private trailingStartTimeMs = 0;
  private currentMs = 0;
  private lastSilenceRequiredMs = ENDPOINT_BASE_MS;
  /** Consecutive frames in `speech` whose prob never reached ACTIVATION.
   *  Drives the dead-band escape — see DEAD_BAND_TRAILING_FRAMES. */
  private subActivationFrames = 0;

  reset(): void {
    this.state = 'idle';
    this.armingFrames = 0;
    this.speechStartTimeMs = 0;
    this.trailingStartTimeMs = 0;
    this.subActivationFrames = 0;
    this.lastSilenceRequiredMs = ENDPOINT_BASE_MS;
    // Note: currentMs is not reset — it's monotonic so timing math
    // (speech-start, trailing-start) stays valid across utterances.
  }

  /** Drives the state machine forward by one frame. */
  feed(input: EndpointerInput): EndpointerSnapshot {
    this.currentMs += FRAME_MS;

    // Always recompute the dynamic silence requirement so callers can
    // visualize it live (countdown bar) even before we hit trailing.
    const silenceRequiredMs = this.computeSilenceRequiredMs(input);
    this.lastSilenceRequiredMs = silenceRequiredMs;

    let justEnded = false;
    const above = input.vadProb >= VAD_ACTIVATION_PROB;
    const below = input.vadProb <= VAD_DEACTIVATION_PROB;

    switch (this.state) {
      case 'idle': {
        if (above) {
          this.armingFrames = 1;
          this.state = 'armed';
        }
        break;
      }
      case 'armed': {
        if (above) {
          this.armingFrames += 1;
          if (this.armingFrames >= VAD_ACTIVATION_FRAMES) {
            this.state = 'speech';
            this.speechStartTimeMs = this.currentMs - this.armingFrames * FRAME_MS;
          }
        } else {
          // Misfire: drop back to idle without firing onSpeechStart.
          this.state = 'idle';
          this.armingFrames = 0;
        }
        break;
      }
      case 'speech': {
        // Track how long we've gone without a confidently-speech frame.
        // A dip below ACTIVATION isn't enough to leave `speech` (that's
        // the hysteresis), but it must not be free either: without this
        // counter a probability parked in the (DEACTIVATION, ACTIVATION)
        // dead band holds `speech` open forever and the turn is never
        // delivered to the agent.
        if (above) this.subActivationFrames = 0;
        else this.subActivationFrames += 1;

        if (below || this.subActivationFrames >= DEAD_BAND_TRAILING_FRAMES) {
          this.state = 'trailing';
          // Anchor the trailing timer at the moment we actually stopped
          // hearing confident speech, not at the frame the dead-band
          // watchdog happened to trip. Otherwise the user pays for the
          // watchdog window twice: once waiting it out, then again on
          // the full silenceRequiredMs.
          this.trailingStartTimeMs =
            this.currentMs - this.subActivationFrames * FRAME_MS;
          this.subActivationFrames = 0;
        }
        // Force endpoint if we've been speaking continuously past the cap.
        if (this.currentMs - this.speechStartTimeMs >= MAX_UTTERANCE_MS) {
          this.state = 'ended';
          justEnded = true;
        }
        break;
      }
      case 'trailing': {
        if (above) {
          // User resumed — clear trailing, return to speech.
          this.state = 'speech';
          this.trailingStartTimeMs = 0;
          this.subActivationFrames = 0;
        } else {
          const elapsed = this.currentMs - this.trailingStartTimeMs;
          if (elapsed >= silenceRequiredMs) {
            this.state = 'ended';
            justEnded = true;
          }
        }
        break;
      }
      case 'ended': {
        // Caller is expected to call reset() after handling end.
        break;
      }
    }

    // Compute reported timings from the timestamp fields directly, NOT
    // gated on current state. At the exact frame `justEnded` fires we've
    // already transitioned to 'ended', so a state-gated computation
    // would zero out utteranceMs and silenceElapsedMs precisely when the
    // caller needs them (to slice the audio buffer correctly). The
    // timestamp fields still hold the correct values until reset().
    const silenceElapsedMs = this.trailingStartTimeMs > 0
      ? this.currentMs - this.trailingStartTimeMs : 0;
    const utteranceMs = this.speechStartTimeMs > 0
      ? this.currentMs - this.speechStartTimeMs : 0;

    return {
      state: this.state,
      silenceRequiredMs,
      silenceElapsedMs,
      utteranceMs,
      justEnded,
    };
  }

  /** What was the dynamic threshold at the most recent feed? UI can read this. */
  get currentSilenceRequiredMs(): number {
    return this.lastSilenceRequiredMs;
  }

  // --------------------------------------------------------------------
  // Adaptive scoring. Pure function of inputs; no side effects on `this`.
  // --------------------------------------------------------------------
  private computeSilenceRequiredMs(input: EndpointerInput): number {
    let ms = ENDPOINT_BASE_MS;

    // Envelope shape signals.
    //   Decisive end: peakToTail high (sharp drop) and not on a fricative.
    //   Thinking: low envelope decay, not riding into fricative either.
    if (input.prosody.peakToTailRatio > 0.7 && !input.prosody.endedOnFricative) {
      ms += ENDPOINT_DECISIVE_END_BONUS_MS;   // negative: shorter wait
    }
    if (Math.abs(input.prosody.envelopeDecay) < 0.15
        && input.prosody.rms < 0.04 && input.prosody.rms > 0.005) {
      // Hovering quietly (not silent, not loud) → user is thinking.
      ms += ENDPOINT_THINKING_BONUS_MS;
    }

    // Conversational pace. Quick back-and-forth = user wants snappy.
    // recentTurnPaceMs of 0 means we have no data yet → no adjustment.
    if (input.recentTurnPaceMs > 0 && input.recentTurnPaceMs < 4000) {
      ms += ENDPOINT_RAPID_TURN_BONUS_MS;     // negative
    }

    // Cold-start grace: first turn after AI finished, give the user
    // extra time to compose their thought.
    if (input.msSinceAIFinished > 0 && input.msSinceAIFinished < 2500) {
      ms += ENDPOINT_COLD_START_BONUS_MS;
    }

    return clamp(ms, ENDPOINT_MIN_MS, ENDPOINT_MAX_MS);
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
