// The first screen of Add custom (2026-09-16): make a character from a photo,
// or bring one in as a file from the Unclaw Exporter plugin for Unreal. Both
// options sit side by side as equals so neither reads as the hidden one, and
// the import path gets its own screen with a drop target instead of a link
// under the photo tile.

import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, FileBox, ImageUp } from 'lucide-react';
import { PulseGrid } from './PulseGrid';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function ChooseMethod({ onPhoto, onImport }: { onPhoto: () => void; onImport: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, padding: '0 16px' }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{
          fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--text-primary)',
          textShadow: '0 1px 3px rgba(0,0,0,0.5)',
        }}>
          How do you want to make them?
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
        <MethodTile
          icon={<ImageUp size={19} strokeWidth={1.7} />}
          title="Create from a photo"
          body="One clear, front-on photo of a face. Upload it here or take it with Unclaw Scan on your iPhone."
          foot="A few minutes"
          onClick={onPhoto}
          delay={0.04}
        />
        <MethodTile
          icon={<FileBox size={19} strokeWidth={1.7} />}
          title="Import a character file"
          body="A .unclawchar exported from Unreal Engine with the Unclaw Exporter, grooms and all."
          foot="Under a minute"
          onClick={onImport}
          delay={0.1}
        />
      </div>
    </div>
  );
}

function MethodTile({
  icon, title, body, foot, onClick, delay,
}: {
  icon: ReactNode; title: string; body: string; foot: string; onClick: () => void; delay: number;
}) {
  const [hover, setHover] = useState(false);
  return (
    <motion.button
      type="button"
      onClick={onClick}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: hover ? -2 : 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT_EXPO, delay: hover ? 0 : delay }}
      whileTap={{ scale: 0.985 }}
      style={{
        width: 214,
        minHeight: 206,
        padding: '18px 18px 16px',
        borderRadius: 16,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 12,
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: 'var(--text-primary)',
        background: hover ? 'var(--glass-bg-hover, rgba(40, 48, 65, 0.48))' : 'var(--glass-bg, rgba(40, 48, 65, 0.32))',
        border: `1px solid ${hover ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)'}`,
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        boxShadow: hover ? '0 18px 40px -22px rgba(0,0,0,0.75)' : '0 10px 28px -22px rgba(0,0,0,0.6)',
        outline: 'none',
        transition: 'background 180ms var(--ease-out-quart), border-color 180ms var(--ease-out-quart), box-shadow 220ms var(--ease-out-quart)',
      }}
    >
      <span aria-hidden style={{
        width: 38, height: 38, borderRadius: 11, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: 'var(--text-secondary)',
      }}>
        {icon}
      </span>
      <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.25 }}>{title}</span>
      <span style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-secondary)', flex: 1 }}>{body}</span>
      <span style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: 'var(--text-ghost)',
      }}>
        {foot}
        <ChevronRight
          size={14}
          strokeWidth={2.2}
          style={{
            color: hover ? 'var(--text-primary)' : 'var(--text-ghost)',
            transform: hover ? 'translateX(2px)' : 'none',
            transition: 'transform 200ms var(--ease-out-quart), color 180ms var(--ease-out-quart)',
          }}
        />
      </span>
    </motion.button>
  );
}

export function ImportCharacter({
  busy, busyLabel, error, onPickFile, onDropPath, onDropError,
}: {
  busy: boolean;
  busyLabel?: string | null;
  error: string | null;
  onPickFile: () => void;
  onDropPath: (path: string) => void;
  onDropError: (message: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '0 16px' }}>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragEnter={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return;
          const file = e.dataTransfer.files[0];
          if (!file) return;
          const path = window.electronAPI?.identity?.pathForFile?.(file) ?? '';
          if (!path) { onDropError('Could not read that file. Use Choose a file instead.'); return; }
          onDropPath(path);
        }}
        style={{
          width: 'min(320px, 100%)',
          minHeight: 190,
          borderRadius: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '22px 20px',
          textAlign: 'center',
          background: dragging ? 'var(--glass-bg-hover, rgba(40, 48, 65, 0.48))' : 'var(--glass-bg, rgba(40, 48, 65, 0.32))',
          border: dragging ? '1px solid color-mix(in srgb, var(--accent, #c44444) 70%, transparent)' : '1px dashed rgba(255,255,255,0.18)',
          backdropFilter: 'var(--glass-blur)',
          WebkitBackdropFilter: 'var(--glass-blur)',
          transition: 'background 180ms var(--ease-out-quart), border-color 180ms var(--ease-out-quart)',
        }}
      >
        {busy ? (
          <>
            <PulseGrid size={16} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {busyLabel ?? 'Importing your character'}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--text-ghost)' }}>Unpacking the face, skin and grooms.</span>
          </>
        ) : (
          <>
            <FileBox size={26} strokeWidth={1.6} style={{ color: 'var(--text-secondary)' }} />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
              {dragging ? 'Drop to import' : 'Drop a .unclawchar file here'}
            </span>
            <button
              type="button"
              onClick={onPickFile}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '8px 16px', borderRadius: 999,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.14)',
                color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Choose a file
            </button>
          </>
        )}
      </div>
      {error && (
        <span style={{ display: 'block', maxWidth: 320, textAlign: 'center', fontSize: 12, lineHeight: 1.5, color: 'var(--danger, #c87a7a)' }}>
          {error}
        </span>
      )}
      <span style={{
        display: 'block', maxWidth: 320, textAlign: 'center', fontSize: 11.5, lineHeight: 1.6,
        color: 'var(--text-ghost)', textShadow: '0 1px 3px rgba(0,0,0,0.6)',
      }}>
        Make one in Unreal Engine 5.8: assemble your MetaHuman, then Tools &gt; Unclaw Exporter &gt; Export to Unclaw.
      </span>
    </div>
  );
}
