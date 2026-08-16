// Add-custom overlay — the desktop half of "make an agent from a photo".
//
// Flow: create a capture session on the store Worker -> render the session as
// a branded QR (same rounded-module + carved-logo treatment as the phone-
// connect QR) -> the user scans it with Unclaw Scan and takes one front depth
// photo -> we poll until the phone marks the upload complete -> download the
// preview + person matte -> the person reassembles as a mouse-reactive
// particle field while the (future) cloud pipeline runs.
//
// Layers over the AddCharacterPicker (zIndex 58 > 56); Escape closes just this
// overlay (capture-phase listener so the picker's own Esc handler stays deaf
// while we're up).

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PulseGrid } from './PulseGrid';
import { readFace, buildDepthMap, type DepthMap } from '../vision/faceLandmarks';
import QRCodeStyling from 'qr-code-styling';
import { ArrowLeft, ImageUp, RefreshCw } from 'lucide-react';
import logoUrl from '../assets/logo.png';
import { PersonParticles } from './PersonParticles';
import { HAIR, HAIR_GENDER, BROWS, LASHES } from '../wardrobe/catalog';
import {
  createCaptureSession,
  fetchCaptureStatus,
  cancelCaptureSession,
  fetchCaptureFile,
  captureQrPayload,
  type CaptureSession,
} from '../services/capture';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

type Phase = 'signin' | 'photo' | 'loading' | 'qr' | 'fetching' | 'reveal' | 'error' | 'expired';

const QR_PX = 228;

/** Vision-grooming args for the inference IPC: the user's photo + our groom
 *  catalogs. The credential is the PIPELINE's own OpenAI key (read by main
 *  from p1/secrets), never the user's BYOK chat key. */
interface GroomArgs {
  photoBytes: Uint8Array;
  hairs: { index: number; name: string }[];
  brows: { index: number; name: string }[];
  lashes: { index: number; name: string }[];
}

async function buildGroomArgs(photoBytes: Uint8Array): Promise<GroomArgs | undefined> {
  try {
    return {
      photoBytes,
      // Full list with gender tags: the model determines the person's gender
      // first, then must pick a style tagged for it (or unisex).
      hairs: HAIR.map((h) => {
        const tag = HAIR_GENDER[h.index] === 'm' ? 'male' : HAIR_GENDER[h.index] === 'f' ? 'female' : 'unisex';
        return { index: h.index, name: `${h.name} (${tag})` };
      }),
      brows: BROWS.map((b) => ({ index: b.index, name: b.name })),
      lashes: LASHES.map((l) => ({ index: l.index, name: l.name })),
    };
  } catch {
    return undefined;
  }
}

/** Pipeline stage -> human-facing status line. UE-job lines refine within the
 *  'identity' stage by matching the job's step markers. */
function friendlyStage(stage: string, line: string): string | null {
  switch (stage) {
    // --- legacy depth tier ---
    case 'prep': return 'Preparing your capture';
    case 'take': return 'Reading your depth capture';
    case 'photo-prep': return 'Studying your photo';
    case 'depth': return 'Synthesizing depth';
    case 'normals': return 'Reading surface detail';
    case 'fuse': return 'Fusing your face geometry';

    // --- H3D tier: the two long waits are 'rodin' and 'identity', so they get
    //     sub-labels rather than one frozen line for several minutes ---
    case 'clean': return 'Clearing hair and glasses';
    case 'rodin':
      if (line.includes('submitting')) return 'Sending your portrait to be sculpted';
      if (line.includes('queued')) return 'Waiting for a sculpting slot';
      if (line.includes('generating')) return 'Sculpting your head in 3D';
      if (line.includes('downloading') || line.includes('saved')) return 'Collecting your 3D head';
      return 'Sculpting your head in 3D';
    case 'normalize': return 'Squaring up your head';
    case 'trackshot': return 'Finding your features';
    case 'groom': return null; // runs in parallel; never steal the main label

    case 'identity':
      // run_bust_to_dna.py step markers, in the order they fire.
      if (line.includes('import_glb')) return 'Loading your head';
      if (line.includes('track_landmarks')) return 'Reading your features';
      if (line.includes('CONFORM')) return 'Matching your features';
      if (line.includes('pin_to_neutral')) return 'Fitting you to the body';
      if (line.includes('autorig')) return 'Rigging your character';
      if (line.includes('export_dna')) return 'Packing your identity';
      if (line.includes('export_sidecar') || line.includes('export_geometry')) return 'Placing your eyes and jaw';
      // legacy depth-tier markers
      if (line.includes('dna_requested') || line.includes('dna_delegate')) return 'Growing your rig';
      if (line.includes('import_from_identity') || line.includes('norig')) return 'Sculpting your likeness';
      if (line.includes('auto_rigging')) return 'Rigging your character';
      if (line.includes('textures')) return 'Painting skin';
      if (line.includes('can_build') || line.includes('build ')) return 'Assembling your character';
      if (line.includes('export')) return 'Packing your identity';
      return null; // keep the current label between markers

    case 'done': return 'Bringing your character in';
    case 'error': return 'Something went wrong';
    default: return null;
  }
}

