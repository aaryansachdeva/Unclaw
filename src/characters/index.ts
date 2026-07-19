// Character registry. One profile per agent TYPE, keyed by stable `id`
// (matches types.ts/AGENTS `agentId`). Resolution helpers apply per-instance
// overrides (a custom name) without ever touching the stable id, so chat
// memory + voice + persona follow the character, not the label the user chose.

import type { CharacterProfile, CharacterVoices } from './types';
import { grace } from './grace';
import { mark } from './mark';
import { ava } from './ava';
import { goblin } from './goblin';
import { chris } from './chris';
import { joi } from './joi';
import { grace_custom } from './grace_custom';
import { kevin_custom } from './kevin_custom';
import { syd_custom } from './syd_custom';

export type { CharacterProfile, CharacterVoices } from './types';

/** Ordered list (matches the AGENTS catalog order). */
export const CHARACTERS: CharacterProfile[] = [
  grace, mark, ava, goblin, chris, joi,
  grace_custom, kevin_custom, syd_custom,
];

/** id -> profile. */
export const CHARACTERS_BY_ID: Record<string, CharacterProfile> =
  Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

const FALLBACK = grace;

/** Apply a custom display name to a profile. Swaps every whole-word
 *  occurrence of the original name in the persona + displayName, but leaves
 *  the stable `id` (and `voices`) alone, so a Chris renamed "Percy" still gets
 *  Chris's persona voice + Chris's TTS voice, just under a new name. */
function withCustomName(base: CharacterProfile, custom: string): CharacterProfile {
  const trimmed = custom.trim();
  if (!trimmed || trimmed === base.displayName) return base;
  const escaped = base.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'g');
  return {
    ...base,
    displayName: trimmed,
    prompt: base.prompt.replace(re, trimmed),
  };
}

/** Resolve a character by its stable type id (grace/mark/ava/goblin/chris/joi),
 *  optionally renamed. Unknown ids fall back to Grace (e.g. the Add slot). */
export function characterFor(
  agentId: string | null | undefined,
  customName?: string | null,
): CharacterProfile {
  const base = (agentId && CHARACTERS_BY_ID[agentId]) || FALLBACK;
  return customName ? withCustomName(base, customName) : base;
}

/** TTS provider tag -> the character's voice for that engine. Used by the chat
 *  path to send a per-character voice instead of one global voice. */
export function voiceForProvider(
  profile: CharacterProfile,
  ttsProvider: string | null | undefined,
): string | undefined {
  const v: CharacterVoices = profile.voices;
  switch (ttsProvider) {
    case 'elevenlabs': return v.elevenlabs;
    case 'supertonic': return v.supertonic;
    case 'kokoro': return v.kokoro;
    default: return undefined; // qwen3 / unknown -> let global/default apply
  }
}
