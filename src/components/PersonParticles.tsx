// PersonParticles — the "coming to life" reveal for a freshly captured photo.
//
// Samples the uploaded preview through its person matte and rebuilds ONLY the
// person as a field of GPU particles: they assemble from a soft scatter into
// the portrait, breathe with a slow drift, and repel around the pointer with a
// springy return. All simulation runs in the vertex shader (home position +
// per-particle seed attributes, time/mouse as uniforms), so the CPU cost per
// frame is one uniform upload — same ogl + RAF/ref pattern as Strands.tsx.
//
// Brand notes: motion is organic (breathing sines, eased assembly), never
// snapping; the palette is the photo's own, with the warm accent reserved for
// a sparse ember shimmer on ~4% of particles.

import { useEffect, useRef } from 'react';
import { sampleDepth, type DepthMap } from '../vision/faceLandmarks';
import { Renderer, Program, Geometry, Mesh } from 'ogl';

const VERT = /* glsl */ `
  precision highp float;

  attribute vec2 aHome;    // uv, origin top-left, y down
  attribute vec3 aColor;
  attribute vec4 aSeed;    // x,y: unit scatter dir · z: 0..1 size/phase · w: 0..1 stagger

  uniform float uTime;
  attribute float aDepth;
  uniform float uProgress; // 0 scattered -> 1 assembled
  uniform vec2  uMouse;    // same uv space as aHome
  uniform float uMouseForce;
  uniform vec2  uTilt;     // eased pointer offset from center, for parallax
  uniform float uMorph;    // 0 portrait -> 1 frame orbit (global; staggered per particle)
  uniform float uFlow;     // laps travelled around the frame
  uniform float uAspect;   // CANVAS w/h -- all circular fields live in canvas space
  uniform vec2  uFitScale; // contain-fit of the image into the canvas...
  uniform vec2  uFitOffset;// ...so portraits letterbox instead of stretching
  uniform float uDpr;
  uniform float uPointBase;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vEmber;
  varying float vLift;
  varying float vRing;

  // 2D simplex noise (Ashima / Ian McEwan, MIT) — smooth spatial noise for
  // the orbit-state wander. Nearby particles sample nearby values, so the
  // field billows coherently instead of buzzing.
  vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    // The portrait falls in from above, crown first, rather than condensing out
    // of an even scatter. Arrival reads as something being placed; a scatter
    // reads as noise settling, which is a weaker first impression of a face.
    //
    // aHome is image space with y increasing DOWNWARD, so staggering on aHome.y
    // lands the top of the head before the chin, and the drop offset is negative
    // y (above the final position). aSeed adds a little horizontal drift so the
    // curtain is not a rigid line.
    float delay = aHome.y * 0.55 + aSeed.w * 0.18;
    float t = clamp(uProgress * 1.85 - delay, 0.0, 1.0);
    float ease = 1.0 - pow(1.0 - t, 3.0);

    // Image-space home mapped into canvas space, aspect preserved (contain).
    vec2 home = aHome * uFitScale + uFitOffset;
    vec2 scatter = home + vec2(aSeed.x * 0.05, -(0.85 + 0.45 * aSeed.z));
    vec2 pos = mix(scatter, home, ease);

    // Facial relief. A slow sway displaces particles by their own depth, so the
    // nose and brow travel further than the cheeks and the portrait reads as a
    // surface rather than a flat plane. Amplitude stays small on purpose: this
    // is parallax, not a turntable, and anything larger tears the face apart.
    float relief = aDepth;
    vec2 sway = vec2(sin(uTime * 0.34), cos(uTime * 0.27) * 0.45);
    pos += sway * relief * 0.045 * ease;

    // Idle breathing drift, tiny and slow so the portrait holds together.
    float ph = aSeed.z * 6.2831;
    pos += vec2(
      sin(uTime * 0.62 + ph + aHome.y * 7.0),
      cos(uTime * 0.53 + ph * 1.7 + aHome.x * 6.0)
    ) * 0.0035 * (0.35 + aSeed.z) * ease;

    // Lazy swirl: a smooth curling flow field layered under the jitter, so
    // the dust drifts along flowlines instead of only vibrating in place.
    // Non-directional and slow — motion you feel more than see.
    vec2 q = home * vec2(uAspect, 1.0);
    pos += vec2(
      sin(q.x * 5.0 + uTime * 0.30) * cos(q.y * 4.0 - uTime * 0.22),
      cos(q.x * 4.0 - uTime * 0.26) * sin(q.y * 5.0 + uTime * 0.34)
    ) * 0.0026 * ease;

    // Hologram parallax: every particle carries a stable random depth; the
    // field tilts toward the pointer with near/far layers sliding opposite
    // ways, so the portrait reads as a shallow VOLUME, not a sheet.
    pos += uTilt * (aSeed.w - 0.5) * 0.05 * ease;

    // Ember lift-off: the sparse warm particles periodically leave home, rise
    // with a slight waver, burn out, and are reborn in place. De-synced by
    // seed so there are always a few sparks drifting off the portrait.
    float emberF = step(0.96, aSeed.z);
    float cycle = fract(uTime / 9.0 + aSeed.w * 7.0);
    float lift = emberF * smoothstep(0.05, 0.75, cycle) * ease;
    pos.y -= lift * 0.075;
    pos.x += lift * sin(cycle * 8.0 + ph) * 0.010;

    // Portrait <-> orbit morph. Staggered per particle (same trick as the
    // entrance) so the change sweeps through the swarm instead of snapping;
    // during transit every particle rides an upward arc — the assembly's
    // signature rise, replayed on each morph.
    //
    // The target: a WIDE, scattered ring of dust — everyone orbits clockwise,
    // each particle with its own radius and speed, so the annulus
    // continuously shears and swirls.
    float mp = smoothstep(0.0, 1.0, clamp(uMorph * 1.35 - aSeed.w * 0.35, 0.0, 1.0));

    // Stable per-particle randoms, decorrelated from aSeed's other uses.
    float r1 = fract(aSeed.w * 13.73 + aSeed.z * 5.19);  // slot along the ring
    float r2 = fract(aSeed.z * 17.62 + aSeed.w * 7.41);  // radius
    float r3 = fract(aSeed.w * 29.17 + 0.37);            // speed

    // y is flipped at projection, so +angle spins CLOCKWISE on screen.
    // Radius scattered across a fat annulus + radial shimmer.
    float ang = 6.2831 * fract(r1 + uFlow * (0.8 + 0.5 * r3));
    // The ring is a TRUE circle in aspect-true space and must never be
    // stretched. To stay inside a frame of any shape it is scaled by the
    // NARROW axis: half-width is 0.5*uAspect, half-height 0.5, so the smaller
    // of the two is the usable radius. A portrait frame simply gets a smaller
    // circle rather than an squashed one.
    float fit = min(0.5 * uAspect, 0.5);
    float R = (0.30 + 0.34 * r2) * fit
            + 0.014 * sin(uTime * 1.15 + ph * 4.0) * fit;
    vec2 tw = vec2(0.5 * uAspect, 0.5) + vec2(cos(ang), sin(ang)) * R;
    tw += aSeed.xy * 0.010;
    // Simplex wander while orbiting: two decorrelated noise fields sampled at
    // the particle's travelling position push the dust around smoothly — the
    // ring billows and breathes as it circles instead of running on rails.
    vec2 np = tw * 6.5 + vec2(uTime * 0.22, -uTime * 0.18);
    vec2 nOff = vec2(snoise(np), snoise(np + vec2(31.4, 17.2)));
    tw += nOff * 0.036 * (0.6 + 0.4 * aSeed.z);

    pos = mix(pos, tw / vec2(uAspect, 1.0), mp);  // back to canvas space
    pos.y -= sin(3.14159 * mp) * (0.035 + 0.05 * aSeed.z);

    // Mouse repulsion in aspect-true space, gaussian falloff, springy because
    // the home pull is implicit (displacement, not velocity).
    vec2 world = pos * vec2(uAspect, 1.0);
    vec2 mw = uMouse * vec2(uAspect, 1.0);
    vec2 away = world - mw;
    float d2 = dot(away, away);
    float influence = exp(-d2 * 34.0) * uMouseForce;
    pos += (away / (sqrt(d2) + 1e-4)) * influence * 0.085 / vec2(uAspect, 1.0);

    gl_Position = vec4(pos.x * 2.0 - 1.0, 1.0 - pos.y * 2.0, 0.0, 1.0);

    // Brighter pixels get slightly larger sprites — richer surface texture
    // for free, and highlights read as catching the light.
    float luma = dot(aColor, vec3(0.299, 0.587, 0.114));
    float size = uPointBase * (0.7 + aSeed.z * 0.9) * (0.78 + 0.45 * luma);
    // Slightly larger mid-flight so the assembly reads as embers settling.
    size *= 1.0 + (1.0 - ease) * 0.8;
    gl_PointSize = size * uDpr;

    vColor = aColor;
    vRing = mp;
    vEmber = emberF;
    vLift = lift;
    float twinkle = 0.82 + 0.18 * sin(uTime * (2.2 + aSeed.z * 2.0) + ph * 3.0);
    // Risers fade in fast, burn out near the top, and stay dark until reborn.
    float emberAlpha = smoothstep(0.0, 0.08, cycle) * (1.0 - smoothstep(0.5, 0.78, cycle));
    vAlpha = ease * twinkle * mix(1.0, emberAlpha, emberF);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vEmber;
  varying float vLift;
  varying float vRing;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float disc = smoothstep(0.5, 0.12, d);
    if (disc < 0.01) discard;
    // Sparse warm-accent embers pulse gently at rest and burn hotter as they
    // lift off the portrait.
    vec3 ember = vec3(0.769, 0.267, 0.267); // #c44444
    float pulse = 0.5 + 0.5 * sin(uTime * 1.4);
    float heat = clamp(0.55 * pulse + 0.45 * vLift, 0.0, 1.0);
    vec3 color = mix(vColor, ember, vEmber * heat);
    // In the ring state the swarm warms toward the Unclaw accent. A TINT, not
    // a repaint: each particle keeps its own sampled colour and hue relation,
    // it just leans red. Capped well below 1 so a blue shirt still reads blue.
    color = mix(color, color * ember * 2.2, vRing * 0.55);
    gl_FragColor = vec4(color, disc * vAlpha);
  }
`;

