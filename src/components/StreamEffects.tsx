// StreamEffects — post effects painted over the live pixel stream.
//
// These are the ONLY customization that never reaches UE. There's no
// descriptor, no Blueprint: the stream arrives as a <video>, and everything
// here is a compositing layer sitting on top of it in the renderer. That's a
// feature, not a shortcut. Round-tripping a look through UE would cost a frame
// of latency and a rebuild to tune; here, dragging the strength slider is
// instant and costs the GPU a composite it was already doing.
//
// HOW THEY WORK
// Two tools, used together:
//   * `backdrop` — a backdrop-filter on a pane above the video. Filters what is
//     BENEATH it, so we recolor/blur the stream without ever touching the
//     <video> element (which the PixelStreaming lib owns and reparents).
//   * `layer` — an ordinary painted layer (grain, scanlines, vignette),
//     usually with a mix-blend-mode so it interacts with the image instead of
//     sitting on it like a sticker.
//
// Bloom is the interesting one: a pane that blurs + brightens what's under it
// and screens the result back over the sharp original. That's real halation,
// the way light blooms on film, out of two CSS properties.
//
// COST
// Every effect is one extra composited layer over a 30-60fps video on a machine
// already running Unreal. They're cheap (GPU compositing, no JS per frame) but
// they are not free, which is why `none` is the default and why only ONE can be
// active. Stacking three of these would quietly tax the same GPU that's drawing
// her.

import { useMemo } from 'react';

export interface StreamEffectDef {
  id: string;
  name: string;
  /** One line, shown under the reel. Says what it does, not what it is. */
  blurb: string;
  /** backdrop-filter applied to the stream beneath. `s` is 0-1 strength. */
  backdrop?: (s: number) => string;
  /** Painted layer over the stream. */
  layer?: (s: number) => React.CSSProperties;
  /** Extra layer, for effects that need two (texture + tint). */
  layer2?: (s: number) => React.CSSProperties;
}

// Animated film grain. An inline SVG turbulence tile: no image asset, no JS per
// frame, and the browser rasterizes it once then just shifts it. baseFrequency
// is what sets grain SIZE — 0.65 gives chunky 16mm clumps rather than the fine
// digital sand you get up near 0.9.
const GRAIN_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

const SCANLINE = (px: number, alpha: number) =>
  `repeating-linear-gradient(to bottom, rgba(0,0,0,${alpha}) 0px, rgba(0,0,0,${alpha}) 1px, transparent 1px, transparent ${px}px)`;

// The aperture grille: vertical R/G/B phosphor stripes. This is the thing that
// actually makes a CRT read as a CRT. Scanlines alone are just stripes; the
// grille is why the image looks like it's made of light instead of pixels.
const GRILLE =
  'repeating-linear-gradient(to right, rgba(255,0,40,0.5) 0px, rgba(255,0,40,0.5) 1px, rgba(0,255,80,0.5) 1px, rgba(0,255,80,0.5) 2px, rgba(0,80,255,0.5) 2px, rgba(0,80,255,0.5) 3px)';

