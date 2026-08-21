// "Playing on Unclaw Mobile" — shown when another surface holds the stream.
//
// Unclaw renders to exactly ONE place at a time. When a phone (later a VS Code
// panel) takes the lease, the desktop releases Unreal's frames to the H.264
// encoder and freezes on its last picture. This covers the WHOLE app, not just
// the stream area: with the character gone there is nothing to type at, so
// leaving the input bar and widgets live would invite interaction that goes
// nowhere.
//
// The macOS traffic lights stay usable for free — they are real NSWindow
// buttons drawn by AppKit above the web content, so no z-index here can cover
// them. That is exactly the behaviour we want.
import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function StreamLeaseOverlay() {
  const [lease, setLease] = useState<'local' | 'remote'>('local');
  const [players, setPlayers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ds = window.electronAPI?.directSurface;
    if (!ds) return;
    void ds.getLease?.().then(setLease).catch(() => { /* older main process */ });
    return ds.onLease?.((s) => { setLease(s.holder); setPlayers(s.players); });
  }, []);

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
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-6"
          style={{
            // Above every piece of app chrome. The traffic lights are native
            // and sit above this regardless.
            zIndex: 9000,
            backdropFilter: 'blur(40px) saturate(1.6)',
            WebkitBackdropFilter: 'blur(40px) saturate(1.6)',
            background: 'rgba(40, 48, 65, 0.55)',
            // Swallow clicks meant for the UI underneath.
            pointerEvents: 'auto',
          }}
        >
          <div className="flex flex-col items-center gap-2.5 px-10 text-center">
            <span
              className="text-[15px] font-semibold tracking-tight"
              style={{ color: 'var(--text-primary, #FAFAFA)' }}
            >
              Playing on Unclaw Mobile
            </span>
            <span
              className="max-w-[17rem] text-[12px] leading-relaxed"
              style={{ color: 'var(--text-ghost, #A39C95)' }}
            >
              {players.length > 1
                ? `${players.length} devices are connected.`
                : 'Your companion is streaming to your phone.'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void takeBack()}
            disabled={busy}
            className="rounded-full px-5 py-2 text-[12px] font-medium transition-opacity disabled:opacity-50"
            style={{
              background: 'rgba(40, 48, 65, 0.6)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text-secondary, #D4CEC7)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            {busy ? 'Disconnecting…' : 'Play here instead'}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
