// Client-side face detection + a coarse facial depth map, both from one
// MediaPipe FaceLandmarker pass.
//
// Two jobs, one model:
//
//   1. GATE. Reject a photo with no face before the pipeline spends a Rodin
//      credit and several minutes on it. A landscape, a pet or a blurry crowd
//      shot should fail in milliseconds with an honest message, not after two
//      minutes with a confusing one.
//
//   2. DEPTH, for the particle portrait only. The landmarker returns z per
//      point, so a rough facial relief is free here. This never enters the
//      character pipeline: the real geometry comes from the gen-3D bust and the
//      conform. It exists so the portrait has parallax while the user waits.
//
// Everything is local. The wasm and the .task file are served from `public/`,
// so this works offline and does not phone anywhere.

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

/** Lazily start the model. Deliberately not loaded at app boot: most sessions
 *  never open the add-character flow, and this is ~15 MB of wasm. */
function getLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe');
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/face_landmarker.task', delegate: 'GPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
    })().catch((e) => {
      // Never cache a failed init: a transient wasm fetch failure would
      // otherwise disable the gate for the rest of the session.
      landmarkerPromise = null;
      throw e;
    });
  }
  return landmarkerPromise;
}

export interface FaceRead {
  /** True when exactly one usable face was found. */
  found: boolean;
  /** Normalized 0-1 landmark positions plus raw z, empty when none. */
  points: Array<{ x: number; y: number; z: number }>;
  /** Face bounding box in normalized coords, for framing. */
  box?: { x: number; y: number; w: number; h: number };
}

/** Run the landmarker over a decoded image. Returns `found: false` rather than
 *  throwing when there is simply no face: that is a normal outcome, not an
 *  error, and the caller shows different copy for each. */
export async function readFace(source: ImageBitmap | HTMLImageElement): Promise<FaceRead> {
  const lm = await getLandmarker();
  const res = lm.detect(source);
  const first = res.faceLandmarks?.[0];
  if (!first || first.length === 0) return { found: false, points: [] };

  const points = first.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    found: true,
    points,
    box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}

export interface DepthMap {
  size: number;
  /** Row-major, 0 (far / off-face) to 1 (nearest point of the face). */
  data: Float32Array;
}

/**
 * Splat the landmark z values into a small grid and smooth them.
 *
 * A grid rather than a per-particle nearest-landmark search: the portrait has
 * ~19k particles against 478 landmarks, and the brute-force pairing is 9M
 * distance tests for a result nobody can see at that precision. A 64x64 map
 * blurred twice costs microseconds and samples in O(1).
 *
 * Off-face cells decay to 0 so the background particles stay flat and only the
 * face gains relief.
 */
export function buildDepthMap(points: FaceRead['points'], size = 64): DepthMap {
  const acc = new Float32Array(size * size);
  const hits = new Float32Array(size * size);
  if (points.length === 0) return { size, data: acc };

  // MediaPipe z is roughly "distance behind the nose plane", negative toward
  // the camera, in units of face width. Flip and normalize so 1 is nearest.
  let zMin = Infinity, zMax = -Infinity;
  for (const p of points) {
    if (p.z < zMin) zMin = p.z;
    if (p.z > zMax) zMax = p.z;
  }
  const span = Math.max(1e-4, zMax - zMin);

  for (const p of points) {
    const gx = Math.min(size - 1, Math.max(0, Math.round(p.x * (size - 1))));
    const gy = Math.min(size - 1, Math.max(0, Math.round(p.y * (size - 1))));
    const near = 1 - (p.z - zMin) / span;
    const i = gy * size + gx;
    acc[i] += near;
    hits[i] += 1;
  }
  for (let i = 0; i < acc.length; i++) if (hits[i] > 0) acc[i] /= hits[i];

  // Two box-blur passes: fills the gaps between landmarks and keeps the relief
  // smooth enough that neighbouring particles do not shear apart.
  let src = acc;
  for (let pass = 0; pass < 2; pass++) {
    const dst = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const sx = x + dx, sy = y + dy;
            if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
            const v = src[sy * size + sx];
            if (v === 0) continue;
            sum += v; n++;
          }
        }
        dst[y * size + x] = n > 0 ? sum / n : 0;
      }
    }
    src = dst;
  }
  return { size, data: src };
}

/** Bilinear sample, clamped. x/y are normalized image coords. */
export function sampleDepth(map: DepthMap, x: number, y: number): number {
  const { size, data } = map;
  const fx = Math.min(size - 1, Math.max(0, x * (size - 1)));
  const fy = Math.min(size - 1, Math.max(0, y * (size - 1)));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = data[y0 * size + x0] * (1 - tx) + data[y0 * size + x1] * tx;
  const b = data[y1 * size + x0] * (1 - tx) + data[y1 * size + x1] * tx;
  return a * (1 - ty) + b * ty;
}
