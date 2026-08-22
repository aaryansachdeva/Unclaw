// "Playing on Unclaw Mobile" — shown when another surface holds the stream.
//
// Unclaw renders to exactly ONE place at a time. When a phone (later a VS Code
// panel) takes the lease, the desktop releases Unreal's frames to the H.264
// encoder and freezes on its last picture. This covers the WHOLE app rather
// than just the stream area: with the character gone there is nothing to talk
// to, so leaving the input bar and widgets live would invite interaction that
// goes nowhere.
//
// This is NOT an error state. It is the calm "she's over there now" of an
// AirPlay handoff, which is why it reuses the app's existing live-status
// idiom (breathing accent dot + uppercase eyebrow) instead of inventing a
// warning vocabulary.
//
// The macOS traffic lights stay usable for free: they are real NSWindow
// buttons drawn by AppKit above the web content, so no z-index here can cover
// them. That is exactly the behaviour we want.
import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Smartphone, Chrome, Code2 } from 'lucide-react';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

export function StreamLeaseOverlay() {
  const [lease, setLease] = useState<'local' | 'remote'>('local');
  const [players, setPlayers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const ds = window.electronAPI?.directSurface;
    if (!ds) return;
    void ds.getLease?.().then(setLease).catch(() => { /* older main process */ });
    return ds.onLease?.((s) => { setLease(s.holder); setPlayers(s.players); });
  }, []);

  // Who took her. Local viewers self-tag on the signalling URL
  // ("chrome:3", "vscode:7"); cloud players (the phone) carry no tag.
  const who = (() => {
    const kinds = new Set(players.map((p) => {
      const tag = p.split(':')[0];
      return tag === 'chrome' || tag === 'vscode' ? tag : 'mobile';
    }));
    if (kinds.size > 1) return { title: `Playing on ${players.length} devices`, Icon: Smartphone };
    if (kinds.has('chrome')) return { title: 'Playing in Chrome', Icon: Chrome };
    if (kinds.has('vscode')) return { title: 'Playing in VS Code', Icon: Code2 };
    return { title: 'Playing on Unclaw Mobile', Icon: Smartphone };
  })();

  const takeBack = useCallback(async () => {
    setBusy(true);
    try { await window.electronAPI?.directSurface?.disconnectRemote?.(); }
    finally { setBusy(false); }
  }, []);

  return (
    <AnimatePresence>
      {lease === 'remote' && (
        <motion.div
          key="stream-lease"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{
            // Above every piece of app chrome (nothing else exceeds 1000).
            zIndex: 9000,
            // The panel tier of the app's one glass material, over the frozen
            // frame. Same tokens the expanded widget panels use, so this reads
            // as part of the product rather than a bolted-on scrim.
            background: 'var(--glass-bg-panel)',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
          }}
        >
          {/* Device glyph. Ghost-weight: it locates the state, it is not the
              point. Sized against the title, not floating free. */}
          <who.Icon
            size={22}
            strokeWidth={1.5}
            aria-hidden
            style={{ color: 'var(--text-ghost)', marginBottom: 18 }}
          />

          {/* The app's live-status idiom, reused verbatim. The accent earns its
              appearance here: this is a genuine live state, not decoration. */}
          <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: 'var(--accent)',
                opacity: 0.62,
                boxShadow: '0 0 14px rgba(196, 68, 68, 0.45)',
                animation: 'voice-breathing 3.6s ease-in-out infinite',
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--text-ghost)',
              }}
            >
              {players.length > 1 ? `${players.length} devices` : 'Streaming'}
            </span>
          </div>

          <h2
            style={{
              fontSize: 19,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: 'var(--text-primary)',
              marginBottom: 26,
            }}
          >
            {who.title}
          </h2>

          <button
            type="button"
            onClick={() => void takeBack()}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            disabled={busy}
            style={{
              fontSize: 12,
              fontWeight: 500,
              padding: '9px 20px',
              borderRadius: 10,
              color: 'var(--text-primary)',
              background: hover && !busy ? 'var(--glass-bg-hover)' : 'var(--glass-bg)',
              border: '1px solid rgba(255,255,255,0.10)',
              opacity: busy ? 0.5 : 1,
              cursor: busy ? 'default' : 'pointer',
              transition: 'background 180ms cubic-bezier(0.16,1,0.3,1), opacity 180ms',
            }}
          >
            {busy ? 'Bringing her back…' : 'Play here'}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
