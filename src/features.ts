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
 *  ON as of 1.1.8. It was off in 1.1.7 because the only implementation then
 *  was the official pip package, which needs torch — 533 MB that was
 *  deliberately removed from requirements-mac on 2026-07-17.
 *
 *  soul now runs Pocket on **MLX** instead (`mlx_audio`, already a dependency
 *  because Kokoro uses it), so it costs zero extra install bytes and measures
 *  FASTER than the torch path: 17.6x realtime warm vs ~13x. Weights and the
 *  free characters' voice embeddings ship in runtimeAssets 2026.0820.01;
 *  paid characters' embeddings are entitlement-gated alongside their paks.
 *  Verified loading and speaking with HF_HUB_OFFLINE=1 on an empty data dir. */
export const POCKET_TTS_ENABLED = true
