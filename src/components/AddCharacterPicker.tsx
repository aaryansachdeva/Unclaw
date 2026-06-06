// Add-a-character picker / store. Shown over the blank stage (UE cleared to an
// empty scene) when the switcher cycles onto the "Add" slot. The top grid
// offers every character with a per-character state:
//   - ready    (owned + pak installed)  -> tap adds a new instance + switches
//   - download (owned, pak not present)  -> tap fetches the pak, then it's ready
//   - buy      (not owned)               -> tap opens a Polar checkout in browser
// Base characters (grace + mark) are free and always ready. The roster row
// below lists current instances, each renamable inline and removable.
//
// Brand language matches CustomizationOverlay: frosted-slate glass, Plus
// Jakarta Sans, letterspaced caps whispers, ease-out-expo entrances. The
// accent (warm red) is reserved for the price/lock pill, used sparingly.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Plus, X, Pencil, Lock, Download } from 'lucide-react';
import type { Agent } from '../types';
import type { AgentInstance } from '../hooks/useAgentStack';
import { agentPortrait } from '../assets/agents';
import { ClawsIcon } from './ClawsBalance';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** One character row in the store grid, with its ownership + install state. */
export interface StoreEntry {
  agent: Agent;
  owned: boolean;
  installed: boolean;
  /** Cost to unlock with claws (the in-app currency). Individual characters
   *  are bought with claws, not money. */
  clawsCost?: number;
  sku?: string;
  /** 0..1 while a pak download is in flight; null/undefined otherwise. */
  downloading?: number | null;
}

interface AddCharacterPickerProps {
  entries: StoreEntry[];
  bundle?: { priceUsd: number; sku: string; owned: boolean };
  roster: AgentInstance[];
  agentById: Record<string, Agent>;
  baseInstanceId: string;
  onPick: (agentId: string) => void;
  onBuy: (sku: string) => void;
  onDownload: (agentId: string) => void;
  onRename: (instanceId: string, name: string) => void;
  onRemove: (instanceId: string) => void;
  onCancel: () => void;
}

export function AddCharacterPicker({
  entries, bundle, roster, agentById, baseInstanceId,
  onPick, onBuy, onDownload, onRename, onRemove, onCancel,
}: AddCharacterPickerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const showBundle = bundle && !bundle.owned;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 56,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 26,
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0.55) 100%)',
          backdropFilter: 'blur(28px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(28px) saturate(1.3)',
        }}
      />

      {/* back */}
      <motion.button
        type="button"
        onClick={onCancel}
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
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_OUT_EXPO, delay: 0.06 }}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 7,
        }}
      >
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          color: 'var(--text-ghost)',
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}>
          Choose an agent
        </span>
      </motion.div>

      {/* character grid */}
      <div style={{
        position: 'relative',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 14,
        maxWidth: 560,
      }}>
        {entries.map((e, i) => (
          <CharacterCard
            key={e.agent.agentId}
            entry={e}
            delay={0.12 + i * 0.05}
            onPick={() => onPick(e.agent.agentId)}
            onBuy={() => e.sku && onBuy(e.sku)}
            onDownload={() => onDownload(e.agent.agentId)}
          />
        ))}
      </div>

      {/* unlock-all bundle */}
      {showBundle && (
        <motion.button
          type="button"
          onClick={() => onBuy(bundle!.sku)}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_OUT_EXPO, delay: 0.3 }}
          whileTap={{ scale: 0.97 }}
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 999,
            background: 'var(--glass-bg-panel, rgba(40, 48, 65, 0.55))',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'var(--text-primary)',
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: '0.02em',
            cursor: 'pointer',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
          }}
        >
          Unlock all agents
          <span style={{
            padding: '2px 8px',
            borderRadius: 999,
            background: 'color-mix(in srgb, var(--accent, #c44444) 88%, transparent)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
          }}>
            ${bundle!.priceUsd}
          </span>
        </motion.button>
      )}

      {/* current roster: rename inline + remove */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_OUT_EXPO, delay: 0.2 }}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 9,
          maxWidth: 600,
        }}
      >
        <span style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.26em',
          textTransform: 'uppercase',
          color: 'var(--text-ghost)',
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}>
          Your agents
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          {roster.map((inst) => (
            <RosterPill
              key={inst.id}
              instance={inst}
              fallbackName={agentById[inst.agentId]?.name ?? inst.agentId}
              removable={inst.id !== baseInstanceId}
              onRename={(name) => onRename(inst.id, name)}
              onRemove={() => onRemove(inst.id)}
            />
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

function CharacterCard({
  entry, delay, onPick, onBuy, onDownload,
}: {
  entry: StoreEntry;
  delay: number;
  onPick: () => void;
  onBuy: () => void;
  onDownload: () => void;
}) {
  const { agent, owned, installed, clawsCost, downloading } = entry;
  const portrait = agentPortrait(agent.agentId);

  const isDownloading = typeof downloading === 'number';
  const state: 'ready' | 'download' | 'buy' = !owned ? 'buy' : !installed ? 'download' : 'ready';
  const locked = state === 'buy';

  const handleClick = () => {
    if (isDownloading) return;
    if (state === 'ready') onPick();
    else if (state === 'download') onDownload();
    else onBuy();
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: EASE_OUT_EXPO, delay }}
      whileHover={{ y: -3, scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      style={{
        pointerEvents: 'auto',
        position: 'relative',
        width: 116,
        height: 148,
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-end',
        background: 'var(--glass-bg-panel, rgba(40, 48, 65, 0.55))',
        border: '1px solid rgba(255, 255, 255, 0.10)',
        borderRadius: 14,
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        cursor: isDownloading ? 'default' : 'pointer',
        color: 'var(--text-primary)',
        boxShadow: '0 10px 28px -12px rgba(0,0,0,0.6)',
        transition: 'border-color 200ms var(--ease-out-quart)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }}
    >
      {/* portrait fill (or lettered fallback if the id has no art yet) */}
      {portrait ? (
        <img
          src={portrait}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center 22%',
            filter: locked ? 'saturate(0.55) brightness(0.7)' : undefined,
          }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 40,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.18)',
          }}
        >
          {agent.name.charAt(0)}
        </span>
      )}

      {/* bottom scrim so the name stays legible over any portrait */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 58,
          background: 'linear-gradient(to top, rgba(8,10,14,0.86) 0%, rgba(8,10,14,0.45) 55%, transparent 100%)',
        }}
      />

      {/* top-right state badge: + (add) / download / lock+price */}
      <span style={{
        position: 'absolute',
        top: 7,
        right: 7,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 20,
        padding: state === 'buy' ? '0 7px' : 0,
        minWidth: 20,
        justifyContent: 'center',
        borderRadius: state === 'buy' ? 999 : '50%',
        background: state === 'buy'
          ? 'color-mix(in srgb, var(--accent, #c44444) 88%, transparent)'
          : 'rgba(8,10,14,0.55)',
        border: '1px solid rgba(255,255,255,0.18)',
        color: state === 'buy' ? '#fff' : 'rgba(255,255,255,0.92)',
        fontSize: 11,
        fontWeight: 700,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}>
        {state === 'ready' && <Plus size={12} strokeWidth={2.4} />}
        {state === 'download' && <Download size={11} strokeWidth={2.2} />}
        {state === 'buy' && (
          <>
            {typeof clawsCost === 'number'
              ? <>{clawsCost}<ClawsIcon size={12} style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.4))' }} /></>
              : <><Lock size={10} strokeWidth={2.2} />Buy</>}
          </>
        )}
      </span>

      {/* download progress overlay — dim veil + % + a filling bar near the
          bottom so the user sees the buy → download progress concretely. */}
      {isDownloading && (
        <span style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          background: 'rgba(8,10,14,0.58)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
        }}>
          <Download size={16} strokeWidth={2.2} style={{ color: 'rgba(255,255,255,0.9)' }} />
          <span style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: '#fff',
            textShadow: '0 1px 3px rgba(0,0,0,0.7)',
          }}>
            {Math.round((downloading ?? 0) * 100)}%
          </span>
          {/* progress track + fill, pinned near the bottom of the card */}
          <span style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 12,
            height: 4,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.16)',
            overflow: 'hidden',
          }}>
            <span style={{
              display: 'block',
              height: '100%',
              width: `${Math.max(3, Math.round((downloading ?? 0) * 100))}%`,
              borderRadius: 999,
              background: 'var(--accent, #c44444)',
              transition: 'width 220ms var(--ease-out-quart)',
            }} />
          </span>
        </span>
      )}

      {/* name */}
      <span style={{
        position: 'relative',
        padding: '0 12px 11px',
        textAlign: 'left',
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: '0.03em',
        textShadow: '0 1px 4px rgba(0,0,0,0.7)',
      }}>
        {agent.name}
      </span>
    </motion.button>
  );
}

