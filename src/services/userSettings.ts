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
//   * The reconciler (`reconcileForAccount`) runs at sign-in: it scopes the
//     machine's local state to the signing-in account — cloud wins when
//     present; the account's own local-only settings migrate up; a stale
//     profile from a DIFFERENT account is wiped (not inherited); wizard fires
//     when the account has nothing. Cloud writes round-trip a `version` so a
//     stale write fails loudly with a 409 instead of clobbering a sibling
//     device's edit.
//
// This module replaces the old `services/profile.ts`. Everything that
// previously consumed `UserProfile` should switch to `UserSettings`.

import type { SoulChatResult } from './soulChat';
import type { AgentInstance } from '../hooks/useAgentStack';

import { getSoulBaseUrl } from './soulBase';
const CLOUD_URL = 'https://api.unclaw.io';

export type UserSchedule = 'early_bird' | 'night_owl' | 'mixed';

/** Canonical user-settings shape. The Worker treats this as opaque JSON
 *  (validates only structural constraints: object, < 32 KB, valid JSON);
 *  soul's Pydantic model accepts unknown keys via `extra="allow"`.
 *  TypeScript is the schema authority — adding a setting is a one-place
 *  change here. Future fields (UI prefs, feature toggles, voice
 *  preferences) should live as top-level keys or grouped sub-objects
 *  (e.g. `ui: {chatPaneWidth: ...}`). */
/** First name only. Google/Gmail sign-in hands us the full name
 *  ("Aryan Sachdeva"); we address the user by first name everywhere
 *  (greeting + Grace's voice via the synced profile). Splits on
 *  whitespace, keeps the first token. Safe on null/empty/single-word. */
export function firstName(full: string | null | undefined): string {
  return (full ?? '').trim().split(/\s+/)[0] ?? '';
}

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
  /** Saved outfit + lighting for wardrobe mode. Indices are bounded to
   *  the UE-side asset list (see WARDROBE_BOUNDS in components/Wardrobe).
   *  Lighting angle is 0-360 degrees. Null/missing = use UE defaults. */
  wardrobe?: WardrobeSettings | null;
  /** The user's character roster — every added/renamed instance plus each
   *  instance's saved outfit (AgentInstance.wardrobe). Historically machine-
   *  local; now folded into the cloud blob so the whole setup (everything
   *  except API keys, which stay device-local secrets) follows the account
   *  across devices. Soul persists it via extra="allow" but NEVER injects it
   *  into the LLM prompt — `_user_settings_summary` only renders the known
   *  profile fields, so this stays prompt-invisible. */
  roster?: AgentInstance[] | null;
  /** Allow any future top-level setting without a Pydantic edit. */
  [k: string]: unknown;
}

/** Wardrobe is a sub-object so all related state lives under one key
 *  and partial updates (changing only lighting, say) are a single
 *  `patchSettings({ wardrobe: {...prev, lightingAngle: x} })` call. */
/** Per-garment two-tone color, stored as indices into the curated
 *  CLOTHING_COLORS palette (see CustomizationOverlay). c1 = primary
 *  (diffuse_color_1), c2 = secondary (diffuse_color_2). */
export interface ClothingColor {
  c1: number;
  c2: number;
  /** Optional freeform hex overrides ('#rrggbb') chosen via the color picker.
   *  When set, the hex wins over the palette index for that slot; unset = the
   *  palette preset at c1/c2. Additive so existing index-only data still works. */
  c1Hex?: string;
  c2Hex?: string;
}

export interface WardrobeSettings {
  topIndex?: number;
  bottomIndex?: number;
  shoesIndex?: number;
  hairIndex?: number;
  lightingAngle?: number;
  /** Index into the curated accent-lighting palette (see ACCENT_COLORS
   *  in components/Wardrobe). 0 = neutral default. */
  accentColorIndex?: number;
  /** Optional freeform hex override for the accent/lighting color, set via the
   *  color picker. When present it wins over accentColorIndex. */
  accentColorHex?: string;
  /** Per-category garment colors. Only the colorable categories
   *  (top/bottom/shoes) appear; absent = palette default. */
  clothingColors?: Partial<Record<'top' | 'bottom' | 'shoes', ClothingColor>>;
}

// ---- Soul (local) ---------------------------------------------------

/** GET /user_settings — null when nothing has been saved yet. The wizard
 *  uses null as the trigger to mount on app start. */
