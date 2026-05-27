// Qwen3-TTS install + status client. Soul exposes /tts/qwen3/* with
// the same shape as the Kokoro endpoints; the install state machine
// has more sub-phases (uv bootstrap → venv → deps → model → voice)
// because Qwen3 needs an isolated Python venv on top of the model
// download.
//
// The runtime model lives in a SEPARATE Python subprocess soul
// launches in the venv it creates during install — soul's express
// env can't host faster-qwen3-tts directly (transformers/torch
// version conflicts with kokoro-onnx + lipsync). Renderer doesn't
// need to know about the subprocess; it only sees the install +
// streaming endpoints.

import { getSoulBaseUrl } from './soulBase';

export type Qwen3State = 'idle' | 'downloading' | 'installed' | 'error';

/** Stages reported in the live install progress. The install panel
 *  renders each as a step with its own progress bar. */
export type Qwen3InstallPhase =
  | 'bootstrap_uv'
  | 'create_venv'
  | 'install_deps'
  | 'download_model'
  | 'download_voice';

export interface Qwen3Progress {
  bytes_done: number;
  bytes_total: number;
  phase: Qwen3InstallPhase;
  /** Free-text status detail (last log line, current pip target, etc.).
   *  Surfaced under the progress bar so the user sees something is
   *  happening even when bytes_total is unknown (uv pip install). */
  detail: string;
}

export interface Qwen3Status {
  state: Qwen3State;
  /** HuggingFace repo id used for the install. */
  model_id: string;
  /** Voice ids available on disk. Empty until install completes. */
  voices: string[];
  progress: Qwen3Progress | null;
  error: string | null;
  /** True when the local subprocess service is up + healthy. Soul
   *  lazy-launches it on first synth; this flag flips after the
   *  health probe succeeds. */
  service_running: boolean;
  service_port: number;
  /** Pre-install gates. The install panel checks these BEFORE
   *  enabling the Install button so users hit the disk / VRAM
   *  warning up front, not 4 GB into a torch download. */
  free_disk_gb: number;
  free_vram_gb: number;
  min_free_disk_gb: number;
  min_free_vram_gb: number;
}

/** GET /tts/qwen3/status. Cheap; renderer polls every 1.5s while a
 *  download is in flight, every ~30s otherwise. Throws on transport
 *  failure (soul down). */
export async function fetchQwen3Status(): Promise<Qwen3Status> {
  const res = await fetch(`${getSoulBaseUrl()}/tts/qwen3/status`);
  if (!res.ok) {
    throw new Error(`soul /tts/qwen3/status ${res.status}`);
  }
  return (await res.json()) as Qwen3Status;
}

/** POST /tts/qwen3/install. Idempotent — if already installed or in
 *  progress, returns the current snapshot without restarting. The
 *  renderer treats this as fire-and-forget and polls /status. */
export async function startQwen3Install(): Promise<Qwen3Status> {
  const res = await fetch(`${getSoulBaseUrl()}/tts/qwen3/install`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`soul /tts/qwen3/install ${res.status}`);
  }
  return (await res.json()) as Qwen3Status;
}

/** DELETE /tts/qwen3. Stops the subprocess + wipes data/qwen3/. Used
 *  by the account-reset flow + by users reclaiming disk. */
export async function uninstallQwen3(): Promise<boolean> {
  try {
    const res = await fetch(`${getSoulBaseUrl()}/tts/qwen3`, { method: 'DELETE' });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/** Curated voice catalog. Only one entry today (the Grace clone). When
 *  we ship more pre-baked voices, add them here in the order they
 *  should appear. The renderer uses the same shape as Kokoro's
 *  RECOMMENDED_VOICES so the picker code stays identical. */
export const RECOMMENDED_VOICES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'grace_qwen3', label: 'Grace' },
];

/** User-facing label for a Qwen3 voice id. Falls back to the id when
 *  we don't have a curated entry for it. */
export function labelForVoice(id: string): string {
  const found = RECOMMENDED_VOICES.find((v) => v.id === id);
  if (found) return found.label;
  return id;
}

/** Friendly stage label for the progress UI. The phase strings come
 *  straight from soul; we map to short copy that fits in a single
 *  step row. */
export function phaseLabel(phase: Qwen3InstallPhase): string {
  switch (phase) {
    case 'bootstrap_uv':    return 'Setting up package manager';
    case 'create_venv':     return 'Creating Python environment';
    case 'install_deps':    return 'Installing dependencies (PyTorch, etc.)';
    case 'download_model':  return 'Downloading Qwen3-TTS model (~1.2 GB)';
    case 'download_voice':  return 'Downloading Grace voice (~37 KB)';
    default:                return phase;
  }
}

/** Total stages the install panel should render — used to compute
 *  the "step N of M" indicator. Indexed by the order phases run. */
export const INSTALL_PHASES: Qwen3InstallPhase[] = [
  'bootstrap_uv',
  'create_venv',
  'install_deps',
  'download_model',
  'download_voice',
];