/** Turn a pipeline error into something a person can act on. The normalizer
 *  rejects photos it cannot get a clean head from, and that is a retake, not a
 *  bug, so it must not read like a crash. */
function friendlyError(msg: string): string {
  if (msg.startsWith('RETAKE:')) return msg.slice(7).trim();
  if (/timed out/i.test(msg)) return 'That took too long and was stopped. Worth trying again.';
  if (/gemini/i.test(msg)) return 'Could not prepare your photo. Try a clearer, front-on picture.';
  if (/rodin|hyper3d/i.test(msg)) return 'The 3D sculpting step failed. Try again in a moment.';
  if (/missing tool|unavailable/i.test(msg)) return 'The local pipeline is not set up on this machine.';
  return 'Something went wrong making your character.';
}


/** The user-facing arc of a build. Deliberately says nothing about which
 *  services do the work: these are the stages of OUR process, not a vendor
 *  list, and the internals should be free to change without the UI lying. */
const STAGES = [
  { key: 'prepare', label: 'Preparing your photo' },
  { key: 'refine',  label: 'Clearing hair and glasses' },
  { key: 'sculpt',  label: 'Sculpting your head' },
  { key: 'align',   label: 'Squaring it up' },
  { key: 'match',   label: 'Matching your features' },
  { key: 'rig',     label: 'Building your rig' },
  { key: 'finish',  label: 'Finishing your agent' },
] as const;

/** Backend stage + log line -> index into STAGES. Returns -1 for lines that
 *  should not move the bar (the grooming read runs in parallel, and unmatched
 *  engine chatter must never rewind progress). */
function stageIndexFor(stage: string, line: string): number {
  switch (stage) {
    case 'prep': case 'take': case 'photo-prep': return 0;
    case 'clean': return 1;
    case 'rodin': return 2;
    case 'depth': case 'normals': case 'fuse': return 3;
    case 'normalize': case 'trackshot': return 3;
    case 'identity':
      if (line.includes('pin_to_neutral') || line.includes('autorig')) return 5;
      if (line.includes('export')) return 6;
      if (line.includes('CONFORM') || line.includes('track_landmarks')
          || line.includes('import_glb') || line.includes('fresh_char')) return 4;
      return 4;
    case 'done': return STAGES.length - 1;
    default: return -1;
  }
}

/** Segmented progress. One bar per stage so the length of the road is visible
 *  from the start: done stays lit, the live one breathes, the rest sit dim.
 *
 *  No gradients. A gradient here was decoration pretending to be information,
 *  and it read as cheap: the accent is precious, so it marks exactly one thing,
 *  which segment is working right now. */
function SegmentedProgress({ index, failed }: { index: number; failed: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, width: '100%' }}>
      <div style={{ display: 'flex', gap: 3, width: '100%' }}>
        {STAGES.map((s, i) => {
          const done = i < index;
          const live = i === index && !failed;
          const bad = i === index && failed;
          return (
            <div
              key={s.key}
              style={{
                position: 'relative',
                flex: 1,
                height: 2,
                borderRadius: 999,
                overflow: 'hidden',
                background: 'rgba(255,255,255,0.07)',
              }}
            >
              {done && (
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
                  style={{
                    position: 'absolute', inset: 0, transformOrigin: 'left',
                    background: 'rgba(255,255,255,0.34)',
                  }}
                />
              )}
              {bad && (
                <div style={{ position: 'absolute', inset: 0, background: 'var(--accent, #c44444)' }} />
              )}
              {live && (
                <motion.div
                  animate={{ opacity: [0.45, 1, 0.45] }}
                  transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ position: 'absolute', inset: 0, background: 'var(--accent, #c44444)' }}
                />
              )}
            </div>
          );
        })}
      </div>
      <span style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.16em',
        textIndent: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--text-ghost)',
        opacity: 0.7,
      }}>
        {failed ? 'Stopped' : `${Math.min(index + 1, STAGES.length)} of ${STAGES.length}`}
      </span>
    </div>
  );
}

