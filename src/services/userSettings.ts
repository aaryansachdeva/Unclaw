// User settings — schemaless JSON blob, single source of truth across
// soul (local FastAPI) + the unclaw-api Cloudflare Worker.
//
// Design notes:
//   * One object per user. Profile, vibe sliders, agent_name, interests,
//     and any future feature toggles / UI prefs all live as top-level
//     keys in the same blob. Adding a setting is a TS edit, not a DB
//     migration.
//   * Soul (127.0.0.1:8765) is the read path the LLM consults on every
//     /chat call (auto-injected into the system prompt). Cloud is the
//     cross-device source of truth.
//   * The reconciler (`syncSettings`) runs at sign-in: cloud wins when
//     present; soul migrates up when cloud is empty; wizard fires when
//     both sides are empty. Cloud writes round-trip a `version` so a
//     stale write fails loudly with a 409 instead of clobbering a
//     sibling device's edit.
//
// This module replaces the old `services/profile.ts`. Everything that
// previously consumed `UserProfile` should switch to `UserSettings`.

import type { SoulChatResult } from './soulChat';

const SOUL_URL = 'http://127.0.0.1:8765';
const CLOUD_URL = 'https://unclaw-api.aryansachdeva1999.workers.dev';

export type UserSchedule = 'early_bird' | 'night_owl' | 'mixed';

/** Canonical user-settings shape. The Worker treats this as opaque JSON
 *  (validates only structural constraints: object, < 32 KB, valid JSON);
 *  soul's Pydantic model accepts unknown keys via `extra="allow"`.
 *  TypeScript is the schema authority — adding a setting is a one-place
 *  change here. Future fields (UI prefs, feature toggles, voice
 *  preferences) should live as top-level keys or grouped sub-objects
 *  (e.g. `ui: {chatPaneWidth: ...}`). */
export interface UserSettings {
  /** Required. Wizard fires when this is missing. */
  name: string;
  pronouns?: string | null;
  city?: string | null;
  timezone?: string | null;
  /** Custom name the user picked for their assistant. Empty/null leaves
   *  the default persona name (Grace) flowing through unchanged. */
  agent_name?: string | null;
  vibe_formality?: number | null;
  vibe_humor?: number | null;
  vibe_directness?: number | null;
  vibe_verbosity?: number | null;
  interests?: string[] | null;
  work?: string | null;
  schedule?: UserSchedule | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** Allow any future top-level setting without a Pydantic edit. */
  [k: string]: unknown;
}

// ---- Soul (local) ---------------------------------------------------

/** GET /user_settings — null when nothing has been saved yet. The wizard
 *  uses null as the trigger to mount on app start. */
export async function fetchSettings(): Promise<UserSettings | null> {
  const res = await fetch(`${SOUL_URL}/user_settings`);
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`soul /user_settings GET ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data === null ? null : (data as UserSettings);
}

/** PUT /user_settings — full replace. Used by the wizard's Finish button. */
export async function saveSettings(settings: UserSettings): Promise<UserSettings> {
  const res = await fetch(`${SOUL_URL}/user_settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`soul /user_settings PUT ${res.status}: ${err.slice(0, 200)}`);
  }
  return (await res.json()) as UserSettings;
}

/** PATCH /user_settings — shallow merge for inline tweaks. */
export async function patchSettings(
  updates: Partial<UserSettings>,
): Promise<UserSettings> {
  const res = await fetch(`${SOUL_URL}/user_settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`soul /user_settings PATCH ${res.status}: ${err.slice(0, 200)}`);
  }
  return (await res.json()) as UserSettings;
}

/** DELETE /user_settings — wipes the row entirely. Used by the reset flow.
 *  After this resolves, the next /user_settings GET returns null and
 *  the wizard fires in firstRun mode. */
export async function deleteSettings(): Promise<void> {
  const res = await fetch(`${SOUL_URL}/user_settings`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`soul /user_settings DELETE ${res.status}: ${err.slice(0, 200)}`);
  }
}

// ---- Onboarding helpers (unchanged from the old profile module) -----

/** POST /onboarding/welcome — fixed welcome line on wizard mount. */
export async function fetchOnboardingWelcome(): Promise<SoulChatResult> {
  const res = await fetch(`${SOUL_URL}/onboarding/welcome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(
      `soul /onboarding/welcome ${res.status}: ${err.slice(0, 200)}`,
    );
  }
  return (await res.json()) as SoulChatResult;
}

