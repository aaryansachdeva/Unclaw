// Back-compat shim. Personas now live per-character in `src/characters/`.
// This file preserves the old import surface (`personalityFor`, `Personality`)
// for any remaining callers; new code should import from `./characters`.

import { CHARACTERS, characterFor, type CharacterProfile } from './characters';

export type Personality = CharacterProfile;

/** Legacy resolver keyed by DISPLAY NAME. New code: use `characterFor(id, …)`
 *  from `./characters`, which keys by the stable agent id. */
export function personalityFor(displayName: string, customName?: string | null): CharacterProfile {
  const base = CHARACTERS.find((c) => c.displayName === displayName);
  return characterFor(base?.id ?? 'grace', customName);
}

export { CHARACTERS as PERSONALITIES, characterFor };
