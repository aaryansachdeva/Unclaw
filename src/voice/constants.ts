// All tunable knobs for the voice pipeline. Documented here so the
// intent of each number is obvious and so changes don't get scattered.
//
// Defaults were chosen to balance "don't cut me off mid-thought" against
// "respond fast." See README in this folder for the design discussion.

// Audio
export const SAMPLE_RATE = 16_000;        // Silero requires 16 kHz mono
export const FRAME_SIZE = 512;            // 32 ms per frame at 16 kHz
export const FRAME_MS = 1000 * FRAME_SIZE / SAMPLE_RATE;  // 32

// Ring buffer for capture. 30 s of audio = 30 * 16 000 * 4 B = ~1.9 MB.
// Plenty for any reasonable utterance plus pre-roll plus barge-in window.
export const RING_BUFFER_SECONDS = 30;
export const RING_BUFFER_SAMPLES = SAMPLE_RATE * RING_BUFFER_SECONDS;

// VAD activation thresholds. Values are speech-probability cutoffs from
// Silero's [0, 1] output. Defaults skew slightly conservative to fight
// background noise, but not so high that quiet speech misses.
export const VAD_ACTIVATION_PROB = 0.55;       // start considering speech
export const VAD_DEACTIVATION_PROB = 0.40;     // start considering trailing
export const VAD_ACTIVATION_FRAMES = 3;        // ~96 ms of speech to confirm
export const VAD_PROB_SMOOTH_ALPHA = 0.5;      // EMA smoothing for visualizer

// Pre-roll. We start posting frames once VAD activates, but to capture
// the consonant onset the model needed to fire we include this much
// audio from BEFORE activation. Improves Whisper accuracy on first words.
export const PRE_ROLL_MS = 250;

// Endpointer base + adaptive adjustments (all in ms). Final required
// trailing silence is clamped to [MIN, MAX].
export const ENDPOINT_BASE_MS = 600;
export const ENDPOINT_MIN_MS = 300;
export const ENDPOINT_MAX_MS = 1500;
export const ENDPOINT_FILLER_PENALTY_MS = 400;       // ends in "uh"/"um"/"like"
export const ENDPOINT_INCOMPLETE_SYNTAX_PENALTY_MS = 250;  // ends in "the"/"and"/"to"...
export const ENDPOINT_THINKING_BONUS_MS = 200;       // flat envelope, low energy
export const ENDPOINT_DECISIVE_END_BONUS_MS = -150;  // sharp drop after high amplitude
export const ENDPOINT_RAPID_TURN_BONUS_MS = -100;    // fast back-and-forth
export const ENDPOINT_COLD_START_BONUS_MS = 200;     // first turn after AI finished

// Speculative early-fire. After this much confirmed speech, kick off a
// Whisper request with the audio so far (cancels and re-fires on continued
// speech). Effectively makes transcription happen in parallel with the
// final part of the utterance.
export const EARLY_FIRE_AFTER_MS = 1000;

// Hard cap: any single utterance longer than this gets force-endpointed.
// Stops a stuck-mic situation from running forever.
export const MAX_UTTERANCE_MS = 30_000;

// Barge-in: while AI is speaking we keep the mic open, but make VAD harder
// to trip so streamed audio leaking through speakers doesn't fire it. Need
// a sustained, confident signal to interrupt.
export const BARGE_IN_PROB = 0.78;
export const BARGE_IN_FRAMES = 8;             // ~256 ms of strong speech

// Filler / incomplete syntax word lists. Lowercased, last-word match.
export const FILLER_WORDS = new Set([
  'uh', 'um', 'er', 'erm', 'mm', 'mmm', 'hmm', 'like', 'so', 'and',
  'okay', 'right',
]);

// "Looks incomplete" tail words. Sentences rarely end on these.
export const INCOMPLETE_TAIL_WORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'on', 'in', 'at', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had',
  'i', 'you', 'we', 'they', 'he', 'she', 'it', 'my', 'your', 'our',
  'this', 'that', 'these', 'those',
  'because', 'but', 'or', 'if', 'when', 'while', 'as', 'than',
]);

// Whisper API. Matches the soul.exe /transcribe proxy contract.
export const TRANSCRIBE_URL = 'http://127.0.0.1:8765/transcribe';
export const WHISPER_LANGUAGE = 'en';   // 'auto' for multilingual
export const WHISPER_MODEL = 'whisper-large-v3-turbo';
