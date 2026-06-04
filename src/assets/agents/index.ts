// Per-character portrait thumbnails for the Add-a-character picker. Keyed by
// the lowercase agentId (matches the UE DA_Character CharacterId). Imported as
// URLs so Vite fingerprints + bundles them; missing ids fall back to undefined
// so the card renders its lettered placeholder instead of a broken image.
import grace from './grace.png';
import mark from './mark.png';
import ava from './ava.png';
import goblin from './goblin.png';
import chris from './chris.png';
import joi from './joi.png';

export const AGENT_PORTRAITS: Record<string, string> = {
  grace,
  mark,
  ava,
  goblin,
  chris,
  joi,
};

export function agentPortrait(agentId: string): string | undefined {
  return AGENT_PORTRAITS[agentId];
}
