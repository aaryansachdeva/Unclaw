// Pre-generated onboarding audio clips. Three short Grace lines that
// play at fixed moments in the wizard:
//
//   * nice-to-meet-you   — after the user enters their name + Continue
//   * keys-wrong         — when Check Keys fails
//   * excited-to-start   — after Finish (replaces the LLM-generated
//                          /onboarding/greet so a shipped build doesn't
//                          burn an ElevenLabs synth on every save)
//
// The MP3s were synthesized once via ElevenLabs (Grace voice) and ship
// as static assets in `public/onboarding-audio/`. At runtime we POST
// the bytes to soul's `/generate` (audio-driven, no LLM, no TTS) so the
// MetaHuman lipsyncs and renders the matching mood — same UE dispatch
// path as a normal chat result, just without the LLM + TTS round-trip.
//
// Soul caches the lipsync result by JobId; the renderer hands the
// resulting `SoulChatResult` to `dispatchChatResult` (in App.tsx) and
// UE pulls `/result/{id}` like always.

import type { SoulChatResult } from './soulChat';

const SOUL_URL = 'http://127.0.0.1:8765';

export type PreGenLine = 'nice-to-meet-you' | 'keys-wrong' | 'excited-to-start';

/** Per-clip mood + behavior for the Text2Face pass. The mood prompt
 *  goes into soul's T2F so the face matches the line; the behavior
 *  enum picks the blink/gaze/posture preset on top of that. Mood
 *  phrasing is intentionally short — Text2Face was trained to render
 *  one clean feeling, not a stack of adjectives. */
const META: Record<PreGenLine, { mood: string; behavior: string }> = {
  'nice-to-meet-you': {
    mood: 'smile',
    behavior: 'engaged',
  },
  'keys-wrong': {
    mood: 'confused',
    behavior: 'thinking',
  },
  'excited-to-start': {
    mood: 'excited',
    behavior: 'excited',
  },
};

/** Read an MP3 blob into a base64 string (no data-URL prefix), suitable
 *  for soul's `audio_base64` field. FileReader is used so big files
 *  don't blow the call-stack via String.fromCharCode spread. */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== 'string') {
        reject(new Error('reader did not return a data URL'));
        return;
      }
      // r is "data:<mime>;base64,<payload>" — strip the prefix.
      const comma = r.indexOf(',');
      resolve(comma >= 0 ? r.slice(comma + 1) : r);
    };
    reader.readAsDataURL(blob);
  });
}

/** Drive UE to speak one of the pre-gen lines. Resolves to a
 *  `SoulChatResult`-shaped object the caller can hand to the existing
 *  `dispatchChatResult` (UE event + duration timer + barge-in glue).
 *
 *  Throws if soul is unreachable or the asset is missing — caller
 *  should treat that as best-effort and not block the user flow. */
export async function playPreGenAudio(line: PreGenLine): Promise<SoulChatResult> {
  // Vite serves `public/` at the renderer root in both dev and prod.
  const assetUrl = `/onboarding-audio/${line}.mp3`;
  const fetched = await fetch(assetUrl);
  if (!fetched.ok) {
    throw new Error(`onboarding audio missing: ${assetUrl} (${fetched.status})`);
  }
  const blob = await fetched.blob();
  const audio_base64 = await blobToBase64(blob);

  const meta = META[line];
  const res = await fetch(`${SOUL_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_base64,
      prompt: meta.mood,
      // Use the engine's current lipsync_model + face defaults; we
      // explicitly want the same face quality as a chat reply, not the
      // bare /generate defaults which lean conservative.
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`soul /generate ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;

  // Adapt to SoulChatResult so the same dispatchChatResult path that
  // handles real chat responses takes care of the UE event + the
  // speak-duration timer + voice-loop notifications.
  return {
    id:        String(data.id ?? ''),
    mood:      meta.mood,
    behavior:  meta.behavior,
    response:  '',
    duration:  typeof data.duration === 'number' ? data.duration : 3,
    n_frames:  typeof data.n_frames === 'number' ? data.n_frames : undefined,
    ...data,
  } as SoulChatResult;
}
