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
 *  OFF for the Mac 1.1.7 ship, and this one is not close: requirements-mac.txt
 *  deliberately carries NO torch (the installer uninstalls it after the
 *  resolve) and pocket_tts is not a dependency at all, so a packaged install
 *  physically cannot run it. The cloned voice states in data/pocket/voices/
 *  are also not in runtimeAssets. A dev machine that pip-installed both by
 *  hand still works with the flag flipped on.
 *
 *  To ship it: add pocket_tts + torch to requirements-mac.txt, bump the wizard
 *  releaseTag, and put the voice states in the runtimeAssets bundle. */
export const POCKET_TTS_ENABLED = false