const ALL_STREAM_EFFECTS: StreamEffectDef[] = [
  {
    id: 'none',
    name: 'None',
    blurb: 'The stream, untouched.',
  },
  {
    id: 'crt',
    name: 'CRT',
    blurb: 'Aperture grille, phosphor burn, 60Hz flicker.',
    // Blown out and oversaturated, the way a real tube runs hot.
    backdrop: (s) =>
      `saturate(${(1 + s * 1.4).toFixed(2)}) contrast(${(1 + s * 0.55).toFixed(2)}) brightness(${(1 + s * 0.3).toFixed(2)})`,
    // Grille + scanlines in one stack. multiply so the mask eats light instead
    // of frosting over it.
    layer: (s) => ({
      background: `${GRILLE}, ${SCANLINE(3, 0.55)}`,
      backgroundSize: '3px 100%, 100% 3px',
      mixBlendMode: 'multiply',
      opacity: 0.25 + s * 0.6,
    }),
    // Phosphor bloom + tube curvature + the 60Hz roll bar.
    layer2: (s) => ({
      background: `
        radial-gradient(ellipse at 50% 45%, rgba(180, 255, 220, 0.16) 0%, transparent 60%),
        linear-gradient(to bottom, rgba(255,255,255,0.05) 0%, transparent 12%, transparent 88%, rgba(255,255,255,0.05) 100%),
        radial-gradient(ellipse at 50% 50%, transparent 52%, rgba(0,0,0,0.85) 100%)`,
      opacity: 0.4 + s * 0.6,
      animation: 'unclaw-fx-flicker 90ms steps(2, end) infinite, unclaw-fx-roll 9s linear infinite',
    }),
  },
  {
    id: 'grain',
    name: 'Grain',
    blurb: 'Heavy stock, pushed two stops.',
    // Grain reads as grain because the image behind it is contrasty. Flat
    // footage plus noise just looks dirty.
    backdrop: (s) => `contrast(${(1 + s * 0.35).toFixed(2)}) saturate(${(1 - s * 0.25).toFixed(2)})`,
    layer: (s) => ({
      backgroundImage: GRAIN_URI,
      // overlay agitates lights and darks and leaves midtones, which is what
      // silver halide does. `normal` would just fog the picture grey.
      mixBlendMode: 'overlay',
      opacity: 0.25 + s * 0.75,
      // steps() not linear: grain JUMPS frame to frame, it doesn't slide.
      animation: 'unclaw-fx-grain 240ms steps(3, end) infinite',
    }),
    layer2: (s) => ({
      backgroundImage: GRAIN_URI,
      backgroundSize: '260px 260px',
      mixBlendMode: 'soft-light',
      opacity: s * 0.55,
      // A second, coarser layer on a different beat. One noise layer looks like
      // a texture; two out of sync look alive.
      animation: 'unclaw-fx-grain 370ms steps(2, end) infinite reverse',
    }),
  },
  {
    id: 'glitch',
    name: 'Glitch',
    blurb: 'Signal tearing. Slices jump, chroma screams.',
    backdrop: (s) => `saturate(${(1 + s * 2).toFixed(2)}) hue-rotate(${(s * 8).toFixed(0)}deg) contrast(${(1 + s * 0.3).toFixed(2)})`,
    // Torn slices: a hard-edged band stack that snaps to new offsets.
    layer: (s) => ({
      background: `repeating-linear-gradient(to bottom,
        transparent 0px, transparent 14px,
        rgba(255, 0, 90, 0.28) 14px, rgba(255, 0, 90, 0.28) 17px,
        transparent 17px, transparent 34px,
        rgba(0, 240, 255, 0.24) 34px, rgba(0, 240, 255, 0.24) 36px,
        transparent 36px, transparent 62px)`,
      mixBlendMode: 'screen',
      opacity: 0.3 + s * 0.7,
      animation: 'unclaw-fx-tear 1.7s steps(1, end) infinite',
    }),
    layer2: (s) => ({
      backgroundImage: GRAIN_URI,
      mixBlendMode: 'color-dodge',
      opacity: s * 0.22,
      animation: 'unclaw-fx-grain 110ms steps(2, end) infinite',
    }),
  },
  {
    id: 'vhs',
    name: 'VHS',
    blurb: 'Third-gen dub. Tracking is shot.',
    backdrop: (s) =>
      `saturate(${(1 + s * 1.3).toFixed(2)}) hue-rotate(${(-s * 12).toFixed(0)}deg) contrast(${(1 - s * 0.12).toFixed(2)}) brightness(${(1 + s * 0.08).toFixed(2)}) blur(${(s * 0.6).toFixed(2)}px)`,
    layer: (s) => ({
      background: SCANLINE(4, 0.28),
      opacity: 0.5 + s * 0.5,
    }),
    layer2: (s) => ({
      // The tracking band: a fat noisy bar that crawls up the frame. This one
      // detail sells "tape" harder than any amount of color grading.
      background: `linear-gradient(to bottom,
        transparent 0%,
        rgba(255,255,255,0.06) 40%,
        rgba(255,255,255,0.30) 47%,
        rgba(150, 210, 255, 0.26) 50%,
        rgba(255, 90, 160, 0.18) 53%,
        rgba(255,255,255,0.06) 60%,
        transparent 100%)`,
      mixBlendMode: 'screen',
      opacity: 0.5 + s * 0.5,
      animation: 'unclaw-fx-vhs 5s linear infinite',
    }),
  },
  {
    id: 'hologram',
    name: 'Hologram',
    blurb: 'Projected, not present. Cyan and unstable.',
    // Kill the native color, then rebuild it as one cyan channel. A hologram
    // isn't tinted footage, it's light with no body behind it, so contrast goes
    // up and saturation of the ORIGINAL goes to zero first.
    backdrop: (s) =>
      `grayscale(1) brightness(${(1 + s * 0.45).toFixed(2)}) contrast(${(1 + s * 0.5).toFixed(2)}) sepia(${s.toFixed(2)}) hue-rotate(${(150 + s * 25).toFixed(0)}deg) saturate(${(1 + s * 5).toFixed(1)})`,
    // Fine projection lines. 2px, not 4: a hologram is drawn by a scanner, not
    // broadcast on a tube, so the pitch is tighter than CRT or VHS.
    layer: (s) => ({
      background: SCANLINE(2, 0.45),
      opacity: 0.4 + s * 0.6,
    }),
    // The interference sweep + the unstable flicker that says "this is a
    // transmission and it is struggling".
    layer2: (s) => ({
      background: `linear-gradient(to bottom,
        transparent 0%,
        rgba(120, 255, 255, 0.10) 44%,
        rgba(190, 255, 255, 0.30) 50%,
        rgba(120, 255, 255, 0.10) 56%,
        transparent 100%)`,
      mixBlendMode: 'screen',
      opacity: 0.5 + s * 0.5,
      animation: 'unclaw-fx-holo 3.2s linear infinite, unclaw-fx-holoflick 2.4s steps(6, end) infinite',
    }),
  },
  {
    id: 'scanner',
    name: 'Scanner',
    blurb: 'Being measured. A laser sweeps her volume.',
    backdrop: (s) =>
      `grayscale(1) contrast(${(1 + s * 1.3).toFixed(2)}) brightness(${(1 - s * 0.25).toFixed(2)}) sepia(${s.toFixed(2)}) hue-rotate(${(160).toFixed(0)}deg) saturate(${(1 + s * 3.5).toFixed(1)})`,
    // The beam: a hard bright line with a glow trail behind it, not a soft
    // gradient. A scanner cuts, it doesn't wash.
    layer: (s) => ({
      background: `linear-gradient(to bottom,
        transparent 0%,
        rgba(0, 255, 200, 0.02) 38%,
        rgba(0, 255, 210, 0.16) 47%,
        rgba(210, 255, 250, 0.95) 50%,
        rgba(0, 255, 210, 0.16) 53%,
        rgba(0, 255, 200, 0.02) 62%,
        transparent 100%)`,
      mixBlendMode: 'screen',
      opacity: 0.55 + s * 0.45,
      animation: 'unclaw-fx-scan 2.6s cubic-bezier(0.5, 0, 0.5, 1) infinite',
    }),
    // The measuring lattice it leaves behind.
    layer2: (s) => ({
      background: `repeating-linear-gradient(to right, rgba(0,255,200,0.13) 0px, rgba(0,255,200,0.13) 1px, transparent 1px, transparent 22px),
                   repeating-linear-gradient(to bottom, rgba(0,255,200,0.13) 0px, rgba(0,255,200,0.13) 1px, transparent 1px, transparent 22px)`,
      mixBlendMode: 'screen',
      opacity: s * 0.85,
    }),
  },
  {
    id: 'grid',
    name: 'Grid',
    blurb: 'She stands on the machine. It runs to the horizon.',
    backdrop: (s) => `saturate(${(1 + s * 1.1).toFixed(2)}) contrast(${(1 + s * 0.3).toFixed(2)}) brightness(${(1 - s * 0.08).toFixed(2)})`,
    // A real receding floor: perspective + rotateX puts the grid IN the scene
    // rather than on top of it, and scrolling the background toward the camera
    // makes it infinite. The horizon lands under her feet, so she reads as
    // standing on it.
    layer: (s) => ({
      background: `repeating-linear-gradient(to right, rgba(0, 230, 255, 0.55) 0px, rgba(0, 230, 255, 0.55) 1px, transparent 1px, transparent 44px),
                   repeating-linear-gradient(to bottom, rgba(255, 0, 200, 0.42) 0px, rgba(255, 0, 200, 0.42) 1px, transparent 1px, transparent 44px)`,
      transform: 'perspective(220px) rotateX(72deg)',
      transformOrigin: 'center 78%',
      mixBlendMode: 'screen',
      opacity: 0.35 + s * 0.65,
      animation: 'unclaw-fx-grid 2.4s linear infinite',
    }),
    // Horizon haze, so the grid dissolves into distance instead of stopping.
    layer2: (s) => ({
      background: `linear-gradient(to bottom, transparent 0%, transparent 62%, rgba(120, 0, 190, ${(s * 0.3).toFixed(2)}) 78%, transparent 100%)`,
      mixBlendMode: 'screen',
      opacity: s,
    }),
  },
  {
    id: 'nebula',
    name: 'Nebula',
    blurb: 'Deep field. Gas drifting where the room was.',
    backdrop: (s) => `saturate(${(1 + s * 0.9).toFixed(2)}) contrast(${(1 + s * 0.25).toFixed(2)}) brightness(${(1 - s * 0.12).toFixed(2)})`,
    // Three clouds on one layer at different scales. Animating background-
    // position drifts them against each other, which is what makes it read as
    // volume instead of wallpaper.
    layer: (s) => ({
      background: `
        radial-gradient(ellipse 60% 40% at 20% 30%, rgba(120, 40, 255, 0.55) 0%, transparent 60%),
        radial-gradient(ellipse 50% 60% at 80% 60%, rgba(0, 200, 255, 0.45) 0%, transparent 60%),
        radial-gradient(ellipse 70% 50% at 50% 85%, rgba(255, 0, 140, 0.40) 0%, transparent 60%)`,
      backgroundSize: '200% 200%, 180% 180%, 220% 220%',
      mixBlendMode: 'screen',
      opacity: 0.4 + s * 0.6,
      animation: 'unclaw-fx-nebula 22s ease-in-out infinite',
    }),
    // Grain doubles as starfield: at low opacity over dark gas it reads as
    // distant stars, and it's a tile we already ship.
    layer2: (s) => ({
      backgroundImage: GRAIN_URI,
      backgroundSize: '420px 420px',
      mixBlendMode: 'color-dodge',
      opacity: s * 0.3,
    }),
  },
  {
    id: 'interference',
    name: 'Interference',
    blurb: 'Two signals fighting. Moire where they meet.',
    backdrop: (s) => `contrast(${(1 + s * 0.5).toFixed(2)}) saturate(${(1 + s * 1.6).toFixed(2)})`,
    // Real moire, not a picture of moire: two fine gratings at slightly
    // different pitch, `difference`d together. The pattern that appears is
    // emergent, and rotating one grating makes it crawl and breathe.
    layer: (s) => ({
      background: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 1px, transparent 1px, transparent 3px)',
      mixBlendMode: 'difference',
      opacity: 0.3 + s * 0.7,
      animation: 'unclaw-fx-moire-a 11s linear infinite',
    }),
    layer2: (s) => ({
      background: 'repeating-linear-gradient(0deg, rgba(0, 220, 255, 0.5) 0px, rgba(0, 220, 255, 0.5) 1px, transparent 1px, transparent 3.4px)',
      mixBlendMode: 'difference',
      opacity: 0.3 + s * 0.7,
      animation: 'unclaw-fx-moire-b 9s linear infinite',
    }),
  },
  {
    id: 'thermal',
    name: 'Thermal',
    blurb: 'Predator vision. She runs hot.',
    // Crushing to luminance then rotating hue hard maps brightness onto the
    // heat ramp. Skin is the hottest thing in frame, so she lights up.
    backdrop: (s) =>
      `grayscale(1) contrast(${(1 + s * 1.1).toFixed(2)}) brightness(${(1 + s * 0.15).toFixed(2)}) sepia(${s.toFixed(2)}) hue-rotate(${(140 + s * 60).toFixed(0)}deg) saturate(${(1 + s * 6).toFixed(1)})`,
    layer: (s) => ({
      background: 'radial-gradient(ellipse at 50% 40%, rgba(255, 60, 0, 0.28) 0%, transparent 55%)',
      mixBlendMode: 'color-dodge',
      opacity: s,
    }),
    layer2: (s) => ({
      background: SCANLINE(5, 0.22),
      opacity: s * 0.7,
    }),
  },
  {
    id: 'acid',
    name: 'Acid',
    blurb: 'The whole spectrum, on a loop.',
    backdrop: (s) => `saturate(${(1 + s * 3).toFixed(1)}) contrast(${(1 + s * 0.4).toFixed(2)})`,
    layer: (s) => ({
      // The hue cycle lives on the layer, not the backdrop, so the animation
      // runs on the compositor instead of re-filtering the video every frame.
      backdropFilter: 'hue-rotate(0deg)',
      WebkitBackdropFilter: 'hue-rotate(0deg)',
      opacity: s,
      animation: 'unclaw-fx-acid 6s linear infinite',
    }),
  },
  {
    id: 'bloom',
    name: 'Bloom',
    blurb: 'Light bleeds. Highlights halate like film.',
    backdrop: (s) => `contrast(${(1 + s * 0.2).toFixed(2)})`,
    layer: (s) => ({
      backdropFilter: `blur(${(3 + s * 14).toFixed(1)}px) brightness(${(1 + s * 0.9).toFixed(2)}) saturate(${(1 + s * 0.5).toFixed(2)})`,
      WebkitBackdropFilter: `blur(${(3 + s * 14).toFixed(1)}px) brightness(${(1 + s * 0.9).toFixed(2)}) saturate(${(1 + s * 0.5).toFixed(2)})`,
      // Screening the blurred copy back over the sharp one IS the bloom.
      mixBlendMode: 'screen',
      opacity: 0.2 + s * 0.55,
    }),
  },
  {
    id: 'noir',
    name: 'Noir',
    blurb: 'Black and white, no mercy.',
    backdrop: (s) =>
      `grayscale(1) contrast(${(1 + s * 0.9).toFixed(2)}) brightness(${(1 - s * 0.12).toFixed(2)})`,
    layer: (s) => ({
      background: `radial-gradient(ellipse at 50% 42%, transparent ${(46 - s * 16).toFixed(0)}%, rgba(0,0,0,${(s * 0.8).toFixed(2)}) 100%)`,
    }),
    layer2: (s) => ({
      backgroundImage: GRAIN_URI,
      mixBlendMode: 'overlay',
      opacity: s * 0.3,
      animation: 'unclaw-fx-grain 260ms steps(3, end) infinite',
    }),
  },
  {
    id: 'dream',
    name: 'Dream',
    blurb: 'Soft focus, lifted blacks.',
    backdrop: (s) => `saturate(${(1 + s * 0.4).toFixed(2)}) contrast(${(1 - s * 0.22).toFixed(2)}) brightness(${(1 + s * 0.1).toFixed(2)})`,
    layer: (s) => ({
      backdropFilter: `blur(${(s * 10).toFixed(1)}px)`,
      WebkitBackdropFilter: `blur(${(s * 10).toFixed(1)}px)`,
      // A veil of the blurred image over the sharp one: diffusion, not blur.
      opacity: s * 0.6,
    }),
    layer2: (s) => ({
      background: 'radial-gradient(ellipse at 50% 38%, rgba(255, 214, 200, 0.22) 0%, transparent 70%)',
      mixBlendMode: 'screen',
      opacity: s * 0.9,
    }),
  },
  {
    id: 'ember',
    name: 'Ember',
    blurb: 'Warm grade, the house accent in the shadows.',
    backdrop: (s) => `saturate(${(1 + s * 0.5).toFixed(2)}) contrast(${(1 + s * 0.22).toFixed(2)})`,
    layer: (s) => ({
      background: `radial-gradient(ellipse at 50% 40%, rgba(255, 176, 130, ${(s * 0.3).toFixed(2)}) 0%, transparent 55%),
                   radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(150, 30, 30, ${(s * 0.6).toFixed(2)}) 100%)`,
      mixBlendMode: 'soft-light',
      opacity: 0.6 + s * 0.4,
    }),
  },
  {
    id: 'vignette',
    name: 'Vignette',
    blurb: 'Darkened edges. Pulls the eye to her.',
    layer: (s) => ({
      background: `radial-gradient(ellipse at 50% 45%, transparent ${(58 - s * 26).toFixed(0)}%, rgba(0,0,0,${(s * 0.85).toFixed(2)}) 100%)`,
    }),
  },
];

