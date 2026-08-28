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

// How far each blend axis moves the HEAD, in cm at full deflection.
//
// Measured, not estimated: composed the bone chain root -> pelvis -> spine_01..05
// -> neck_01 -> neck_02 -> head in BBD_BASE_Body and diffed each corner's head
// height against the base pose (154.66 cm). Every axis is linear and symmetric
// between its Lo and Hi corners, so a single coefficient per axis is exact
// rather than a fit.
//
// This matters because the camera frames a face. At the +/-0.55 the photo read
// sends for gender, MascFem alone moves the head 6.7 cm, and the build axes add
// a few more. Ten centimetres is very visible in a head-and-shoulders shot: the
// face drifts toward the top or bottom of frame depending on body shape.
//
// Height is deliberately in the table but is never sent automatically; it is the
// user's slider, and it is handled here only so a manual change stays framed.
const HEAD_CM_PER_AXIS: Record<string, number> = {
  mascFem:  -12.22,
  height:    34.65,  // asymmetric in the data (-26.39 at Lo); see note below
  fat:       -5.56,
  musc:       3.48,
  waistHip:   3.49,
  chest:      2.36,
};

/** Signed axis values, as sent in the `setBlendsUnified` descriptor. */
export type BlendAxes = Record<string, number> | null | undefined;

/** How much the camera must rise or fall to keep the face centred for a given
 *  body shape. Positive = the head sits higher, so the camera goes up with it.
 *
 *  Height is the one asymmetric axis (+34.65 up, -26.39 down), so it uses the
 *  matching coefficient for its sign instead of a single slope. */
export function headOffsetFor(axes: BlendAxes): number {
  if (!axes) return 0;
  let dz = 0;
  for (const [axis, value] of Object.entries(axes)) {
    if (!Number.isFinite(value) || value === 0) continue;
    if (axis === 'height') {
      dz += value * (value > 0 ? 34.65 : 26.39);
      continue;
    }
    const k = HEAD_CM_PER_AXIS[axis];
    if (k !== undefined) dz += value * k;
  }
  return dz;
}

/** Resolve a character's resting camera. Custom builds (grace_custom, …) fall
 *  back to their base character's framing, then to the Grace fallback. The
 *  global zoom-in / raise is applied here so every character gets it.
 *
 *  `axes` are the live body blends. Passing them keeps the face centred as the
 *  body changes shape; omitting them gives the old fixed framing, which is
 *  correct for every character that has no blend system. */
export function cameraDefaultFor(agentId?: string | null, axes?: BlendAxes): CameraLoc {
  const base = (agentId && (CAMERA_BASE[agentId] ?? CAMERA_BASE[agentId.replace(/_custom$/, '')]))
    || CAMERA_BASE_FALLBACK;
  return [base[0], base[1] + REST_Y_DELTA, base[2] + REST_Z_DELTA + headOffsetFor(axes)];
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

export function cameraCustomize(agentId?: string | null, axes?: BlendAxes): CameraLoc {
  const [x, y, z] = cameraDefaultFor(agentId, axes);
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
export function cameraForMode(
  agentId: string | null | undefined, mode: CameraMode, axes?: BlendAxes,
): CameraLoc {
  const d = cameraDefaultFor(agentId, axes);
  if (mode === 'default') return d;
  const f = cameraCustomize(agentId, axes);
  if (mode === 'full') return [f[0], f[1] + FULL_PULLBACK, f[2] + FULL_RAISE];
  const t = WAIST_BLEND;
  return [d[0] + (f[0] - d[0]) * t, d[1] + (f[1] - d[1]) * t, d[2] + (f[2] - d[2]) * t + WAIST_RAISE];
}

/** The axes the photo read produces, in one place so the camera correction and
 *  the `setBlendsUnified` descriptor can never drift apart. Height is absent on
 *  purpose: it belongs to the user's slider and is never sent automatically. */
export function blendAxesForCamera(
  gender?: string | null, build?: string | null,
): Record<string, number> {
  const axes: Record<string, number> = {};
  if (gender === 'f') axes.mascFem = 0.55;
  else if (gender === 'm') axes.mascFem = -0.55;
  if (build === 'skinny')   { axes.fat = -0.40; axes.musc = -0.20; }
  else if (build === 'fat') { axes.fat = 0.50;  axes.musc = -0.08; }
  else if (build)           { axes.fat = -0.15; axes.musc = 0.40; }
  return axes;
}