/** What the read found, typed in as each value lands.
 *
 *  This is the only moment in a multi-minute build where the user sees evidence
 *  that the thing being made is theirs. It earns the motion. */
function Findings({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <AnimatePresence initial={false}>
        {items.map((f, i) => (
          <motion.div
            key={f.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE_OUT_EXPO, delay: i * 0.12 }}
            style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
            }}
          >
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--text-ghost)',
              opacity: 0.75,
            }}>
              {f.label}
            </span>
            <TypedValue text={f.value} delay={i * 0.12} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Types one value in, with the same block caret the sign-in title uses so the
 *  app only has one typing vocabulary. */
function TypedValue({ text, delay }: { text: string; delay: number }) {
  const [n, setN] = useState(0);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (reduced) { setN(text.length); return; }
    let i = 0;
    const start = window.setTimeout(() => {
      const id = window.setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length) window.clearInterval(id);
      }, 34);
    }, delay * 1000 + 120);
    return () => window.clearTimeout(start);
  }, [text, delay, reduced]);
  const done = n >= text.length;
  return (
    <span style={{
      fontSize: 12.5,
      fontWeight: 500,
      color: 'var(--text-primary)',
      textShadow: '0 1px 3px rgba(0,0,0,0.55)',
      whiteSpace: 'nowrap',
    }}>
      {text.slice(0, n)}
      {!done && (
        <span style={{
          display: 'inline-block',
          width: 6, height: 12,
          marginLeft: 1,
          verticalAlign: '-1px',
          background: 'var(--accent, #c44444)',
        }} />
      )}
    </span>
  );
}

/** Honours the app-wide reduced-motion contract rather than re-implementing it
 *  per component. */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Same branded treatment as CompanionPanel's phone-connect QR: rounded
 *  modules, soft finder eyes, accent finder dots, logo carved into the
 *  center (EC level H keeps it scannable around the carve-out). */
function makeQr(data: string): QRCodeStyling {
  return new QRCodeStyling({
    width: QR_PX,
    height: QR_PX,
    type: 'canvas',
    data,
    image: logoUrl,
    margin: 0,
    qrOptions: { errorCorrectionLevel: 'H' },
    dotsOptions: { type: 'rounded', color: '#141821' },
    cornersSquareOptions: { type: 'extra-rounded', color: '#141821' },
    cornersDotOptions: { type: 'dot', color: '#c44444' },
    backgroundOptions: { color: 'transparent' },
    imageOptions: {
      crossOrigin: 'anonymous',
      hideBackgroundDots: true,
      imageSize: 0.4,
      margin: 5,
    },
  });
}


/** Clamp the photo before it leaves the machine.
 *
 *  1024 on the long edge. Image generation is priced by output resolution, and
 *  2K roughly quadruples the pixels for a step whose job is only to remove hair
 *  and accessories. The generator resynthesizes the portrait at its own output
 *  size regardless, so a larger upload mostly buys a bigger bill.
 *
 *  The tradeoff is real and worth remembering: this route exists for jaw and
 *  profile fidelity, and 1K is where that detail starts to thin. If likeness
 *  ever looks soft around the jaw, this constant is the first thing to raise.
 *
 *  `imageOrientation: 'from-image'` applies the EXIF rotation, so a phone photo
 *  arrives upright instead of sideways.
 */
const MAX_EDGE = 1024;

