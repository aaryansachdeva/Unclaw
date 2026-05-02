// User profile CRUD against soul's /profile endpoints. Backs the onboarding
// wizard and any inline edits later. The server is the single source of
// truth — we don't cache on disk in the renderer process.

import type { SoulChatResult } from './soulChat';

const SOUL_URL = 'http://127.0.0.1:8765';

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
