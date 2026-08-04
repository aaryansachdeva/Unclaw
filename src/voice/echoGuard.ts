// Content-based echo rejection: did we just transcribe the avatar's own voice?
//
// The timing gate in VoiceController (isAISpeaking + AI_SPEECH_TAIL_MS) is
// open-loop — nothing in the renderer observes actual playback, because the
// audio is rendered by Unreal one WebRTC hop away and UE never reports back.
// It therefore cannot be trusted, and worse, the barge-in detector actively
// OPENS that gate mid-reply: the avatar's leaked voice is confident speech,
// so ~256 ms of it trips BARGE_IN_FRAMES, App.tsx clears isAISpeakingRef,
// and the rest of the reply gets transcribed and sent back to the agent as
// if the user had said it. That is the loop this module breaks.
//
// The check is on CONTENT, not timing: we know exactly what the avatar is
// saying, so a transcript that echoes it is echo, whatever the clock says.
// Timing accuracy stops mattering.

/** Lowercase, strip punctuation, collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

/** Fraction of `candidate`'s tokens that appear in `reference`, counting
 *  multiplicity. 1.0 means every word the mic heard also occurs in what
 *  the avatar is saying. */
export function containmentRatio(candidate: string, reference: string): number {
  const cand = tokens(candidate);
  if (cand.length === 0) return 0;

  const pool = new Map<string, number>();
  for (const t of tokens(reference)) pool.set(t, (pool.get(t) ?? 0) + 1);

  let hits = 0;
  for (const t of cand) {
    const left = pool.get(t) ?? 0;
    if (left > 0) {
      pool.set(t, left - 1);
      hits += 1;
    }
  }
  return hits / cand.length;
}

/** Longest run of consecutive candidate tokens appearing verbatim, in order,
 *  inside the reference. Catches a clean echo of one phrase out of a long
 *  reply, where whole-transcript containment gets diluted. */
export function longestOrderedRun(candidate: string, reference: string): number {
  const cand = tokens(candidate);
  const ref = tokens(reference);
  if (cand.length === 0 || ref.length === 0) return 0;

  let best = 0;
  // O(n*m) on token counts — both are one utterance, so tiny.
  let prev = new Array<number>(ref.length + 1).fill(0);
  for (let i = 1; i <= cand.length; i++) {
    const cur = new Array<number>(ref.length + 1).fill(0);
    for (let j = 1; j <= ref.length; j++) {
      if (cand[i - 1] === ref[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

export interface EchoVerdict {
  isEcho: boolean;
  /** Human-readable reason, for the console. Empty when not echo. */
  reason: string;
}

// A transcript is echo when it is mostly made of the avatar's words, or
// when it reproduces a verbatim run of them.
//
// Thresholds are deliberately asymmetric by length. Short transcripts are
// where false positives hurt: "yes", "okay", "stop" are things a user
// genuinely says AND things the avatar says, so a 2-word overlap proves
// nothing. Requiring a longer verbatim run there keeps real short replies
// alive at the cost of letting a short echo through occasionally — the
// right trade, since a stray "okay" sent to the agent is recoverable and a
// swallowed "stop" is not.
const CONTAINMENT_THRESHOLD = 0.8;
const MIN_TOKENS_FOR_CONTAINMENT = 4;
const VERBATIM_RUN_TOKENS = 5;

export function detectEcho(transcript: string, aiSpeech: string): EchoVerdict {
  if (!transcript.trim() || !aiSpeech.trim()) {
    return { isEcho: false, reason: '' };
  }

  const candTokens = tokens(transcript).length;
  const contained = containmentRatio(transcript, aiSpeech);
  const run = longestOrderedRun(transcript, aiSpeech);

  if (candTokens >= MIN_TOKENS_FOR_CONTAINMENT && contained >= CONTAINMENT_THRESHOLD) {
    return {
      isEcho: true,
      reason: `${Math.round(contained * 100)}% of the words are the avatar's`,
    };
  }
  if (run >= VERBATIM_RUN_TOKENS) {
    return {
      isEcho: true,
      reason: `${run} consecutive words repeated verbatim from the avatar`,
    };
  }
  return { isEcho: false, reason: '' };
}
