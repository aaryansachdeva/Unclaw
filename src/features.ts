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
 *  Before flipping it: listen to the output next to Supertonic. The suspects
 *  are the MLX conversion itself (try the bf16 vs quantized variants) and our
 *  per-sentence state copy, which resets the flow cache each sentence. */
export const POCKET_TTS_ENABLED = false