interface Sampled {
  homes: Float32Array;
  colors: Float32Array;
  seeds: Float32Array;
  /** Per-particle facial relief, 0 flat. All zero when no depth was supplied. */
  depths: Float32Array;
  count: number;
  aspect: number;
}

/** Downscale the preview, keep only matte-covered pixels, and pack particle
 *  attributes. Target ~18k particles regardless of source resolution. */
function sampleParticles(img: HTMLImageElement, matte: HTMLImageElement | null, depth?: DepthMap | null): Sampled | null {
  const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  const gridW = Math.round(Math.sqrt(19000 * aspect / 0.45)); // ~45% person coverage guess
  const w = Math.max(64, Math.min(240, gridW));
  const h = Math.max(64, Math.round(w / aspect));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, w, h);
  const rgb = ctx.getImageData(0, 0, w, h).data;

  let mask: Uint8ClampedArray | null = null;
  if (matte) {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(matte, 0, 0, w, h);
    mask = ctx.getImageData(0, 0, w, h).data;
  }

  const homes: number[] = [];
  const colors: number[] = [];
  const seeds: number[] = [];
  const depths: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (mask) {
        // The matte may encode coverage in luminance (white-on-black) or in
        // alpha; a mostly-opaque pixel defers to luminance.
        const a = mask[i + 3];
        const coverage = a < 250 ? a : mask[i];
        if (coverage < 96) continue;
      }
      const jx = (Math.random() - 0.5) * 0.8;
      const jy = (Math.random() - 0.5) * 0.8;
      const hx = (x + 0.5 + jx) / w;
      const hy = (y + 0.5 + jy) / h;
      homes.push(hx, hy);
      depths.push(depth ? sampleDepth(depth, hx, hy) : 0);
      // Slight lift so stream-dark photos still glow a little.
      colors.push(
        Math.min(1, (rgb[i] / 255) * 1.08 + 0.02),
        Math.min(1, (rgb[i + 1] / 255) * 1.08 + 0.02),
        Math.min(1, (rgb[i + 2] / 255) * 1.08 + 0.02),
      );
      const ang = Math.random() * Math.PI * 2;
      seeds.push(Math.cos(ang), Math.sin(ang), Math.random(), Math.random());
    }
  }
  const count = homes.length / 2;
  if (!count) return null;
  return {
    homes: new Float32Array(homes),
    colors: new Float32Array(colors),
    seeds: new Float32Array(seeds),
    depths: new Float32Array(depths),
    count,
    aspect,
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

export function PersonParticles({
  imageUrl,
  matteUrl,
  depth,
  style,
}: {
  imageUrl: string;
  matteUrl: string | null;
  /** Optional facial relief, 0 flat to 1 nearest. Gives the portrait parallax
   *  while it waits. Absent is fine: the field just stays flat. */
  depth?: DepthMap | null;
  style?: React.CSSProperties;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const aspectRef = useRef(3 / 4);
  // Held in a ref, not a dep: the depth map lands with the same photo it was
  // read from, and re-running the whole WebGL init when it arrives would
  // restart the assembly animation the user is already watching.
  const depthRef = useRef<DepthMap | null>(depth ?? null);
  depthRef.current = depth ?? null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let dead = false;
    let raf = 0;
    let renderer: Renderer | null = null;

    // Pointer state lives in refs; the RAF loop lerps toward the target so the
    // field feels sprung rather than glued to the cursor.
    const mouseTarget = { x: -10, y: -10 };
    const mouse = { x: -10, y: -10 };
    let forceTarget = 0;
    let force = 0;

    const onMove = (e: PointerEvent) => {
      const canvas = renderer?.gl.canvas as HTMLCanvasElement | undefined;
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      mouseTarget.x = (e.clientX - r.left) / Math.max(1, r.width);
      mouseTarget.y = (e.clientY - r.top) / Math.max(1, r.height);
      forceTarget = 1;
    };
    const onLeave = () => { forceTarget = 0; };

    let cleanupRef: (() => void) | null = null;

    (async () => {
      const [img, matte] = await Promise.all([
        loadImage(imageUrl),
        matteUrl ? loadImage(matteUrl).catch(() => null) : Promise.resolve(null),
      ]);
      if (dead) return;
      const sampled = sampleParticles(img, matte, depthRef.current);
      if (!sampled) return;
      aspectRef.current = sampled.aspect;

      renderer = new Renderer({ dpr: Math.min(2, window.devicePixelRatio || 1), alpha: true, depth: false, antialias: false });
      const gl = renderer.gl;
      gl.clearColor(0, 0, 0, 0);
      host.appendChild(gl.canvas);
      gl.canvas.style.width = '100%';
      gl.canvas.style.height = '100%';
      gl.canvas.style.display = 'block';

      const geometry = new Geometry(gl, {
        aHome: { size: 2, data: sampled.homes },
        aColor: { size: 3, data: sampled.colors },
        aSeed: { size: 4, data: sampled.seeds },
        aDepth: { size: 1, data: sampled.depths },
      });
      const program = new Program(gl, {
        vertex: VERT,
        fragment: FRAG,
        transparent: true,
        depthTest: false,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uMouse: { value: [ -10, -10 ] },
          uMouseForce: { value: 0 },
          uTilt: { value: [0, 0] },
          uMorph: { value: 0 },
          uFlow: { value: 0 },
          uAspect: { value: 1 },
          uFitScale: { value: [1, 1] },
          uFitOffset: { value: [0, 0] },
          uDpr: { value: Math.min(2, window.devicePixelRatio || 1) },
          uPointBase: { value: 3.2 },
        },
      });
      const points = new Mesh(gl, { mode: gl.POINTS, geometry, program });

      const resize = () => {
        if (!renderer) return;
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h);
        // Point size tracks canvas density so the portrait stays filled at any
        // panel size.
        program.uniforms.uPointBase.value = Math.max(2.2, (w / 240) * 1.9);
        // Circular fields (ring, mouse dimple, swirl) live in CANVAS space;
        // the image contain-fits inside so its aspect never stretches them.
        const canvasAspect = w / h;
        program.uniforms.uAspect.value = canvasAspect;
        const imageAspect = sampled.aspect;
        const fw = imageAspect >= canvasAspect ? 1 : imageAspect / canvasAspect;
        const fh = imageAspect >= canvasAspect ? canvasAspect / imageAspect : 1;
        program.uniforms.uFitScale.value = [fw, fh];
        program.uniforms.uFitOffset.value = [(1 - fw) / 2, (1 - fh) / 2];
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerleave', onLeave);

      // Morph timeline, relative to the end of the assembly: hold the portrait,
      // rise into the sphere, hold, rise back. The shader staggers + eases the
      // per-particle motion, so plain linear ramps are all that's needed here.
      const ASSEMBLE = 2.4;
      const HOLD_PORTRAIT = 5.0;
      const MORPH = 1.3;
      const HOLD_SPHERE = 2.6;
      const CYCLE = HOLD_PORTRAIT + MORPH + HOLD_SPHERE + MORPH;
      const morphAt = (t: number): number => {
        if (t <= ASSEMBLE) return 0;
        const ct = (t - ASSEMBLE) % CYCLE;
        if (ct < HOLD_PORTRAIT) return 0;
        if (ct < HOLD_PORTRAIT + MORPH) return (ct - HOLD_PORTRAIT) / MORPH;
        if (ct < HOLD_PORTRAIT + MORPH + HOLD_SPHERE) return 1;
        return 1 - (ct - HOLD_PORTRAIT - MORPH - HOLD_SPHERE) / MORPH;
      };

      const t0 = performance.now();
      const loop = (now: number) => {
        if (dead || !renderer) return;
        const t = (now - t0) / 1000;
        // ~2.4s eased assembly.
        const progress = Math.min(1, t / 2.4);
        mouse.x += (mouseTarget.x - mouse.x) * 0.12;
        mouse.y += (mouseTarget.y - mouse.y) * 0.12;
        force += (forceTarget - force) * 0.08;
        program.uniforms.uTime.value = t;
        program.uniforms.uProgress.value = progress;
        program.uniforms.uMouse.value = [mouse.x, mouse.y];
        program.uniforms.uMouseForce.value = force;
        // Parallax follows the same eased pointer, scaled by the same force so
        // the tilt relaxes back to flat when the pointer leaves.
        program.uniforms.uTilt.value = [(mouse.x - 0.5) * force, (mouse.y - 0.5) * force];
        program.uniforms.uMorph.value = morphAt(t);
        // Laps around the ring; a full circuit takes ~20s at base speed, with
        // per-particle multipliers in the shader spreading the flow out. The
        // orbit is the slow undercurrent; the simplex wander carries the life.
        program.uniforms.uFlow.value = t * 0.05;
        renderer.render({ scene: points });
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      // Cleanup for the async-created resources.
      cleanupRef = () => {
        ro.disconnect();
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerleave', onLeave);
        try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
        gl.canvas.remove();
      };
    })().catch(() => { /* image/GL failure: the overlay's static fallback stays */ });

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      cleanupRef?.();
      renderer = null;
    };
  }, [imageUrl, matteUrl]);

  return <div ref={hostRef} style={{ width: '100%', height: '100%', ...style }} />;
}