// Retired effects: hidden from the picker (definitions kept above but not
// exported, so a saved reference to one falls back to 'none' via effectFor).
const RETIRED_EFFECT_IDS = new Set([
  'vignette', 'ember', 'grid', 'scanner', 'hologram', 'vhs', 'glitch',
]);
export const STREAM_EFFECTS: StreamEffectDef[] =
  ALL_STREAM_EFFECTS.filter((e) => !RETIRED_EFFECT_IDS.has(e.id));

export const EFFECTS_BY_ID: Record<string, StreamEffectDef> =
  Object.fromEntries(STREAM_EFFECTS.map((e) => [e.id, e]));

export const DEFAULT_EFFECT_ID = 'none';
export const DEFAULT_EFFECT_STRENGTH = 0.5;

export function effectFor(id: string | undefined): StreamEffectDef {
  return EFFECTS_BY_ID[id ?? DEFAULT_EFFECT_ID] ?? EFFECTS_BY_ID[DEFAULT_EFFECT_ID];
}

/**
 * The live overlay. Mounted over the stream for the whole session, not just
 * during customization, because the effect is part of how she looks.
 *
 * pointerEvents stays off on every layer: the PixelStreaming lib forwards
 * mouse input from the video underneath, and a pane that eats clicks would
 * silently break dragging her around.
 */