/** POST /onboarding/greet — personalized first greeting after settings save. */
export async function fetchOnboardingGreet(
  systemExtension?: string,
): Promise<SoulChatResult> {
  const res = await fetch(`${SOUL_URL}/onboarding/greet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      systemExtension ? { system_extension: systemExtension } : {},
    ),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(
      `soul /onboarding/greet ${res.status}: ${err.slice(0, 200)}`,
    );
  }
  return (await res.json()) as SoulChatResult;
}

// ---- Vibe helpers ---------------------------------------------------

const VIBE_BRACKETS = {
  formality:  ['casual',  'friendly', 'cordial',  'formal'],
  humor:      ['dry',     'wry',      'warm',     'playful'],
  directness: ['gentle',  'honest',   'direct',   'blunt'],
  verbosity:  ['brief',   'measured', 'detailed', 'thorough'],
} as const;

export type VibeSlider = keyof typeof VIBE_BRACKETS;

/** Map an int 0..100 to one of four bracket words. Mirrors the soul-side
 *  `_vibe_word` so live preview + saved-settings rendering stay in sync. */
export function vibeWord(slider: VibeSlider, value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const bracket = Math.min(3, Math.floor(v / 25)) as 0 | 1 | 2 | 3;
  return VIBE_BRACKETS[slider][bracket];
}

/** Defaults match the wizard's initial slider position. Slight casual /
 *  dry / gentle / brief lean — feels human, not chirpy. */
export const DEFAULT_VIBE = {
  vibe_formality:  35,
  vibe_humor:      35,
  vibe_directness: 35,
  vibe_verbosity:  35,
} as const;

// =====================================================================
// Cloud (Worker) settings — auth-gated, cross-device source of truth.
// =====================================================================

/** What the Worker returns on GET /user_settings: the JSON object plus
 *  metadata (version + timestamps). The version threads back into the
 *  next write as `expected_version` so a stale write fails loudly with
 *  a 409 instead of silently clobbering a sibling device. */
export interface CloudSettingsRecord {
  settings: UserSettings;
  version: number;
  created_at: string;
  updated_at: string;
}

/** GET /user_settings from the Worker. Returns null when no row is
 *  saved yet, or when the token has expired (caller should re-auth). */
export async function fetchCloudSettings(token: string): Promise<CloudSettingsRecord | null> {
  const res = await fetch(`${CLOUD_URL}/user_settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`cloud /user_settings GET ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = (await res.json()) as { settings: CloudSettingsRecord | null };
  return data.settings;
}

export interface PushCloudResult {
  /** Server's authoritative record AFTER the write succeeds. */
  record: CloudSettingsRecord;
}

/** PUT /user_settings on the Worker. When `expectedVersion` is provided and
 *  doesn't match the row's current version on the server, throws a
 *  ConflictError carrying the server's current record so the caller
 *  can prompt the user / merge / retry. Used by saveSettingsEverywhere
 *  on the wizard-save path AND by syncSettings on the soul→cloud
 *  migration when a returning user signs in for the first time. */
export async function pushCloudSettings(
  token: string,
  settings: UserSettings,
  expectedVersion?: number,
): Promise<PushCloudResult> {
  const body: Record<string, unknown> = { settings };
  if (typeof expectedVersion === 'number') body.expected_version = expectedVersion;
  const res = await fetch(`${CLOUD_URL}/user_settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    const data = (await res.json().catch(() => ({}))) as {
      current?: CloudSettingsRecord;
    };
    throw new ConflictError('cloud version conflict', data.current ?? null);
  }
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`cloud /user_settings PUT ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = (await res.json()) as { settings: CloudSettingsRecord };
  return { record: data.settings };
}

/** DELETE /user_settings on the Worker. Best-effort — the caller is the
 *  account-reset flow, which proceeds regardless of cloud success so
 *  the user isn't blocked when their network is down. */
export async function deleteCloudSettings(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${CLOUD_URL}/user_settings`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/** 409 escape hatch — caller can inspect `current` to merge + retry. */
export class ConflictError extends Error {
  constructor(message: string, public current: CloudSettingsRecord | null) {
    super(message);
    this.name = 'ConflictError';
  }
}

// =====================================================================
// Reconciliation — runs after sign-in to align cloud + soul.
// =====================================================================

/** Pull cloud + local settings in parallel, decide which (if either) is
 *  authoritative, mirror it to the other side, return the canonical
 *  settings (or null when both sides are empty — wizard fires).
 *
 *  Rules:
 *    * Cloud has data: it wins. Mirror to soul if soul is missing OR
 *      out of date (different updated_at).
 *    * Cloud empty, soul has data: this is a returning pre-cloud user
 *      signing in for the first time. Push their existing local
 *      settings up to the cloud as a one-shot migration.
 *    * Both empty: return null. App will trigger the wizard. */
export async function syncSettings(token: string): Promise<UserSettings | null> {
  const [cloud, local] = await Promise.all([
    fetchCloudSettings(token).catch((err) => {
      console.warn('[settings] cloud fetch failed during sync', err);
      return null;
    }),
    fetchSettings().catch((err) => {
      console.warn('[settings] local fetch failed during sync', err);
      return null;
    }),
  ]);

  if (cloud) {
    if (!local || local.updated_at !== cloud.settings.updated_at) {
      try {
        await saveSettings(cloud.settings);
      } catch (err) {
        console.warn('[settings] mirror cloud→soul failed', err);
      }
    }
    return cloud.settings;
  }

  if (local) {
    try {
      await pushCloudSettings(token, local);
    } catch (err) {
      console.warn('[settings] migration soul→cloud failed', err);
    }
    return local;
  }

  return null;
}

/** Save settings to soul (always) and push to cloud (best-effort when
 *  a token is present). Used by the wizard's Finish button so a single
 *  user action lands in both layers. Cloud failure is swallowed — soul
 *  is the read path that matters for the LLM, and the next sync will
 *  re-mirror. Cloud writes are blind (no expected_version) here because
 *  the wizard is a "user explicitly committed these values" gesture;
 *  granular inline edits should use `pushCloudSettings` directly with
 *  the version returned from the previous fetch. */
export async function saveSettingsEverywhere(
  settings: UserSettings,
  token: string | null,
): Promise<UserSettings> {
  const saved = await saveSettings(settings);
  if (token) {
    try {
      await pushCloudSettings(token, saved);
    } catch (err) {
      console.warn('[settings] cloud push failed (will retry on next sync)', err);
    }
  }
  return saved;
}
