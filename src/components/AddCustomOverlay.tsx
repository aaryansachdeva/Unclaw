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
import QRCodeStyling from 'qr-code-styling';
import { ArrowLeft, RefreshCw } from 'lucide-react';
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

type Phase = 'signin' | 'loading' | 'qr' | 'fetching' | 'reveal' | 'error' | 'expired';

const QR_PX = 228;

/** Vision-grooming args for the inference IPC: the user's photo + our groom
 *  catalogs. The credential is the PIPELINE's own OpenAI key (read by main
 *  from p1/secrets), never the user's BYOK chat key. */
async function buildGroomArgs(photoBytes: Uint8Array): Promise<Record<string, unknown> | undefined> {
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
    case 'prep': return 'Preparing your capture';
    case 'take': return 'Reading your depth capture';
    case 'photo-prep': return 'Studying your photo';
    case 'depth': return 'Synthesizing depth';
    case 'normals': return 'Reading surface detail';
    case 'fuse': return 'Fusing your face geometry';
    case 'identity':
      if (line.includes('CONFORM')) return 'Matching your features';
      if (line.includes('dna_requested') || line.includes('dna_delegate')) return 'Growing your rig';
      if (line.includes('import_from_identity') || line.includes('norig')) return 'Sculpting your likeness';
      if (line.includes('auto_rigging')) return 'Rigging your character';
      if (line.includes('textures')) return 'Painting skin';
      if (line.includes('can_build') || line.includes('build ')) return 'Assembling your character';
      if (line.includes('export')) return 'Packing your identity';
      return null; // keep the current label between markers
    case 'done': return 'Bringing your character in';
    default: return null;
  }
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
    grooming?: { gender: 'm' | 'f'; hairIndex: number; browIndex: number; lashIndex: number };
  }) => void;
}) {
  const [phase, setPhase] = useState<Phase>(authToken ? 'loading' : 'signin');
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [matteUrl, setMatteUrl] = useState<string | null>(null);
  const [inferLine, setInferLine] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const onIdentityReadyRef = useRef(onIdentityReady);
  onIdentityReadyRef.current = onIdentityReady;

  // Photo-only tier: user picked a flat picture instead of scanning the QR.
  // The particle reveal plays on the raw photo (no person matte locally) while
  // the synthesized-depth pipeline runs.
  const startPhotoInference = useCallback(async (file: File) => {
    const api = window.electronAPI?.identity;
    if (!api?.runPhotoInference) { setInferLine('local inference unavailable'); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext: 'jpg' | 'png' = file.type === 'image/png' ? 'png' : 'jpg';
    const localId = 'ph_' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    const pUrl = URL.createObjectURL(file);
    urlsRef.current.push(pUrl);
    uploadedRef.current = true; // don't cancel the (unused) QR session on unmount churn
    setPreviewUrl(pUrl);
    setMatteUrl(null);
    setPhase('reveal');
    setInferLine('synthesizing depth from photo');
    try {
      const groom = await buildGroomArgs(bytes);
      const res = await api.runPhotoInference({ localId, photoBytes: bytes, ext, groom });
      if (!mountedRef.current) return;
      if (res.ok && res.blobPath) {
        setInferLine('identity ready');
        onIdentityReadyRef.current?.({
          sessionId: localId,
          dnaPath: res.dnaPath ?? '',
          blobPath: res.blobPath,
          baseColorPath: res.baseColorPath,
          grooming: res.grooming,
        });
      } else {
        setInferLine(`inference failed: ${res.error ?? 'unknown'}`);
      }
    } catch (e) {
      if (mountedRef.current) setInferLine(`inference failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const lastStageRef = useRef<string | null>(null);

  // Local-inference progress feed from main: raw line for the mono ticker,
  // stage markers mapped to the human-facing status.
  useEffect(() => {
    const api = window.electronAPI?.identity;
    if (!api?.onProgress) return;
    return api.onProgress(({ stage, line }) => {
      setInferLine(`${stage}: ${line}`.slice(0, 90));
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
    if (!authToken) { setPhase('signin'); return; }

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
      setPhase('error');
      setError(e instanceof Error ? e.message : String(e));
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
  }, [authToken, nonce]);

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
              accept="image/jpeg,image/png"
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
              width: 'min(46vh, 380px)',
              aspectRatio: '3 / 4',
              borderRadius: 18,
              overflow: 'hidden',
              // A whisper of glass so the particle field reads as inside a
              // surface, not floating raw on the scrim.
              background: 'rgba(40, 48, 65, 0.22)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 24px 60px -24px rgba(0,0,0,0.8)',
            }}>
              {phase === 'reveal' && previewUrl && (
                <PersonParticles imageUrl={previewUrl} matteUrl={matteUrl} />
              )}
            </div>
            <Hint>
              <PulseDots />
              {stageLabel ?? (phase === 'fetching' ? 'Upload complete, receiving your photo' : 'Photo received, warming up')}
            </Hint>
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
              You can leave this screen. We'll send you a notification when your
              agent is ready to download.
            </span>
            {inferLine && (
              <span style={{
                display: 'block',
                maxWidth: 320,
                textAlign: 'center',
                fontSize: 10,
                fontFamily: 'ui-monospace, monospace',
                color: 'var(--text-ghost)',
                opacity: 0.6,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {inferLine}
              </span>
            )}
          </Stage>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
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

/** Three breathing dots — quieter than a spinner while the pipeline works. */
function PulseDots() {
  return (
    <span aria-hidden style={{ display: 'inline-flex', gap: 3, alignItems: 'center', verticalAlign: 'middle', marginRight: 8 }}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{ opacity: [0.25, 0.9, 0.25] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.22, ease: 'easeInOut' }}
          style={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: 'var(--accent, #c44444)',
          }}
        />
      ))}
    </span>
  );
}
