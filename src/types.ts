export interface Agent {
  id: number;
  name: string;
  /**
   * Stable lowercase character id sent to UE as the `agentId` field of the
   * `agentSwitch` descriptor. Case-sensitive: must match the CharacterId on
   * the UE DA_Character card (grace/mark/ava/goblin/chris/joi).
   */
  agentId: string;
  /** Built through the custom-character pipeline rather than authored by hand.
   *  Drives the C badge in the picker. */
  custom?: boolean;
  /** Ships the optimized render path. Drives the O badge in the picker. */
  optimized?: boolean;
}

// The selectable characters.
//
// Grace is now the fully-customizable build: her card spawns `grace_custom`
// (the legacy non-custom `grace` is deprecated and folded into it, see
// useAgentStack's migration). Kevin is the other custom build. Mark is a free
// download; ava/goblin/chris/joi are the legacy characters shipped as paid DLC
// paks. In dev every pak is baked into the UE .app so all are switchable.
// Availability gating (driven by UE's `installedCharacters` reply) lands when
// the DLC download flow ships.
//
// `*_custom` agentIds are separate strings (not variants of the originals)
// because UE resolves the DA_Character card by this exact string, and chat
// memory + wardrobe hang off the id too. AGENTS[0] must stay Grace (App.tsx
// reads AGENTS[0].name as the default agent name).
export const AGENTS: Agent[] = [
  { id: 0, name: 'Grace', agentId: 'grace_custom', custom: true, optimized: true },
  { id: 1, name: 'Mark',  agentId: 'mark' },
  { id: 2, name: 'Ava',   agentId: 'ava' },
  { id: 3, name: 'Goblin', agentId: 'goblin' },
  { id: 4, name: 'Chris', agentId: 'chris' },
  { id: 5, name: 'Joi',   agentId: 'joi' },
  { id: 6, name: 'Kevin', agentId: 'kevin_custom', custom: true, optimized: true },
];

// The photo-identity host: spawns as the generic male, personalized at runtime
// by the applyIdentity descriptor (dna + morph blob + basecolor). NOT in
// AGENTS: it never appears as a store card; instances are created by the
// Add-custom capture flow and live only in the roster.
export const GENERIC_MALE_AGENT: Agent = { id: 100, name: 'Custom', agentId: 'm_generic', custom: true, optimized: true };

// The UNIFIED photo-identity host (BP_Unified / DA_Character_Unified, id
// "unified"). This is the one the DNA-native path targets: its face is
// SKM_BASE_FaceMesh, which is the mesh base_face.udvt is baked against, and it
// carries the BodyBlendComponent that setBlendsUnified drives. m_generic has
// neither, so an H3D identity sent there applies to the wrong mesh.
// Same posture as GENERIC_MALE_AGENT: never a store card, roster-only.
export const UNIFIED_AGENT: Agent = { id: 101, name: 'Custom', agentId: 'unified', custom: true, optimized: true };
