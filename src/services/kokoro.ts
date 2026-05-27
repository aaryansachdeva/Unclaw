// Kokoro install + status client. Wraps soul's /tts/kokoro/* endpoints
// so the wizard can:
//   * show whether Kokoro is already installed (skip the download)
//   * trigger an install + poll for progress
//   * enumerate the voices available for the picker
//   * uninstall (used by the account-reset flow)
//
// Soul does the actual download + state tracking — this module is a
// thin transport layer.

import { getSoulBaseUrl } from './soulBase';

export type KokoroState = 'idle' | 'downloading' | 'installed' | 'error';

export interface KokoroProgress {
  bytes_done: number;
  bytes_total: number;
  /** Which file is currently being pulled. */
  phase: 'model' | 'voices';
}

export interface KokoroStatus {
  state: KokoroState;
  /** Pinned model release tag (e.g. 'v1.0'). Lets the renderer
   *  invalidate any cached UI when soul moves to a newer model. */
  model_version: string;
  model_path: string | null;
  voices_path: string | null;
  /** Voice ids available for the picker. Empty until installed. */
  voices: string[];
  progress: KokoroProgress | null;
  error: string | null;
  /** False when kokoro-onnx + misaki aren't importable from soul's
   *  python env. The wizard surfaces this distinctly from "model not
   *  downloaded" so the user knows whether to pip-install or download. */
  python_deps_ok: boolean;
}

/** GET /tts/kokoro/status. Throws on transport failure (soul down);
 *  returns the snapshot otherwise. The state machine ('idle' →
 *  'downloading' → 'installed' / 'error') is server-authoritative. */
export async function fetchKokoroStatus(): Promise<KokoroStatus> {
  const res = await fetch(`${getSoulBaseUrl()}/tts/kokoro/status`);
  if (!res.ok) {
    throw new Error(`soul /tts/kokoro/status ${res.status}`);
  }
  return (await res.json()) as KokoroStatus;
}

/** POST /tts/kokoro/install. Idempotent on the server side — if
 *  already installed or downloading, returns the current snapshot
 *  instead of starting a new download. The renderer should treat
 *  this as fire-and-forget and poll fetchKokoroStatus() to render
 *  progress. */
export async function startKokoroInstall(): Promise<KokoroStatus> {
  const res = await fetch(`${getSoulBaseUrl()}/tts/kokoro/install`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`soul /tts/kokoro/install ${res.status}`);
  }
  return (await res.json()) as KokoroStatus;
}

/** DELETE /tts/kokoro. Wipes the model + voices files from soul's
 *  data dir. Used by the account-reset flow + a manual uninstall
 *  button if/when we add one. Best-effort — returns true on 204 or
 *  404 (already gone). */
export async function uninstallKokoro(): Promise<boolean> {
  try {
    const res = await fetch(`${getSoulBaseUrl()}/tts/kokoro`, { method: 'DELETE' });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/** Curated default order for the voice picker — same set the soul
 *  side exposes first. Falls back to whatever voice list the server
 *  reports if these aren't all present. Kept here so the renderer
 *  can pre-render an enabled-looking dropdown before /status returns.
 *
 *  `grace_kokoro` is the KVoiceWalk-evolved clone of the ElevenLabs
 *  Grace voice; soul downloads it from files.fotonlabs.com alongside
 *  the bundled Kokoro voices.bin during install. Pinned to the top so
 *  Grace-persona users see "Grace (offline)" as the first option. */
export const RECOMMENDED_VOICES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'grace_kokoro', label: 'Grace' },
  { id: 'af_heart',    label: 'Heart (American · F)' },
  { id: 'af_bella',    label: 'Bella (American · F)' },
  { id: 'af_nicole',   label: 'Nicole (American · F)' },
  { id: 'af_sarah',    label: 'Sarah (American · F)' },
  { id: 'am_michael',  label: 'Michael (American · M)' },
  { id: 'am_adam',     label: 'Adam (American · M)' },
  { id: 'am_eric',     label: 'Eric (American · M)' },
  { id: 'bf_emma',     label: 'Emma (British · F)' },
  { id: 'bf_isabella', label: 'Isabella (British · F)' },
  { id: 'bm_george',   label: 'George (British · M)' },
  { id: 'bm_lewis',    label: 'Lewis (British · M)' },
];

/** Format a raw Kokoro voice id ('af_heart') into a friendlier label
 *  for the dropdown. Falls back to the id itself when we don't
 *  recognize the prefix. The server enumerates 50+ voices including
 *  Japanese, Chinese, Spanish, etc. — this just covers the curated
 *  English set with nice names. */
export function labelForVoice(id: string): string {
  const found = RECOMMENDED_VOICES.find((v) => v.id === id);
  if (found) return found.label;
  // Best-effort decode for non-curated voices: prefix → language/sex,
  // suffix → display name.
  const m = /^([a-z])([fm])_(.+)$/.exec(id);
  if (!m) return id;
  const [, lang, sex, name] = m;
  const langMap: Record<string, string> = {
    a: 'American', b: 'British', e: 'Spanish', f: 'French',
    h: 'Hindi', i: 'Italian', j: 'Japanese', p: 'Portuguese',
    z: 'Chinese',
  };
  const sexMap: Record<string, string> = { f: 'F', m: 'M' };
  const pretty = name.charAt(0).toUpperCase() + name.slice(1);
  return `${pretty} (${langMap[lang] ?? lang.toUpperCase()} · ${sexMap[sex] ?? sex})`;
}
