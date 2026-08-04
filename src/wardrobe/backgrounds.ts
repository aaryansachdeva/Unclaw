// Backdrop STYLE catalog. `index` is the ONLY thing UE cares about: it's the
// array index into the DA_Backgrounds DataAsset, sent verbatim as
// changeBGMaterial's `bgmode`. Everything else (key, name) is ours, for the
// picker. Mirror the wardrobe catalog contract.
//
// ORDER IS THE INDEX — must match DA_Backgrounds element order in UE. Append
// only; never re-sort once the frontend is keyed to it. Edit this list as you
// add background styles to DA_Backgrounds.

export interface BackgroundStyle {
  /** Array index into DA_Backgrounds. Sent as `bgmode`. */
  index: number;
  /** Stable key (ideally the MI asset name). */
  key: string;
  /** Human label for the picker. */
  name: string;
}

// The M_BackgoundPlane_* family in MH_AI/MATERIALS. Keep index-aligned to
// DA_Backgrounds.
export const BACKGROUNDS: BackgroundStyle[] = [
  { index: 0, key: 'M_BackgoundPlane_Base_Customizable', name: 'Basic' },
  { index: 1, key: 'M_BackgoundPlane_Cubes',             name: 'Cubes' },
  { index: 2, key: 'M_BackgoundPlane_ASCII',             name: 'ASCII' },
];

/** Clamp a saved bgmode back into range (the catalog can shrink between builds). */
export function clampBgMode(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || BACKGROUNDS.length === 0) return 0;
  return Math.max(0, Math.min(BACKGROUNDS.length - 1, Math.floor(value)));
}
