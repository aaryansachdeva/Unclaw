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
 *  OFF for the Mac 1.1.7 ship. The pipeline itself works end to end, but the
 *  capture rendezvous Worker is not deployed and the identity artifacts are
 *  not in the shipped runtimeAssets, so a real user would hit a dead QR.
 *  Everything behind this flag stays in the build, just unreachable. */
export const CUSTOM_CHARACTERS_ENABLED = false

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
