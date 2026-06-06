// A character = one agent TYPE's full identity: persona + voice mapping +
// picker metadata. Keyed by a stable `id` (grace/mark/ava/goblin/chris/joi)
// that matches types.ts/AGENTS `agentId` and the UE CharacterId. Everything
// here is TYPE-level: a roster instance only stores overrides (custom name,
// wardrobe, chat-memory key). So two Chris instances (one renamed "Percy")
// both resolve to this chris profile (same persona, same voice), differing
// only by their instance-level name + memory.

export interface CharacterVoices {
  /** ElevenLabs voice id (cloud TTS). */
  elevenlabs: string;
  /** Supertonic custom-voice file stem -> data/supertonic/voices/<name>.json */
  supertonic: string;
  /** Kokoro custom-voice stem -> data/kokoro/voices/<name>.pt */
  kokoro: string;
}

export interface CharacterProfile {
  /** Stable type key. localStorage chat-memory + voice + persona all hang off
   *  this, never off the (renameable) display name. */
  id: string;
  /** Default display name (matches types.ts/AGENTS). Overridable per instance. */
  displayName: string;
  /** One-line description for the Add-character picker. */
  blurb: string;
  /** Persona text sent to soul as `system_extension` on each /chat call. */
  prompt: string;
  /** Per-provider voice identity. The active TTS provider picks one. */
  voices: CharacterVoices;
}