function RosterPill({
  instance, fallbackName, removable, onRename, onRemove,
}: {
  instance: AgentInstance;
  fallbackName: string;
  removable: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const display = instance.name?.trim() || fallbackName;
  const portrait = agentPortrait(instance.agentId);

  const startEdit = () => { setDraft(instance.name ?? ''); setEditing(true); };
  const commit = () => { onRename(draft); setEditing(false); };

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: removable ? '4px 7px 4px 5px' : '4px 8px 4px 5px',
      background: 'rgba(255, 255, 255, 0.06)',
      border: '1px solid rgba(255, 255, 255, 0.10)',
      borderRadius: 999,
      color: 'var(--text-primary)',
    }}>
      {/* small character avatar */}
      <span
        aria-hidden
        style={{
          flex: '0 0 auto',
          width: 20,
          height: 20,
          borderRadius: '50%',
          overflow: 'hidden',
          background: 'rgba(255,255,255,0.08)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-ghost)',
        }}
      >
        {portrait
          ? <img src={portrait} alt="" draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 22%' }} />
          : display.charAt(0)}
      </span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          placeholder={fallbackName}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            // Keep Enter/Escape local — don't let them reach the picker's
            // global Esc-to-close handler.
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
          }}
          maxLength={24}
          style={{
            width: Math.max(56, Math.min(160, (draft.length || fallbackName.length) * 8 + 16)),
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: '0.04em',
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          title="Rename"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'text',
            color: 'var(--text-primary)',
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
          }}
        >
          {display}
          <Pencil size={10} strokeWidth={1.8} style={{ color: 'var(--text-ghost)', opacity: 0.7 }} />
        </button>
      )}
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${display}`}
          title={`Remove ${display}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 17,
            height: 17,
            padding: 0,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255,255,255,0.08)',
            color: 'var(--text-ghost)',
            cursor: 'pointer',
            transition: 'background 160ms var(--ease-out-quart), color 160ms var(--ease-out-quart)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'color-mix(in srgb, var(--accent, #c44444) 70%, transparent)';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
            e.currentTarget.style.color = 'var(--text-ghost)';
          }}
        >
          <X size={11} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}