export async function fetchSettings(): Promise<UserSettings | null> {
  const res = await fetch(`${getSoulBaseUrl()}/user_settings`);
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`soul /user_settings GET ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data === null ? null : (data as UserSettings);
}

/** PUT /user_settings — full replace. Used by the wizard's Finish button. */
export async function saveSettings(settings: UserSettings): Promise<UserSettings> {
  const res = await fetch(`${getSoulBaseUrl()}/user_settings`, {
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
  const res = await fetch(`${getSoulBaseUrl()}/user_settings`, {
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
  const res = await fetch(`${getSoulBaseUrl()}/user_settings`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`soul /user_settings DELETE ${res.status}: ${err.slice(0, 200)}`);
  }
}

// ---- Onboarding helpers (unchanged from the old profile module) -----

/** Build the BYOK fields shared by both onboarding endpoints. The wizard's
 *  pick (provider, key, voice) must drive every TTS render — no env
 *  fallbacks on the soul side, so an empty body would 400. Caller is
 *  expected to have already prompted for the keys (or be deep enough
 *  in the wizard that they exist). */
async function _onboardingBodyFromKeys(): Promise<Record<string, unknown>> {
  const { fetchApiKeys } = await import('./apiKeys');
  const keys = await fetchApiKeys();
  const body: Record<string, unknown> = {
    tts_provider: keys.tts_provider,
    voice_id:
      keys.tts_provider === 'kokoro'     ? keys.kokoro_voice :
      keys.tts_provider === 'qwen3'      ? keys.qwen3_voice :
      keys.tts_provider === 'elevenlabs' ? keys.elevenlabs_voice :
      undefined,
  };
  if (keys.tts_provider === 'elevenlabs' && keys.elevenlabs_api_key) {
    body.elevenlabs_api_key = keys.elevenlabs_api_key;
  }
  if (keys.tts_provider === 'kokoro' && keys.kokoro_mode === 'custom'
      && keys.kokoro_endpoint) {
    body.kokoro_endpoint = keys.kokoro_endpoint;
  }
  if (keys.llm_model) body.llm_model = keys.llm_model;
  if (keys.llm_provider) body.llm_provider = keys.llm_provider;
  if (keys.llm_api_key && keys.llm_provider !== 'ollama') {
    body.llm_api_key = keys.llm_api_key;
  }
  return body;
}

/** POST /onboarding/welcome — fixed welcome line on wizard mount.
 *  Sends the user's BYOK TTS pick so the cached audio matches the
 *  voice they actually selected (cache is keyed by provider+voice). */
export async function fetchOnboardingWelcome(): Promise<SoulChatResult> {
  const body = await _onboardingBodyFromKeys();
  const res = await fetch(`${getSoulBaseUrl()}/onboarding/welcome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(
      `soul /onboarding/welcome ${res.status}: ${err.slice(0, 200)}`,
    );
  }
  return (await res.json()) as SoulChatResult;
}

/** POST /onboarding/greet — personalized first greeting after settings save.
 *  Threads the user's full BYOK profile (LLM + TTS + voice). */
export async function fetchOnboardingGreet(
  systemExtension?: string,
): Promise<SoulChatResult> {
  const body = await _onboardingBodyFromKeys();
  if (systemExtension) body.system_extension = systemExtension;
  const res = await fetch(`${getSoulBaseUrl()}/onboarding/greet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
 *  on the wizard-save path AND by reconcileForAccount on the soul→cloud
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

export interface ReconcileResult {
  /** The signed-in account's canonical profile, or null → wizard fires. */
  profile: UserSettings | null;
  /** True when the machine's local state belonged to a DIFFERENT account (or
   *  a pre-account "guest" session) than the one signing in now. The caller
   *  must then clear the previous owner's machine-local secrets (API keys,
   *  local chat history) since those are NOT account-scoped and must not leak
   *  across accounts. */
  ownerChanged: boolean;
}

/** Reconcile settings for the account signing in, scoping the machine's local
 *  state to that account.
 *
 *  `localOwnerId` is the account id the machine's local profile/keys currently
 *  belong to (null = never signed in here, i.e. a guest/fresh machine).
 *
 *  Rules:
 *    * Cloud has this account's profile → it wins; mirror to soul.
 *    * Cloud empty, machine ALREADY owned by this account, local profile present
 *      → genuine pre-cloud local-only settings; migrate them up.
 *    * Cloud empty and the machine is NOT this account's (different account or
 *      guest) → do NOT adopt the stale local profile. Wipe it from soul and
 *      start fresh (wizard). This is the account-isolation fix: a new login no
 *      longer inherits whatever profile happened to be on the machine. */
export async function reconcileForAccount(
  accountId: string,
  token: string,
  localOwnerId: string | null,
): Promise<ReconcileResult> {
  const sameOwner = localOwnerId === accountId;
  const cloud = await fetchCloudSettings(token).catch((err) => {
    console.warn('[settings] cloud fetch failed during reconcile', err);
    return null;
  });

  if (cloud) {
    // Cloud is authoritative for this account; overwrite whatever soul holds
    // (it may be a different account's stale profile).
    try { await saveSettings(cloud.settings); }
    catch (err) { console.warn('[settings] mirror cloud→soul failed', err); }
    return { profile: cloud.settings, ownerChanged: !sameOwner };
  }

  // Cloud has nothing for this account.
  if (sameOwner) {
    const local = await fetchSettings().catch(() => null);
    if (local) {
      // This account's own local-only settings (e.g. wizard finished offline).
      try { await pushCloudSettings(token, local); }
      catch (err) { console.warn('[settings] migration soul→cloud failed', err); }
      return { profile: local, ownerChanged: false };
    }
    return { profile: null, ownerChanged: false };
  }

  // Different account / guest machine + no cloud profile: do not inherit the
  // stale local profile — wipe it and start clean for this account.
  try { await deleteSettings(); }
  catch (err) { console.warn('[settings] wipe stale local profile failed', err); }
  return { profile: null, ownerChanged: true };
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
