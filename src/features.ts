// Ship-time feature gates.
//
// One flag per in-flight feature that is built but not ready to be seen by
// users. Flipping a flag back to `true` restores the feature everywhere it is
// referenced; nothing else has to change. Keep the gates coarse (whole
// user-facing surfaces), and keep the underlying code compiling either way so
// the branch never rots.

/** Photo -> custom character: the "Add custom" tile, the Unclaw Scan QR
 *  handoff, local identity inference, and the identity-host roster instances
 *  that flow produces.
 *
 *  ON in dev, OFF in packaged builds. The pipeline runs end to end on a dev
 *  machine (local UnclawCharWorker, the p1 secrets, the dev UE container),
 *  but the identity artifacts are not in the shipped runtimeAssets and the
 *  pipeline keys are dev-only, so a real user would hit a dead flow.
 *  Everything behind this flag stays in the build, just unreachable outside
 *  dev. */
export const CUSTOM_CHARACTERS_ENABLED = import.meta.env.DEV

/** Kyutai Pocket-TTS as a selectable voice engine.
 *
 *  OFF again as of 1.1.9. It shipped ON in 1.1.8 running on MLX, and the
 *  plumbing all worked — weights and per-character cloned embeddings loaded
 *  offline, speed measured at 17.6-20.1x realtime — but the AUDIO ITSELF is
 *  bad. Aryan's verdict on the shipped build: "it doesn't work well, the
 *  audio is busted that it generates."
 *
 *  So this is a QUALITY gate, not a plumbing gate. Everything behind it stays
 *  in place and working: the MLX runtime, the shipped weights in
 *  runtimeAssets, the entitlement-gated per-character embeddings, the store
 *  Worker route. Flipping this back to `true` re-exposes all of it.
 *
 *  ON again 2026-08-27. The "busted audio" was neither the MLX conversion
 *  nor the weights: soul's per-sentence state handling shared the flow
 *  cache's per-layer KV objects across sentences (dict() is a shallow
 *  copy), so every sentence after the first was voice-conditioned on the
 *  previous ones' generated latents and collapsed into re-babbled
 *  fragments. Fixed in soul 9b4ef50 by slicing the cache back to the
 *  recorded prompt length before each sentence; measured with a Whisper
 *  round-trip at 75.9% -> 0.0% WER on grace and chris. Re-enabled for an
 *  in-app ears test; making Pocket the DEFAULT provider is a separate,
 *  later decision after that test. */
export const POCKET_TTS_ENABLED = true

/** Chatterbox-Turbo (Resemble, MIT) as a second local clone engine next to
 *  Pocket. Same reference clips, but it performs inline sounds ([laugh],
 *  [sigh], ...) so the character can react, at ~0.9 GB more resident memory
 *  than Pocket and ~3.5x realtime instead of ~12x. Pocket stays the default;
 *  this only adds the option to the engine pickers. Off = the option hides
 *  and a saved selection migrates back to Pocket (migrateApiKeys). */
export const CHATTERBOX_TTS_ENABLED = true
