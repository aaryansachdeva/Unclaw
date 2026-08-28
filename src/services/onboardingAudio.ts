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

import { getSoulBaseUrl } from './soulBase';

export type PreGenLine =
  | 'welcome'
  | 'nice-to-meet-you'
  | 'keys-wrong'
  | 'excited-to-start';

/** Per-clip mood + behavior for the Text2Face pass. The mood prompt
 *  goes into soul's T2F so the face matches the line; the behavior
 *  enum picks the blink/gaze/posture preset on top of that. Mood
 *  phrasing is intentionally short — Text2Face was trained to render
 *  one clean feeling, not a stack of adjectives. */
const META: Record<PreGenLine, { mood: string; behavior: string }> = {
  'welcome': {
    mood: 'slight smile',
    behavior: 'engaged',
  },
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

/** Live onboarding line via soul's /speak: verbatim text, rendered with
 *  the LOCAL Pocket engine and Grace's cloned voice. This is what makes
 *  personalized lines ("Nice to meet you, Aryan") possible before any
 *  BYOK key exists: Pocket is keyless and its weights ship with the
 *  install, so live synthesis works from the very first wizard step.
 *  The pre-gen MP3s below remain as the fallback when soul or the voice
 *  engine is unavailable. */
export async function speakLiveLine(
  line: PreGenLine,
  text: string,
): Promise<SoulChatResult> {
  const meta = META[line];
  const res = await fetch(`${getSoulBaseUrl()}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: text,
      mood: meta.mood,
      behavior: meta.behavior,
      tts_provider: 'pocket',
      voice_id: 'grace',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`speak ${res.status}`);
  return (await res.json()) as SoulChatResult;
}

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
  // RELATIVE path (`./`), not absolute (`/`). Vite serves `public/` at
  // the renderer root in dev (so `/onboarding-audio/...` works), but in
  // packaged Electron the renderer loads via `file://` and a leading
  // `/` resolves to the FILESYSTEM root (e.g. `file:///C:/onboarding-
  // audio/welcome.mp3` — not what we want). `./onboarding-audio/...`
  // resolves relative to `index.html` in both contexts. The audio MP3s
  // are siblings of index.html in the build output, so this lands them.
  const assetUrl = `./onboarding-audio/${line}.mp3`;
  const fetched = await fetch(assetUrl);
  if (!fetched.ok) {
    throw new Error(`onboarding audio missing: ${assetUrl} (${fetched.status})`);
  }
  const blob = await fetched.blob();
  const audio_base64 = await blobToBase64(blob);

  const meta = META[line];
  const res = await fetch(`${getSoulBaseUrl()}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_base64,
      // Empty prompt = soul does lipsync-only, no Text2Face overlay.
      // Pre-gen lines deliberately skip the mood-driven face animation:
      // the audio is fixed copy that doesn't need a generated facial
      // expression riding on top. The face stays at its neutral base
      // pose; only the mouth moves with the audio. The per-clip mood
      // in META is still used downstream for the renderer-side
      // bookkeeping (Turn metadata, etc.).
      prompt: '',
      // Use the engine's current lipsync_model + face defaults; we
      // explicitly want the same lipsync quality as a chat reply.
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