export function StreamEffects({ effectId, strength }: {
  effectId?: string;
  strength?: number;
}) {
  const fx = effectFor(effectId);
  const s = clamp01(strength ?? DEFAULT_EFFECT_STRENGTH);

  const panes = useMemo(() => {
    if (fx.id === 'none' || s <= 0) return [];
    const out: React.CSSProperties[] = [];
    if (fx.backdrop) {
      const f = fx.backdrop(s);
      out.push({ backdropFilter: f, WebkitBackdropFilter: f });
    }
    if (fx.layer) out.push(fx.layer(s));
    if (fx.layer2) out.push(fx.layer2(s));
    return out;
  }, [fx, s]);

  if (panes.length === 0) return null;

  return (
    <>
      {panes.map((style, i) => (
        <div
          key={`${fx.id}-${i}`}
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            // Above the video, below every piece of chrome (which starts at
            // z-index 10). The effect grades HER, not the UI.
            zIndex: 5,
            ...style,
          }}
        />
      ))}
      <style>{`
        /* Grain must JUMP, so every step is a big incoherent shift. Small
           offsets read as the texture sliding, which instantly looks fake. */
        @keyframes unclaw-fx-grain {
          0%   { background-position: 0 0; }
          20%  { background-position: -90px 60px; }
          40%  { background-position: 130px -70px; }
          60%  { background-position: -60px -120px; }
          80%  { background-position: 100px 90px; }
          100% { background-position: 0 0; }
        }
        /* The tracking band crawls UP: tape drifts against the head sweep. */
        @keyframes unclaw-fx-vhs {
          0%   { transform: translateY(100%); }
          100% { transform: translateY(-100%); }
        }
        /* 60Hz beat frequency. Two steps, tiny delta: any more and it's a
           strobe, any less and you don't feel the tube. */
        @keyframes unclaw-fx-flicker {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.88; }
        }
        /* The slow roll bar every CRT has when a camera films it. */
        @keyframes unclaw-fx-roll {
          0%   { background-position: 0 0, 0 -100%, 0 0; }
          100% { background-position: 0 0, 0 200%, 0 0; }
        }
        /* Tearing: steps(1) so slices SNAP to new offsets instead of sliding.
           The irregular timing is the point; a clean loop reads as a pattern. */
        @keyframes unclaw-fx-tear {
          0%   { transform: translate(0, 0); }
          14%  { transform: translate(-9px, 3px); }
          22%  { transform: translate(6px, -2px); }
          33%  { transform: translate(0, 0); }
          61%  { transform: translate(11px, 5px); }
          68%  { transform: translate(-4px, -6px); }
          74%  { transform: translate(0, 0); }
          91%  { transform: translate(-14px, 0); }
          100% { transform: translate(0, 0); }
        }
        @keyframes unclaw-fx-acid {
          0%   { backdrop-filter: hue-rotate(0deg);   -webkit-backdrop-filter: hue-rotate(0deg); }
          100% { backdrop-filter: hue-rotate(360deg); -webkit-backdrop-filter: hue-rotate(360deg); }
        }
        /* Hologram: the sweep runs bottom-to-top, the way a projector refreshes
           its volume. Slower than the CRT roll so the two never read alike. */
        @keyframes unclaw-fx-holo {
          0%   { background-position: 0 120%; }
          100% { background-position: 0 -120%; }
        }
        /* Instability. Uneven steps on purpose: a rhythmic flicker reads as a
           loop, an arrhythmic one reads as a signal in trouble. */
        @keyframes unclaw-fx-holoflick {
          0%, 100% { opacity: 1; }
          8%       { opacity: 0.55; }
          11%      { opacity: 1; }
          43%      { opacity: 0.78; }
          46%      { opacity: 1; }
          72%      { opacity: 0.4; }
          76%      { opacity: 1; }
        }
        /* The beam decelerates at each end (the cubic-bezier does that) so it
           feels like a mechanism reversing, not a light on a timer. */
        @keyframes unclaw-fx-scan {
          0%   { background-position: 0 -100%; }
          100% { background-position: 0 200%; }
        }
        /* Scroll exactly one cell so the grid loops seamlessly and reads as
           infinite. Any other distance and you see it jump. */
        @keyframes unclaw-fx-grid {
          0%   { background-position: 0 0, 0 0; }
          100% { background-position: 0 0, 0 44px; }
        }
        @keyframes unclaw-fx-nebula {
          0%, 100% { background-position: 0% 0%, 100% 100%, 50% 100%; }
          33%      { background-position: 60% 40%, 20% 60%, 80% 20%; }
          66%      { background-position: 20% 80%, 70% 10%, 10% 60%; }
        }
        /* The two gratings drift at different rates. Their BEAT is the moire;
           if they moved together you'd just see stripes. */
        @keyframes unclaw-fx-moire-a {
          0%   { transform: rotate(0deg)   scale(1.5); }
          100% { transform: rotate(4deg)   scale(1.5); }
        }
        @keyframes unclaw-fx-moire-b {
          0%   { transform: rotate(-3deg)  scale(1.5); }
          100% { transform: rotate(2deg)   scale(1.5); }
        }
        @media (prefers-reduced-motion: reduce) {
          /* The look survives; the motion doesn't. Vestibular sensitivity is
             not a reason to lose the grade, only the flicker. */
          [style*="unclaw-fx-"] { animation: none !important; }
        }
      `}</style>
    </>
  );
}

