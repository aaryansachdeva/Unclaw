import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import QRCodeStyling from 'qr-code-styling';
import { Smartphone, Check, Loader2, RefreshCw } from 'lucide-react';
import logoUrl from '../assets/logo.png';
import {
  ensureConnectLink,
  fetchPairStatus,
  type ConnectLink,
  type PairStatus,
} from '../services/companion';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

type Phase = 'loading' | 'signin' | 'ready' | 'error';

const QR_PX = 228;

/** Build a styled QR: rounded modules + soft-cornered finder eyes, with the
 *  Unclaw logo dropped into a carved-out center (the pattern is generated
 *  AROUND the logo, not pasted over it). */
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
      // Carve the modules out behind the logo + give it a big footprint so it
      // reads as designed-in rather than overlaid.
      hideBackgroundDots: true,
      imageSize: 0.4,
      margin: 5,
    },
  });
}

/**
 * "Connect your phone" popover — anchored under the titlebar phone button.
 *
 * Ensures the desktop is paired (arms soul's cloud-signalling client), renders
 * a branded QR the phone scans, and polls the pair status so it flips to
 * "Phone connected" the moment a device bridges in. The QR is a universal link
 * to the Worker; the Worker only proxies signalling — the avatar video/audio
 * flow DIRECT phone<->desktop after the handshake.
 */
export function CompanionPanel({
  authToken,
  userId,
  reduce,
}: {
  authToken: string | null;
  userId: string | null;
  reduce: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<PairStatus | null>(null);
  const mountedRef = useRef(true);
  const qrBoxRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<QRCodeStyling | null>(null);

  const phoneConnected = (status?.active_players?.length ?? 0) > 0;
  const authInvalid = status?.state === 'AUTH_INVALID';

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const link: ConnectLink = await ensureConnectLink(authToken, userId);
      if (!mountedRef.current) return;
      if (!link.connect_url) {
        setPhase('error');
        setError('Could not build a connect link. Is the companion service running?');
        return;
      }
      setConnectUrl(link.connect_url);
      setPhase('ready');
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (/sign-in/i.test(msg)) { setPhase('signin'); return; }
      setPhase('error');
      setError(msg);
    }
  }, [authToken, userId]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => { mountedRef.current = false; };
  }, [load]);

  // Draw / update the styled QR once the container + link exist.
  useEffect(() => {
    if (phase !== 'ready' || !connectUrl || !qrBoxRef.current) return;
    if (!qrRef.current) {
      qrRef.current = makeQr(connectUrl);
      qrBoxRef.current.innerHTML = '';
      qrRef.current.append(qrBoxRef.current);
    } else {
      qrRef.current.update({ data: connectUrl });
    }
  }, [phase, connectUrl]);

  // Poll live pair status so "Phone connected" lights up on its own.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await fetchPairStatus();
        if (!cancelled) setStatus(s);
      } catch { /* transient — keep last known */ }
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <motion.div
      role="dialog"
      aria-label="Connect your phone"
      initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
      style={{
        position: 'absolute',
        top: 'calc(100% + 12px)',
        left: '50%',
        marginLeft: -140,
        width: 280,
        padding: '16px 16px 16px',
        borderRadius: 16,
        background: 'var(--glass-bg-panel)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: '1px solid var(--glass-border)',
        boxShadow: 'var(--shadow-panel-ground), 0 16px 40px -16px rgba(0,0,0,0.5)',
        zIndex: 70,
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Smartphone size={15} strokeWidth={2} style={{ color: 'var(--text-secondary)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          Connect your phone
        </span>
      </div>

      {phase === 'loading' && (
        <Centered>
          <Loader2 size={22} className="companion-spin" style={{ color: 'var(--text-ghost)' }} />
          <p style={hintStyle}>Preparing your link…</p>
        </Centered>
      )}

      {phase === 'signin' && (
        <Centered>
          <p style={{ ...hintStyle, marginTop: 0 }}>
            Sign in to your Unclaw account first — your phone connects to the
            same account.
          </p>
        </Centered>
      )}

      {phase === 'error' && (
        <Centered>
          <p style={{ ...hintStyle, color: 'var(--accent)' }}>{error}</p>
          <button type="button" onClick={() => void load()} style={retryBtnStyle}>
            <RefreshCw size={13} /> Try again
          </button>
        </Centered>
      )}

      {phase === 'ready' && (
        <>
          {/* Styled QR on a light tile. */}
          <div style={{
            position: 'relative',
            borderRadius: 14,
            background: '#f4f2ef',
            padding: 12,
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div
              ref={qrBoxRef}
              style={{
                width: QR_PX, height: QR_PX, lineHeight: 0,
                opacity: phoneConnected ? 0.18 : 1,
                transition: 'opacity 0.3s var(--ease-out-quart)',
              }}
            />
            {phoneConnected && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: 'var(--live, #8cbf8a)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 14px rgba(140,191,138,0.6)',
                }}>
                  <Check size={26} strokeWidth={3} style={{ color: '#0f1712' }} />
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1a2e22' }}>Phone connected</span>
              </div>
            )}
          </div>

          <p style={{ ...hintStyle, marginBottom: 6 }}>
            {phoneConnected
              ? 'Streaming directly to your phone.'
              : authInvalid
                ? 'Pairing expired — reopen to re-pair.'
                : 'Scan with the Unclaw app to connect.'}
          </p>

          {/* Simple status dot: connected / ready-to-scan / needs re-pair */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: phoneConnected ? 'var(--live, #8cbf8a)'
                : authInvalid ? 'var(--accent)' : 'var(--text-secondary)',
              boxShadow: phoneConnected ? '0 0 6px var(--live, #8cbf8a)' : 'none',
            }} />
            <span style={{ fontSize: 11, color: 'var(--text-ghost)', letterSpacing: '0.01em' }}>
              {phoneConnected ? 'Connected' : authInvalid ? 'Re-pair needed' : 'Ready to scan'}
            </span>
          </div>
        </>
      )}

      <style>{`.companion-spin{animation:companion-spin 1.1s linear infinite}@keyframes companion-spin{to{transform:rotate(360deg)}}`}</style>
    </motion.div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: 180, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center',
    }}>
      {children}
    </div>
  );
}

const hintStyle: React.CSSProperties = {
  margin: '10px 0 0',
  fontSize: 11.5,
  lineHeight: 1.45,
  color: 'var(--text-ghost)',
  textAlign: 'center',
  letterSpacing: '0.005em',
};

const retryBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 12px', borderRadius: 8,
  background: 'var(--glass-bg-hover)', border: '1px solid var(--glass-border)',
  color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit',
};
