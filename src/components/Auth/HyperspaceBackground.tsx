// Three.js hyperspace-trail backdrop for the sign-in screen. Adapted
// from the FotonRender LoginBackground — same instanced-quad shader,
// retuned palette to UnClaw's accent (warm reds + cool slates instead
// of FotonRender's blues/pinks). Speed is constant; no hover coupling.
//
// 2000 instanced quads draw a single GPU call. Each quad is a long
// thin trail aimed at the camera; the vertex shader stretches it
// along the radial direction so the geometry reads as a streaking
// star/light. Additive blending makes overlapping trails bloom.

import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const COUNT = 1500;
const DEPTH = 100;
const MIN_RADIUS = 2;
const MAX_RADIUS = 14;

// Warm cinematic palette tuned to UnClaw's accent (#c44444). Punched
// up vs. the original FotonRender palette so the field reads as
// VIBRANT — accent reds at full saturation, more pronounced cool
// blues, brighter whites. The fragment shader's alpha multiplier
// (below) does the rest of the lifting.
const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [1.00, 1.00, 1.00],   // pure white core
  [0.85, 0.90, 1.00],   // cool blue-white
  [0.62, 0.72, 0.88],   // slate-blue
  [1.00, 0.42, 0.45],   // accent red
  [0.95, 0.32, 0.36],   // deep accent
  [0.62, 0.74, 1.00],   // bright sky-blue
];
const COLOR_WEIGHTS = [0.30, 0.22, 0.12, 0.18, 0.10, 0.08];

function pickColor(): readonly [number, number, number] {
  let r = Math.random();
  for (let i = 0; i < COLOR_WEIGHTS.length; i++) {
    r -= COLOR_WEIGHTS[i];
    if (r <= 0) return PALETTE[i];
  }
  return PALETTE[0];
}

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 aOffset;
  attribute float aSpeed;
  attribute vec3 aColor;
  attribute float aPhase;
  attribute float aSize;

  uniform float uTime;
  uniform float uTrailStretch;

  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vUv;
  varying float vBrightness;

  void main() {
    vUv = uv;
    float speed = aSpeed;
    float depth = ${DEPTH.toFixed(1)};

    float z = -(mod(aPhase * depth + uTime * speed * 5.0, depth));

    vec3 worldPos = vec3(aOffset.xy, z);

    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    vec4 clipPos = projectionMatrix * mvPos;

    vec2 ndc = clipPos.xy / clipPos.w;
    float ndcLen = length(ndc);
    vec2 radialDir = ndcLen > 0.001 ? ndc / ndcLen : vec2(0.0, 1.0);
    vec2 perpDir = vec2(-radialDir.y, radialDir.x);

    float proximity = smoothstep(-depth, -2.0, z);
    float taper = mix(1.0, 0.2, pow(1.0 - proximity, 2.0));
    // Trail length + close-up extension: split between the FotonRender
    // baseline (0.015 / 0.12) and the punched-up version (0.020 / 0.18).
    // Result: clearly streaks rather than dots, but doesn't dominate
    // the sign-in moment.
    float trailLength = speed * uTrailStretch * 0.017 * aSize
                      + proximity * proximity * 0.15;
    float trailWidth = (0.0045 + aSize * 0.0012) * taper;

    vec2 offset = radialDir * position.y * trailLength
                + perpDir   * position.x * trailWidth;
    clipPos.xy += offset * clipPos.w;

    float depthAlpha = smoothstep(-depth, -depth * 0.5, z)
                     * smoothstep(0.0, -5.0, z);
    // Center fade: split the difference (0.5 vs 0.4) at 0.45 — the
    // focal point still has breathing room, but trails reach a bit
    // further in than the original baseline.
    float centerFade = smoothstep(0.0, 0.45, ndcLen);

    vAlpha      = depthAlpha * centerFade;
    vColor      = aColor;
    vBrightness = aSize;

    gl_Position = clipPos;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vUv;
  varying float vBrightness;

  void main() {
    // Core glow: brighter at the trail's spine, soft falloff. Pow
    // exponent split between the original 2.0 and the punched 1.6.
    float coreX = 1.0 - abs(vUv.x - 0.5) * 2.0;
    coreX = pow(coreX, 1.8);

    // Length-wise body fade in/out at the head + tail.
    float body = smoothstep(0.0, 0.07, vUv.y) * smoothstep(1.0, 0.93, vUv.y);

    // Hotness boost at the head of the trail — split between baseline
    // (0.3) and the punched version (0.55).
    float hotness = smoothstep(0.68, 0.95, vUv.y) * 0.42;
    vec3 color = vColor + vec3(hotness);

    // Master alpha — muted further to let the sign-in card breathe.
    // 0.26 keeps trails visible as ambient atmosphere without ever
    // pulling focus from the form.
    float alpha = coreX * body * vAlpha * vBrightness * 0.26;
    if (alpha < 0.002) discard;

    gl_FragColor = vec4(color, alpha);
  }
`;

const TARGET_SPEED = 0.45;

function HyperspaceLines() {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const accTimeRef = useRef(0);
  const prevTimeRef = useRef(0);

  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.instanceCount = COUNT;
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setAttribute('uv', plane.getAttribute('uv'));

    const offsets = new Float32Array(COUNT * 3);
    const speeds = new Float32Array(COUNT);
    const colors = new Float32Array(COUNT * 3);
    const phases = new Float32Array(COUNT);
    const sizes = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = MIN_RADIUS + Math.random() * (MAX_RADIUS - MIN_RADIUS);

      offsets[i * 3 + 0] = Math.cos(angle) * r;
      offsets[i * 3 + 1] = Math.sin(angle) * r;
      offsets[i * 3 + 2] = Math.random() * DEPTH;

      speeds[i] = 0.5 + Math.random() * 2.5;
      phases[i] = Math.random();

      // Mix of dim-and-many + occasional hero streaks. Floor (0.5)
      // splits the original 0.4 and the punched 0.6 — dim trails
      // still resolve at the calmed-down alpha multiplier.
      sizes[i] =
        Math.random() < 0.11
          ? 1.5 + Math.random() * 1.0
          : 0.5 + Math.random() * 0.6;

      const c = pickColor();
      colors[i * 3 + 0] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
    }

    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aSpeed',  new THREE.InstancedBufferAttribute(speeds, 1));
    geo.setAttribute('aColor',  new THREE.InstancedBufferAttribute(colors, 3));
    geo.setAttribute('aPhase',  new THREE.InstancedBufferAttribute(phases, 1));
    geo.setAttribute('aSize',   new THREE.InstancedBufferAttribute(sizes, 1));
    return geo;
  }, []);

  useFrame(({ clock }) => {
    if (!matRef.current) return;
    const now = clock.elapsedTime;
    // Cap delta so a frame spike (tab focus return, etc.) doesn't
    // snap-jump the whole field.
    const delta = Math.min(now - prevTimeRef.current, 0.1);
    prevTimeRef.current = now;
    accTimeRef.current += delta * TARGET_SPEED;
    matRef.current.uniforms.uTime.value = accTimeRef.current;
  });

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={matRef}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
        uniforms={{
          uTime: { value: 0 },
          uTrailStretch: { value: 1 },
        }}
      />
    </mesh>
  );
}

export function HyperspaceBackground() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 0], fov: 75 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <HyperspaceLines />
      </Canvas>
    </div>
  );
}
