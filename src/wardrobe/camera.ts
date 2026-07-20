// Frontend-driven camera.
//
// The camera used to move as a side-effect of UE-side events (wardrobeModeOn/Off
// nudged it for the fitting-room framing). We now drive it explicitly from the
// renderer with the `updateCameraFromLocation` descriptor, which moves the
// camera to a world LOCATION with a smooth transition:
//
//   { EventType: 'updateCameraFromLocation', 'locB.x': <num>, 'locB.y': <num>, 'locB.z': <num> }
//
// UE reads the three fields with Get Number Field, so they go on the wire as
// NUMBERS (like changeLightColor / changeBGColor), not strings.
//
// x = left/right (0 = centred), y = pull-back distance, z = height. z is the
// per-character knob: taller characters need the camera higher to keep the face
// framed at rest.

export type CameraLoc = readonly [number, number, number];

// Per-character BASE resting framing (the camera's world location when just
// standing there), before the global tweak below. Tuned per character height.
// x=0 centred, y=50 pull-back; z varies. kevin_custom sits a little higher.
const CAMERA_BASE: Record<string, CameraLoc> = {
  grace:        [0, 50, 160],
  ava:          [0, 50, 154],
  chris:        [0, 50, 175],
  goblin:       [0, 50, 132],
  joi:          [0, 50, 160],
  mark:         [0, 50, 170],
  kevin_custom: [0, 50, 165], // a touch higher than the grace fallback
};

/** Used for unknown ids and as the ultimate fallback (matches Grace). */
const CAMERA_BASE_FALLBACK: CameraLoc = [0, 50, 160];

// Global tweak applied to EVERY resting framing: sit a little closer (zoom in)
// and a little higher. One place to tune "a little more / less" — nudge the two
// deltas (negative Y = closer, positive Z = higher).
const REST_Y_DELTA = 3;  // added to y; negative = closer (zoom in)
const REST_Z_DELTA = -2; // added to z; positive = higher

/** Resolve a character's resting camera. Custom builds (grace_custom, …) fall
 *  back to their base character's framing, then to the Grace fallback. The
 *  global zoom-in / raise is applied here so every character gets it. */
export function cameraDefaultFor(agentId?: string | null): CameraLoc {
  const base = (agentId && (CAMERA_BASE[agentId] ?? CAMERA_BASE[agentId.replace(/_custom$/, '')]))
    || CAMERA_BASE_FALLBACK;
  return [base[0], base[1] + REST_Y_DELTA, base[2] + REST_Z_DELTA];
}

// Customization framing: pull the camera back and drop it so the whole figure
// is visible while dressing. Derived from the resting framing so each character
// stays centred and roughly proportional to its height.
//
// PLACEHOLDER offsets — the pull-back / height drop are a first guess and are
// meant to be tuned against the live scene. Keep them here so there's one place
// to adjust.
const CUSTOMIZE_PULLBACK = 110; // added to y (further from the character)
const CUSTOMIZE_DROP = 55;      // subtracted from z (frame the body, not the face)

export function cameraCustomize(agentId?: string | null): CameraLoc {
  const [x, y, z] = cameraDefaultFor(agentId);
  return [x, y + CUSTOMIZE_PULLBACK, z - CUSTOMIZE_DROP];
}

// User-facing framing modes for the camera toggle above the input bar:
//   default — the character's resting shot (cameraDefaultFor)
//   waist   — a medium shot, halfway out (down to about the waist)
//   full    — the whole figure, same as the wardrobe / customize zoom-out
export type CameraMode = 'default' | 'waist' | 'full';
export const CAMERA_MODES: CameraMode[] = ['default', 'waist', 'full'];

// How far the `waist` shot sits from default toward full (0 = default, 1 =
// full). Biased under 0.5 so the medium shot stays closer to the resting shot
// than to the full zoom-out.
const WAIST_BLEND = 0.30;
// Extra height on the waist shot (added to z) so the medium framing sits a
// little higher than a straight blend would put it.
const WAIST_RAISE = 8;
// Extra height (z) and pull-back (y) on the toggle's FULL shot only — NOT the
// wardrobe/customize framing, which App drives from cameraCustomize directly.
const FULL_RAISE = 16;
const FULL_PULLBACK = 20;

/** Camera world-location for a character in a given framing mode. `waist`
 *  interpolates from the resting shot toward the full-figure zoom-out, weighted
 *  toward default by WAIST_BLEND. */
export function cameraForMode(agentId: string | null | undefined, mode: CameraMode): CameraLoc {
  const d = cameraDefaultFor(agentId);
  if (mode === 'default') return d;
  const f = cameraCustomize(agentId);
  if (mode === 'full') return [f[0], f[1] + FULL_PULLBACK, f[2] + FULL_RAISE];
  const t = WAIST_BLEND;
  return [d[0] + (f[0] - d[0]) * t, d[1] + (f[1] - d[1]) * t, d[2] + (f[2] - d[2]) * t + WAIST_RAISE];
}
