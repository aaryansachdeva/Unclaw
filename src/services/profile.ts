// User profile CRUD across two layers:
//   * Soul (local FastAPI on 127.0.0.1:8765) — the LLM reads its system
//     prompt from this every chat turn, so it has to be the local cache.
//     No auth here; soul trusts the renderer.
//   * UnClaw API (Cloudflare Worker) — the cross-device source of truth.
//     Auth-gated by the user's JWT.
//
// Cloud is authoritative across devices; soul is authoritative for
// the LLM read path. The reconciler (`syncProfile` below) keeps them
// in step at sign-in and after every wizard save.

import type { SoulChatResult } from './soulChat';

const SOUL_URL = 'http://127.0.0.1:8765';
const CLOUD_URL = 'https://unclaw-api.aryansachdeva1999.workers.dev';

export type UserSchedule = 'early_bird' | 'night_owl' | 'mixed';

export interface UserProfile {
  name: string;
  pronouns?: string | null;
  city?: string | null;
  timezone?: string | null;
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
}

/** GET /profile — null when no profile has been saved yet. The wizard
 *  uses null as the trigger to mount on app start. */
export async function fetchProfile(): Promise<UserProfile | null> {
  const res = await fetch(`${SOUL_URL}/profile`);
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`soul /profile GET ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data === null ? null : (data as UserProfile);
}

/** PUT /profile — full replace. Used by the wizard's Finish button. */
export async function saveProfile(profile: UserProfile): Promise<UserProfile> {
  const res = await fetch(`${SOUL_URL}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`soul /profile PUT ${res.status}: ${err.slice(0, 200)}`);
  }
  return (await res.json()) as UserProfile;
}

/** PATCH /profile — partial merge. Useful for inline tweaks. */
export async function patchProfile(
  updates: Partial<UserProfile>,
): Promise<UserProfile> {
  const res = await fetch(`${SOUL_URL}/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`soul /profile PATCH ${res.status}: ${err.slice(0, 200)}`);
  }
  return (await res.json()) as UserProfile;
}

/** DELETE /profile — wipes the profile entirely. Used by the reset
 *  button next to the edit pencil. After this resolves, the wizard
 *  fires in firstRun mode again because the next /profile GET returns
 *  null. */
export async function deleteProfile(): Promise<void> {
  const res = await fetch(`${SOUL_URL}/profile`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`soul /profile DELETE ${res.status}: ${err.slice(0, 200)}`);
  }
}

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

/** POST /onboarding/greet — personalized first greeting after profile save. */
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

// -- Helpers used by the wizard (and the system_extension builder) --

const VIBE_BRACKETS = {
  formality:  ['casual',  'friendly', 'cordial',  'formal'],
  humor:      ['dry',     'wry',      'warm',     'playful'],
  directness: ['gentle',  'honest',   'direct',   'blunt'],
  verbosity:  ['brief',   'measured', 'detailed', 'thorough'],
} as const;

export type VibeSlider = keyof typeof VIBE_BRACKETS;

/** Map an int 0..100 to one of four bracket words. Mirrors the soul-side
 *  `_vibe_word` so live preview + saved-profile rendering stay in sync. */
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
// Cloud (Worker) profile — auth-gated, cross-device source of truth.
// =====================================================================

/** GET /profile from the Worker. Returns null when no profile is saved
 *  yet, or when the token has expired (caller should re-auth). */
export async function fetchCloudProfile(token: string): Promise<UserProfile | null> {
  const res = await fetch(`${CLOUD_URL}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`cloud /profile GET ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = (await res.json()) as { profile: UserProfile | null };
  return data.profile;
}

/** PUT /profile on the Worker. Used by saveProfileEverywhere on the
 *  wizard-save path AND by syncProfile during the soul→cloud
 *  migration when a returning user signs in for the first time. */
export async function pushCloudProfile(
  token: string,
  profile: UserProfile,
): Promise<UserProfile> {
  const res = await fetch(`${CLOUD_URL}/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`cloud /profile PUT ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = (await res.json()) as { profile: UserProfile };
  return data.profile;
}

// =====================================================================
// Reconciliation — runs after sign-in to align cloud + soul.
// =====================================================================

/** Pull cloud + local profiles in parallel, decide which (if either)
 *  is authoritative, mirror it to the other side, return the canonical
 *  profile (or null when both sides are empty — wizard fires).
 *
 *  Rules:
 *    * Cloud has data: it wins. Mirror to soul if soul is missing OR
 *      out of date (different updated_at).
 *    * Cloud empty, soul has data: this is a returning pre-cloud user
 *      signing in for the first time. Push their existing local
 *      profile up to the cloud as a one-shot migration.
 *    * Both empty: return null. App will trigger the wizard.
 */
export async function syncProfile(token: string): Promise<UserProfile | null> {
  const [cloud, local] = await Promise.all([
    fetchCloudProfile(token).catch((err) => {
      console.warn('[profile] cloud fetch failed during sync', err);
      return null;
    }),
    fetchProfile().catch((err) => {
      console.warn('[profile] local fetch failed during sync', err);
      return null;
    }),
  ]);

  if (cloud) {
    if (!local || local.updated_at !== cloud.updated_at) {
      try {
        await saveProfile(cloud);
      } catch (err) {
        console.warn('[profile] mirror cloud→soul failed', err);
      }
    }
    return cloud;
  }

  if (local) {
    try {
      await pushCloudProfile(token, local);
    } catch (err) {
      console.warn('[profile] migration soul→cloud failed', err);
    }
    return local;
  }

  return null;
}

/** Save a profile to soul (always) and push to cloud (best-effort
 *  when a token is present). Used by the wizard's Finish button so a
 *  single user action ends up in both layers. Cloud failure is
 *  swallowed — soul is the read path that matters for the LLM, and
 *  the next sync will re-mirror. */
export async function saveProfileEverywhere(
  profile: UserProfile,
  token: string | null,
): Promise<UserProfile> {
  const saved = await saveProfile(profile);
  if (token) {
    try {
      await pushCloudProfile(token, saved);
    } catch (err) {
      console.warn('[profile] cloud push failed (will retry on next sync)', err);
    }
  }
  return saved;
}
