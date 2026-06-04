export interface Agent {
  id: number;
  name: string;
  /**
   * Stable lowercase character id sent to UE as the `agentId` field of the
   * `agentSwitch` descriptor. Case-sensitive: must match the CharacterId on
   * the UE DA_Character card (grace/mark/ava/goblin/chris/joi).
   */
  agentId: string;
}

// The selectable characters. Grace ships baked into the base game; Mark is a
// free download; the rest are paid DLC paks. In dev every pak is baked into
// the UE .app so all are switchable. Availability gating (driven by UE's
// `installedCharacters` reply) lands when the DLC download flow ships.
export const AGENTS: Agent[] = [
  { id: 0, name: 'Grace', agentId: 'grace' },
  { id: 1, name: 'Mark', agentId: 'mark' },
  { id: 2, name: 'Ava', agentId: 'ava' },
  { id: 3, name: 'Goblin', agentId: 'goblin' },
  { id: 4, name: 'Chris', agentId: 'chris' },
  { id: 5, name: 'Joi', agentId: 'joi' },
];
