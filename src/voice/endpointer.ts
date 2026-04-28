// The "smart" turn-taking decision. Combines per-frame VAD probability,
// prosody features, and (when available) a partial Whisper transcript
// into a single signal: should we end the user's turn now?
//
// Most voice systems use a fixed silence timeout (e.g. 640 ms after
// VAD drops). That's wrong in two opposite directions:
//   - cuts off thoughtful pauses ("I want to..." → cut → user frustrated)
//   - dawdles on completed sentences ("hi" → 640 ms wait → feels laggy)
//
// We keep a base ~600 ms but ADJUST it every frame based on:
//   * Has the partial transcript ended in a filler word ("uh", "um")? +400
//   * Does it end mid-syntax ("the", "to", "and")? +250
//   * Is the energy envelope flat-and-low (thinking pause)? +200
//   * Sharp amplitude drop after a high peak (decisive end)? -150
//   * Is this a quick back-and-forth conversation? -100
//   * Or the first turn after the AI just finished? +200
//
// Net: 350 ms when confidently done, 1100+ ms when clearly mid-thought,
// 600 ms in ambiguous cases. A fixed-threshold system can't do this.

import {
  ENDPOINT_BASE_MS,
  ENDPOINT_MIN_MS,
  ENDPOINT_MAX_MS,
  ENDPOINT_FILLER_PENALTY_MS,
  ENDPOINT_INCOMPLETE_SYNTAX_PENALTY_MS,
  ENDPOINT_THINKING_BONUS_MS,
  ENDPOINT_DECISIVE_END_BONUS_MS,
  ENDPOINT_RAPID_TURN_BONUS_MS,
  ENDPOINT_COLD_START_BONUS_MS,
  FILLER_WORDS,
  INCOMPLETE_TAIL_WORDS,
  FRAME_MS,
  VAD_ACTIVATION_PROB,
  VAD_DEACTIVATION_PROB,
  VAD_ACTIVATION_FRAMES,
  MAX_UTTERANCE_MS,
} from './constants';
import type { ProsodySnapshot } from './prosodyEngine';

export type EndpointerState = 'idle' | 'armed' | 'speech' | 'trailing' | 'ended';

export interface EndpointerInput {
  /** Speech probability for this frame from Silero, [0, 1]. */
  vadProb: number;
  /** Prosody features for this frame. */
  prosody: ProsodySnapshot;
  /** Last-known partial Whisper transcript (or empty). Updated externally. */
  partialTranscript: string;
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
  /** Frame index of speech start (relative to ring buffer), -1 if not yet. */
  speechStartFrameIdx: number;
  /** True when the endpoint just fired this frame. Caller transitions out of trailing on next reset. */
  justEnded: boolean;
}

export class Endpointer {
  private state: EndpointerState = 'idle';
  private armingFrames = 0;
  private speechStartFrame = -1;
  private speechStartTimeMs = 0;
  private trailingStartTimeMs = 0;
  private currentMs = 0;
  private frameIdx = 0;
  private lastSilenceRequiredMs = ENDPOINT_BASE_MS;

  /** Caller increments this when actually feeding the frame. */
  get currentTimeMs(): number { return this.currentMs; }

  reset(): void {
    this.state = 'idle';
    this.armingFrames = 0;
    this.speechStartFrame = -1;
    this.speechStartTimeMs = 0;
    this.trailingStartTimeMs = 0;
    this.lastSilenceRequiredMs = ENDPOINT_BASE_MS;
    // Note: currentMs and frameIdx are not reset — they're monotonic.
  }

  /** Drives the state machine forward by one frame. */
  feed(input: EndpointerInput): EndpointerSnapshot {
    this.currentMs += FRAME_MS;
    this.frameIdx += 1;

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
            this.speechStartFrame = this.frameIdx - this.armingFrames;
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
        if (below) {
          this.state = 'trailing';
          this.trailingStartTimeMs = this.currentMs;
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

    const silenceElapsedMs = this.state === 'trailing'
      ? this.currentMs - this.trailingStartTimeMs : 0;
    const utteranceMs = (this.state === 'speech' || this.state === 'trailing')
      ? this.currentMs - this.speechStartTimeMs : 0;

    return {
      state: this.state,
      silenceRequiredMs,
      silenceElapsedMs,
      utteranceMs,
      speechStartFrameIdx: this.speechStartFrame,
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

    // 1. Filler-word ending → strong signal user isn't done thinking.
    const lastWord = lastTokenLower(input.partialTranscript);
    if (lastWord && FILLER_WORDS.has(lastWord)) {
      ms += ENDPOINT_FILLER_PENALTY_MS;
    } else if (lastWord && INCOMPLETE_TAIL_WORDS.has(lastWord)) {
      ms += ENDPOINT_INCOMPLETE_SYNTAX_PENALTY_MS;
    }

    // 2. Envelope shape signals.
    //    Decisive end: peakToTail high (sharp drop) and not on a fricative.
    //    Thinking: low envelope decay, not riding into fricative either.
    if (input.prosody.peakToTailRatio > 0.7 && !input.prosody.endedOnFricative) {
      ms += ENDPOINT_DECISIVE_END_BONUS_MS;   // negative: shorter wait
    }
    if (Math.abs(input.prosody.envelopeDecay) < 0.15
        && input.prosody.rms < 0.04 && input.prosody.rms > 0.005) {
      // Hovering quietly (not silent, not loud) → user is thinking.
      ms += ENDPOINT_THINKING_BONUS_MS;
    }

    // 3. Conversational pace. Quick back-and-forth = user wants snappy.
    //    recentTurnPaceMs of 0 means we have no data yet → no adjustment.
    if (input.recentTurnPaceMs > 0 && input.recentTurnPaceMs < 4000) {
      ms += ENDPOINT_RAPID_TURN_BONUS_MS;     // negative
    }

    // 4. Cold-start grace: first turn after AI finished, give the user
    //    extra time to compose their thought.
    if (input.msSinceAIFinished > 0 && input.msSinceAIFinished < 2500) {
      ms += ENDPOINT_COLD_START_BONUS_MS;
    }

    return clamp(ms, ENDPOINT_MIN_MS, ENDPOINT_MAX_MS);
  }
}

function lastTokenLower(s: string): string {
  if (!s) return '';
  // Strip trailing punctuation so we get the actual word.
  const trimmed = s.replace(/[.,!?;:"'()\[\]\s]+$/g, '').trim();
  if (!trimmed) return '';
  const m = trimmed.match(/[\p{L}\p{N}']+$/u);
  return m ? m[0].toLowerCase() : '';
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