async function preparePhoto(file: File): Promise<{ bytes: Uint8Array; ext: 'jpg'; aspect: number }> {
  // createImageBitmap decodes whatever the browser can open, which is how WebP,
  // HEIC-as-decoded and anything else arrive here without special cases.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  // Clamped so a panorama or a hard crop cannot wreck the overlay layout.
  const aspect = Math.min(2, Math.max(0.5, bitmap.width / Math.max(1, bitmap.height)));
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
  // Pass through ONLY an already-small JPEG. Everything else is re-encoded,
  // including PNG: the Gemini interactions endpoint accepts image/jpeg and
  // rejects image/png with a 400, so handing the pipeline anything else meant
  // the whole run failed on the first call.
  if (scale === 1 && file.type === 'image/jpeg' && file.size < 8 * 1024 * 1024) {
    bitmap.close();
    return { bytes: new Uint8Array(await file.arrayBuffer()), ext: 'jpg', aspect };
  }
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  if (!blob) throw new Error('resize failed');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'jpg', aspect };
}

export function AddCustomOverlay({
  authToken,
  onClose,
  onIdentityReady,
}: {
  authToken: string | null;
  onClose: () => void;
  /** DEV local-inference completion: artifacts are staged and ready for the
   *  applyIdentity descriptor. Parent creates the roster instance + switches. */
  onIdentityReady?: (r: {
    sessionId: string; dnaPath: string; blobPath: string; baseColorPath?: string;
    /** UJNT sidecar from the H3D tier; absent on the legacy blob route. */
    jointsPath?: string;
    /** MetaHuman Creator's skin-detail normal, H3D tier only. */
    normalPath?: string;
    grooming?: { gender: 'm' | 'f'; build?: 'skinny' | 'fit' | 'fat'; hairIndex: number; browIndex: number; lashIndex: number; hairColor?: string; eyeColor?: string;
      hairColorParams?: { melanin: number; redness: number }; irisVariant?: string };
  }) => void;
}) {
  const [phase, setPhase] = useState<Phase>(authToken ? 'photo' : 'signin');
  /** Drag-over highlight for the drop target. */
  const [dragging, setDragging] = useState(false);
  // The QR rendezvous needs the capture Worker deployed. Photo upload needs
  // nothing, so it is the default and the phone tier is opt-in.
  const [wantQr, setWantQr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [matteUrl, setMatteUrl] = useState<string | null>(null);
  /** Facial relief for the waiting portrait. Aesthetic only: the real geometry
   *  comes from the bust and the conform, never from here. */
  const [faceDepth, setFaceDepth] = useState<DepthMap | null>(null);
  const [inferLine, setInferLine] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const onIdentityReadyRef = useRef(onIdentityReady);
  onIdentityReadyRef.current = onIdentityReady;

  // Photo-only tier: user picked a flat picture instead of scanning the QR.
  // The particle reveal plays on the raw photo (no person matte locally) while
  // the synthesized-depth pipeline runs.
  const startPhotoInference = useCallback(async (file: File) => {
    const api = window.electronAPI?.identity;
    if (!api?.runH3D) { setInferLine('local inference unavailable'); return; }
    const { bytes, ext, aspect } = await preparePhoto(file);

    // Gate on a face BEFORE anything expensive runs. No face means no Rodin
    // credit and no two-minute wait ending in a confusing failure, and the same
    // pass gives us the relief used by the waiting portrait.
    let depth: DepthMap | null = null;
    try {
      const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
      const read = await readFace(bmp);
      bmp.close();
      if (!read.found) {
        setStageLabel("I can't find a face in that one. Try a front-on photo.");
        setInferLine('no face detected');
        setFailed(true);
        setPhase('reveal');
        return;
      }
      depth = buildDepthMap(read.points);
    } catch (e) {
      // Detector unavailable is NOT a reason to block a real photo: fall through
      // and let the pipeline judge it.
      console.warn('[face] gate skipped:', e);
    }
    setFaceDepth(depth);
    setPhotoAspect(aspect);
    const localId = 'ph_' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    const pUrl = URL.createObjectURL(file);
    urlsRef.current.push(pUrl);
    uploadedRef.current = true; // don't cancel the (unused) QR session on unmount churn
    setPreviewUrl(pUrl);
    setMatteUrl(null);
    setPhase('reveal');
    setStageIndex(0);
    setStageLabel(STAGES[0].label);
    try {
      const groom = await buildGroomArgs(bytes);
      const res = await api.runH3D({
        localId, photoBytes: bytes, ext,
        catalogs: groom ? { hairs: groom.hairs, brows: groom.brows, lashes: groom.lashes } : undefined,
      });
      if (!mountedRef.current) return;
      if (res.ok && res.dnaPath) {
        setInferLine('identity ready');
        onIdentityReadyRef.current?.({
          sessionId: localId,
          dnaPath: res.dnaPath,
          jointsPath: res.jointsPath,
          baseColorPath: res.baseColorPath,
          normalPath: res.normalPath,
          blobPath: '',
          grooming: res.grooming,
        });
      } else {
        setStageLabel(friendlyError(res.error ?? ''));
        setInferLine(res.error ?? 'unknown error');
        setFailed(true);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setStageLabel(friendlyError(msg));
      setInferLine(msg);
      setFailed(true);
    }
  }, []);

  const [stageLabel, setStageLabel] = useState<string | null>(null);
  /** What the photo read found, revealed as it lands. */
  const [findings, setFindings] = useState<Array<{ label: string; value: string }>>([]);
  const [failed, setFailed] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  /** The uploaded photo's aspect, so the particle frame matches it rather
   *  than letterboxing the person inside a fixed 3:4 box. */
  const [photoAspect, setPhotoAspect] = useState(3 / 4);
  const lastStageRef = useRef<string | null>(null);

  // Local-inference progress feed from main: raw line for the mono ticker,
  // stage markers mapped to the human-facing status.
  useEffect(() => {
    const api = window.electronAPI?.identity;
    if (!api?.onProgress) return;
    return api.onProgress(({ stage, line }) => {
      if (stage === 'findings') {
        try {
          const f = JSON.parse(line) as Record<string, string | undefined>;
          // A failed read used to be completely invisible: every path in
          // geminiPickGrooming swallows its error, and friendlyStage maps the
          // 'groom' stage to null so it cannot steal the status label. The
          // character then silently spawned with the generic's default hair.
          if (f.error) { setFindings([{ label: 'Photo read', value: f.error }]); return; }
          setFindings([
            f.hairColor ? { label: 'Hair', value: f.hairColor } : null,
            f.eyeColor ? { label: 'Eyes', value: f.eyeColor } : null,
            f.build ? { label: 'Build', value: f.build } : null,
            f.gender ? { label: 'Read as', value: f.gender } : null,
          ].filter(Boolean) as Array<{ label: string; value: string }>);
        } catch { /* malformed findings never break the run */ }
        return;
      }
      // Raw engine output is NOT surfaced: it names the services we call.
      // It still goes to the console for debugging.
      console.debug('[identity]', stage, line);
      const idx = stageIndexFor(stage, line);
      // Monotonic: unmatched chatter and the parallel grooming read must never
      // rewind the bar.
      if (idx >= 0) setStageIndex((cur) => (idx > cur ? idx : cur));
      const label = friendlyStage(stage, line);
      if (label) {
        setStageLabel(label);
      } else if (stage !== lastStageRef.current && stage === 'identity') {
        // Entering the UE job: set the stage default once, then let markers
        // refine it (unmatched UE log lines must not reset the label).
        setStageLabel('Solving your identity');
      }
      lastStageRef.current = stage;
    });
  }, []);

  const sessionRef = useRef<CaptureSession | null>(null);
  const qrBoxRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<QRCodeStyling | null>(null);
  const mountedRef = useRef(true);
  // Blob URLs to revoke on unmount.
  const urlsRef = useRef<string[]>([]);
  // Once the phone finished, don't cancel the session on close/unmount.
  const uploadedRef = useRef(false);
  const [nonce, setNonce] = useState(0); // bump to mint a fresh session

  // Escape closes this overlay only (capture phase beats the picker's
  // document-level bubble listener).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Session lifecycle: create -> QR -> poll -> fetch preview/matte -> reveal.
  useEffect(() => {
    mountedRef.current = true;
    uploadedRef.current = false;
    if (!authToken) { setPhase('signin'); return () => { mountedRef.current = false; }; }
    // No session is created for the photo tier: the file never leaves the machine.
    if (!wantQr) { setPhase('photo'); return () => { mountedRef.current = false; }; }

    let pollId: ReturnType<typeof setInterval> | null = null;
    setPhase('loading');
    setError(null);

    (async () => {
      const session = await createCaptureSession(authToken);
      if (!mountedRef.current) return;
      sessionRef.current = session;
      setPhase('qr');

      const tick = async () => {
        try {
          const s = await fetchCaptureStatus(authToken, session.sessionId);
          if (!mountedRef.current) return;
          if (s.status === 'uploaded' || s.status === 'processing' || s.status === 'complete') {
            if (pollId) { clearInterval(pollId); pollId = null; }
            uploadedRef.current = true;
            setPhase('fetching');
            const [preview, matte] = await Promise.all([
              fetchCaptureFile(authToken, session.sessionId, 'preview.jpg'),
              fetchCaptureFile(authToken, session.sessionId, 'matte.png').catch(() => null),
            ]);
            if (!mountedRef.current) return;
            const pUrl = URL.createObjectURL(preview);
            urlsRef.current.push(pUrl);
            setPreviewUrl(pUrl);
            if (matte) {
              const mUrl = URL.createObjectURL(matte);
              urlsRef.current.push(mUrl);
              setMatteUrl(mUrl);
            }
            setPhase('reveal');
            // DEV: run the local inference pipeline on the full capture while
            // the particle reveal plays. On success the parent creates the
            // custom instance and switches to it.
            void (async () => {
              const api = window.electronAPI?.identity;
              if (!api?.runInference || !onIdentityReadyRef.current) return;
              try {
                setInferLine('downloading capture bundle');
                const zip = await fetchCaptureFile(authToken, session.sessionId, 'capture.zip');
                const bytes = new Uint8Array(await zip.arrayBuffer());
                const groom = await buildGroomArgs(new Uint8Array(await preview.arrayBuffer()));
                const res = await api.runInference({ sessionId: session.sessionId, zipBytes: bytes, groom });
                if (!mountedRef.current) return;
                if (res.ok && res.blobPath) {
                  setInferLine('identity ready');
                  onIdentityReadyRef.current?.({
                    sessionId: session.sessionId,
                    dnaPath: res.dnaPath ?? '',
                    blobPath: res.blobPath,
                    baseColorPath: res.baseColorPath,
                    grooming: res.grooming,
                  });
                } else {
                  setInferLine(`inference failed: ${res.error ?? 'unknown'}`);
                }
              } catch (e) {
                if (mountedRef.current) {
                  setInferLine(`inference failed: ${e instanceof Error ? e.message : String(e)}`);
                }
              }
            })();
          } else if (s.status === 'expired' || s.status === 'cancelled' || s.status === 'failed') {
            if (pollId) { clearInterval(pollId); pollId = null; }
            setPhase('expired');
          }
        } catch { /* transient — keep polling */ }
      };
      void tick();
      pollId = setInterval(tick, 2500);
    })().catch((e) => {
      if (!mountedRef.current) return;
      // The phone tier is optional; if its Worker is unreachable, fall back to
      // photo upload instead of stranding the user on an error.
      setError(e instanceof Error ? e.message : String(e));
      setWantQr(false);
      setPhase('photo');
    });

    return () => {
      mountedRef.current = false;
      if (pollId) clearInterval(pollId);
      // Walking away mid-QR invalidates the session so a stale QR on screen
      // can't be redeemed later. A finished upload is left alone — the bundle
      // is the pipeline's input.
      const session = sessionRef.current;
      if (session && !uploadedRef.current && authToken) {
        void cancelCaptureSession(authToken, session.sessionId);
      }
      sessionRef.current = null;
      qrRef.current = null;
      for (const u of urlsRef.current) URL.revokeObjectURL(u);
      urlsRef.current = [];
    };
  }, [authToken, nonce, wantQr]);

  // Draw the QR the moment its box attaches. A phase-driven effect misses the
  // mount: AnimatePresence mode="wait" keeps the qr stage unmounted until the
  // previous stage finishes exiting, so at phase-flip time the box ref is
  // still null and the effect would never re-run.
  const attachQrBox = useCallback((node: HTMLDivElement | null) => {
    qrBoxRef.current = node;
    const session = sessionRef.current;
    if (!node || !session) return;
    const data = captureQrPayload(session);
    if (!qrRef.current) {
      qrRef.current = makeQr(data);
    } else {
      qrRef.current.update({ data });
    }
    node.innerHTML = '';
    qrRef.current.append(node);
  }, []);

  const retry = useCallback(() => { qrRef.current = null; setNonce((n) => n + 1); }, []);

  return (
    <motion.div
      role="dialog"
      aria-label="Add a custom agent"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 58,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 22,
        pointerEvents: 'auto',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.62) 100%)',
          backdropFilter: 'blur(30px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(30px) saturate(1.3)',
        }}
      />

      {/* back */}
      <motion.button
        type="button"
        onClick={onClose}
        aria-label="Back"
        title="Back"
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT_EXPO, delay: 0.1 }}
        whileTap={{ scale: 0.94 }}
        style={{
          position: 'absolute',
          top: 80,
          left: 14,
          width: 32,
          height: 32,
          padding: 0,
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid rgba(255, 255, 255, 0.10)',
          color: 'var(--text-primary)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <ArrowLeft size={15} strokeWidth={1.8} />
      </motion.button>

      {/* heading */}
      <motion.span
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_OUT_EXPO, delay: 0.06 }}
        style={{
          position: 'relative',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          color: 'var(--text-ghost)',
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}
      >
        {phase === 'reveal' || phase === 'fetching' ? 'Creating your agent' : 'Add a custom agent'}
      </motion.span>

      <AnimatePresence mode="wait">
        {phase === 'signin' && (
          <Stage key="signin">
            <Hint>Sign in to create a custom agent.</Hint>
          </Stage>
        )}

        {phase === 'loading' && (
          <Stage key="loading">
            <Hint>Preparing your capture session…</Hint>
          </Stage>
        )}

        {(phase === 'error' || phase === 'expired') && (
          <Stage key="error">
            <Hint>
              {phase === 'expired'
                ? 'That code expired before a photo arrived.'
                : `Couldn't start a capture session${error ? ` (${error})` : ''}.`}
            </Hint>
            <button
              type="button"
              onClick={retry}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '8px 16px',
                borderRadius: 999,
                background: 'var(--glass-bg-panel, rgba(40, 48, 65, 0.55))',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'var(--text-primary)',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                backdropFilter: 'var(--glass-blur)',
                WebkitBackdropFilter: 'var(--glass-blur)',
              }}
            >
              <RefreshCw size={13} strokeWidth={2} />
              New code
            </button>
          </Stage>
        )}

        {phase === 'photo' && (
          <Stage
            key="photo"
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={(e) => {
              // Only clear when the pointer actually leaves the stage, not when
              // it crosses onto a child element (which also fires dragleave).
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
              if (file) void startPhotoInference(file);
            }}
            style={dragging ? { outline: '1px solid rgba(196,68,68,0.9)', outlineOffset: 6, borderRadius: 14 } : undefined}
          >
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              style={{
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                width: 228,
                height: 168,
                borderRadius: 16,
                background: 'var(--glass-bg, rgba(40, 48, 65, 0.38))',
                border: '1px dashed rgba(255,255,255,0.20)',
                backdropFilter: 'var(--glass-blur)',
                WebkitBackdropFilter: 'var(--glass-blur)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                transition: 'border-color 200ms var(--ease-out-quart)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent, #c44444) 55%, transparent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.20)'; }}
            >
              <ImageUp size={26} strokeWidth={1.6} style={{ color: 'var(--text-secondary)' }} />
              <span style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textIndent: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
              }}>
                Choose a photo
              </span>
            </button>
            <Hint>
              {dragging
                ? 'Drop to use this photo.'
                : 'One front-on photo, face clearly visible and evenly lit. Click or drag one in.'}
            </Hint>
            <button
              type="button"
              onClick={() => { setError(null); setWantQr(true); }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '7px 14px',
                borderRadius: 999,
                background: 'transparent',
                border: '1px dashed rgba(255,255,255,0.18)',
                color: 'var(--text-ghost)',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              or use your phone
            </button>
            {error && (
              <Hint>Phone capture unavailable ({error.slice(0, 60)}).</Hint>
            )}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void startPhotoInference(file);
                e.target.value = '';
              }}
            />
          </Stage>
        )}

        {phase === 'qr' && (
          <Stage key="qr">
            {/* Light tile so the dark modules scan reliably — same treatment
                as the phone-connect QR. */}
            <div style={{
              borderRadius: 14,
              background: '#f4f2ef',
              padding: 12,
              boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06), 0 18px 44px -18px rgba(0,0,0,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div ref={attachQrBox} style={{ width: QR_PX, height: QR_PX, lineHeight: 0 }} />
            </div>
            <Hint>
              Scan with <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Unclaw&nbsp;Scan</strong> on your iPhone,
              then take one front-on photo.
            </Hint>
            {/* Photo-only tier: any flat picture, depth synthesized locally. */}
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '7px 14px',
                borderRadius: 999,
                background: 'transparent',
                border: '1px dashed rgba(255,255,255,0.18)',
                color: 'var(--text-ghost)',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              or upload a photo
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void startPhotoInference(file);
                e.target.value = '';
              }}
            />
          </Stage>
        )}

        {(phase === 'fetching' || phase === 'reveal') && (
          <Stage key="reveal">
            <div style={{
              position: 'relative',
              // Exactly the photo's aspect, sized to whichever limit binds
              // first: 380px wide, or 46vh tall. Computing the width from both
              // is deterministic, where stacking width/maxWidth/maxHeight and
              // hoping the aspect-ratio resolution agrees is not.
              width: `min(380px, calc(46vh * ${photoAspect}))`,
              aspectRatio: String(photoAspect),
              borderRadius: 18,
              overflow: 'hidden',
              // A whisper of glass so the particle field reads as inside a
              // surface, not floating raw on the scrim.
              background: 'rgba(40, 48, 65, 0.22)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 24px 60px -24px rgba(0,0,0,0.8)',
            }}>
              {phase === 'reveal' && previewUrl && (
                <PersonParticles imageUrl={previewUrl} matteUrl={matteUrl} depth={faceDepth} />
              )}
            </div>
            <Hint>
              {!failed && (
                <PulseGrid
                  size={13}
                  style={{ marginRight: 8, verticalAlign: '-2px', display: 'inline-block' }}
                />
              )}
              {stageLabel ?? (phase === 'fetching' ? 'Upload complete, receiving your photo' : 'Photo received, warming up')}
            </Hint>
            {failed ? (
              <button
                type="button"
                onClick={() => {
                  setFailed(false);
                  setStageIndex(0);
                  setStageLabel(null);
                  setInferLine(null);
                  setPreviewUrl(null);
                  setFindings([]);
                  setFaceDepth(null);
                  setPhase('photo');
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '9px 18px',
                  borderRadius: 999,
                  background: 'var(--glass-bg, rgba(40, 48, 65, 0.38))',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--text-primary)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backdropFilter: 'var(--glass-blur)',
                  WebkitBackdropFilter: 'var(--glass-blur)',
                }}
              >
                <RefreshCw size={13} strokeWidth={2} />
                Try another photo
              </button>
            ) : (
              <span style={{
                display: 'block',
                maxWidth: 300,
                textAlign: 'center',
                fontSize: 11,
                lineHeight: 1.6,
                color: 'var(--text-ghost)',
                opacity: 0.8,
                textShadow: '0 1px 3px rgba(0,0,0,0.6)',
              }}>
                This takes a few minutes. You can leave this screen open.
              </span>
            )}
            <div style={{
              width: 'min(300px, 80vw)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}>
              {findings.length > 0 && !failed && <Findings items={findings} />}
              <SegmentedProgress index={stageIndex} failed={failed} />
            </div>
          </Stage>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Drag handlers are forwarded so a stage can be a drop target; `style` merges
 *  over the layout rather than replacing it. */
function Stage({
  children, style, ...drag
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
} & Pick<React.HTMLAttributes<HTMLDivElement>,
  'onDragOver' | 'onDragEnter' | 'onDragLeave' | 'onDrop'>) {
  return (
    <motion.div
      {...drag}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.99 }}
      transition={{ duration: 0.45, ease: EASE_OUT_EXPO }}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  // Block with normal inline flow — a flex container here turns the text
  // nodes into separate flex items and shreds the sentence.
  return (
    <span style={{
      display: 'block',
      maxWidth: 320,
      textAlign: 'center',
      fontSize: 12,
      lineHeight: 1.55,
      color: 'var(--text-ghost)',
      textShadow: '0 1px 3px rgba(0,0,0,0.6)',
    }}>
      {children}
    </span>
  );
}
