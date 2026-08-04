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
export const ENDPOINT_THINKING_BONUS_MS = 200;       // flat envelope, low energy
export const ENDPOINT_DECISIVE_END_BONUS_MS = -150;  // sharp drop after high amplitude
export const ENDPOINT_RAPID_TURN_BONUS_MS = -100;    // fast back-and-forth
export const ENDPOINT_COLD_START_BONUS_MS = 200;     // first turn after AI finished

// Hard cap: any single utterance longer than this gets force-endpointed.
// Stops a stuck-mic situation from running forever.
export const MAX_UTTERANCE_MS = 30_000;

// Barge-in: while AI is speaking we keep the mic open, but make VAD harder
// to trip so streamed audio leaking through speakers doesn't fire it. Need
// a sustained, confident signal to interrupt.
export const BARGE_IN_PROB = 0.78;
export const BARGE_IN_FRAMES = 8;             // ~256 ms of strong speech

// How long the mic stays gated AFTER isAISpeaking() goes false.
//
// isAISpeaking is open-loop: App.tsx flips it true on dispatch and back
// false on a setTimeout sized from soul's reported duration (falling back
// to a flat 4 s when soul reports none). Nothing in the renderer observes
// actual playback — the audio is rendered by Unreal, one WebRTC hop away,
// and UE never reports "done" back. So the gate always closes a little
// early (dispatch→playback latency) and sometimes wildly early (the 4 s
// fallback on a 12 s reply). The tail the mic then hears is the avatar's
// own voice, which is exactly the "transcription picks up the agent" bug.
//
// A hangover can't fix a 4 s-vs-12 s mismatch, but it does cover the
// normal case: dispatch latency, speaker decay, and the AEC tail. Keep it
// short enough that a user answering immediately isn't clipped.
export const AI_SPEECH_TAIL_MS = 400;

// Dead-band escape hatch for the endpointer.
//
// VAD_ACTIVATION_PROB (0.55) and VAD_DEACTIVATION_PROB (0.40) leave an
// intentional hysteresis band: inside it the state machine holds, so a
// brief dip mid-word doesn't start the trailing timer. The bug is that
// `speech` has NO other exit — a probability that parks in (0.40, 0.55)
// keeps the turn open forever, and that band is precisely where room
// tone, breathing, and avatar bleed-through sit. The only escape was
// MAX_UTTERANCE_MS, i.e. half a minute.
//
// So: hold through the band briefly (real hysteresis), then give up and
// start trailing. This is the "hysteresis + watchdog" pairing from the
// openjarvis useSpeech VAD, adapted to Silero probabilities.
export const DEAD_BAND_TRAILING_FRAMES = 10;   // ~320 ms below activation

// Whisper API. Matches soul's /transcribe proxy contract. Resolved
// dynamically from the live HTTP port soul picked at boot (default 0 =
// OS picks); see services/soulBase for the source of truth.
import { getSoulBaseUrl } from '../services/soulBase';
export function getTranscribeUrl(): string {
  return `${getSoulBaseUrl()}/transcribe`;
}
export const WHISPER_LANGUAGE = 'en';   // 'auto' for multilingual
export const WHISPER_MODEL = 'whisper-large-v3-turbo';

// Anti-hallucination knobs. Whisper (Groq's turbo build especially)
// loves to fill near-silent audio with "Thank you." / "Thanks for
// watching." / "you", leftovers from its YouTube training data.
// Three layers of defense:
//   1. Peak-amplitude gate before sending. We use peak rather than RMS
//      because pause-heavy utterances ("uhh... ok then") average out
//      low even with real speech, and the cost of a false-skip on a
//      truly-silent call is much smaller than the cost of always
//      hallucinating "Thank you."
//   2. no_speech_prob from verbose_json: Whisper's own confidence
//      that a segment is non-speech. Combined-segment threshold.
//   3. Hallucination string set: known short outputs that almost
//      never come from real user speech.
export const MIN_UTTERANCE_PEAK = 0.04;        // ~ -28 dBFS peak, well above noise floor
export const MAX_NO_SPEECH_PROB = 0.6;         // segment-weighted average

// Lowercase + punctuation/whitespace stripped before comparison.
export const HALLUCINATION_TEXTS = new Set<string>([
  '',
  'you',
  'thank you',
  'thanks',
  'thanks for watching',
  'thank you for watching',
  'thank you for watching this video',
  'thank you so much',
  'thank you very much',
  'thanks for listening',
  'bye',
  'bye bye',
  'goodbye',
  'okay',
  'ok',
  'mhm',
  'mm',
  'mm hmm',
  'uh huh',
  'subtitles by the amaraorg community',
  'subtitles by the amara org community',
]);
