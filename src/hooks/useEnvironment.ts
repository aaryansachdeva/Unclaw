import { useCallback, useState } from 'react';

// The ENVIRONMENT (backdrop + key light + post effect) is GLOBAL, not
// per-character: you set it once and it persists for every agent. Deliberately
// NOT part of per-instance WardrobeSettings — switching characters must never
// change the room or the grade. Persisted device-local in its own localStorage
// key so it survives reloads and is independent of the roster + cloud settings
// blob.
//
// Field names mirror the wardrobe fields (bg*, lighting*, accentColor*,
// effect*) so the customization overlays can be fed these straight through
// their `initial` prop, and so App's save-split can destructure them out of a
// WardrobeSettings and drop them here verbatim.

// NOTE: key kept as the original `unclaw.background.v1` (not renamed) so a
// backdrop already saved under it survives this store's widening. The light +
// effect fields are simply absent on old blobs and fall back to defaults.
const KEY = 'unclaw.background.v1';

export interface EnvironmentSettings {
  // --- Backdrop ---
  /** Freeform backdrop hex. Wins over bgColorIndex. */
  bgColorHex?: string;
  /** Index into BG_COLORS. */
  bgColorIndex?: number;
  /** Backdrop glow (the `value` field of changeBGColor), 0-5. */
  bgGlow?: number;
  /** DA_Backgrounds index — the `bgmode` field of changeBGMaterial. */
  bgmode?: number;

  // --- Key light ---
  /** changeLightAngle `lightAngle` (degrees). */
  lightingAngle?: number;
  /** changeLightColor `lightIntensity` (candelas). */
  lightIntensity?: number;
  /** Index into ACCENT_COLORS (the light color). */
  accentColorIndex?: number;
  /** Freeform light-color hex. Wins over accentColorIndex. */
  accentColorHex?: string;

  // --- Post effect ---
  // Composited over the <video> in the renderer, never a UE descriptor.
  /** StreamEffects id. */
  effectId?: string;
  /** Effect strength 0-1. */
  effectStrength?: number;
}

function load(): EnvironmentSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as unknown;
      if (v && typeof v === 'object') return v as EnvironmentSettings;
    }
  } catch { /* corrupt / unavailable -> defaults */ }
  return {};
}

function save(next: EnvironmentSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); }
  catch { /* private mode / quota -> just won't persist */ }
}

export function useEnvironment() {
  const [environment, setEnvironmentState] = useState<EnvironmentSettings>(load);

  /** Merge a partial update over the current environment, persist, return it. */
  const setEnvironment = useCallback((patch: Partial<EnvironmentSettings>) => {
    setEnvironmentState((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  return { environment, setEnvironment };
}