/**
 * A tiny procedural preview of an effect, for the picker.
 *
 * It cannot show the real stream: cloning a WebRTC MediaStream into nine live
 * <video> tiles would mean nine composites of a 60fps frame just to draw a
 * menu. So each tile renders a stand-in "scene" (a warm key light on the navy
 * backdrop, which is exactly what she is) and applies the SAME css the real
 * effect uses, with `filter` standing in for `backdrop-filter` since there's a
 * real element beneath rather than a video.
 */
export function EffectSwatch({ effect, strength = 0.85 }: {
  effect: StreamEffectDef;
  strength?: number;
}) {
  const s = clamp01(strength);
  const backdrop = effect.backdrop?.(s);

  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        // The stand-in scene: her, abstracted to two shapes.
        background:
          'radial-gradient(ellipse at 50% 34%, #e8c9b4 0%, #b98d78 22%, transparent 46%), linear-gradient(#243050, #141a2c)',
        filter: backdrop,
      }}
    >
      {effect.layer && <span style={{ position: 'absolute', inset: 0, ...stripBackdrop(effect.layer(s)) }} />}
      {effect.layer2 && <span style={{ position: 'absolute', inset: 0, ...stripBackdrop(effect.layer2(s)) }} />}
    </span>
  );
}

/** backdrop-filter needs a compositing root to look through; inside a 52px tile
 *  it reads as a smear. Drop it and let the painted layers carry the preview. */
function stripBackdrop(style: React.CSSProperties): React.CSSProperties {
  const { backdropFilter, WebkitBackdropFilter, animation, ...rest } = style as Record<string, unknown>;
  void backdropFilter; void WebkitBackdropFilter; void animation;
  return rest as React.CSSProperties;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
