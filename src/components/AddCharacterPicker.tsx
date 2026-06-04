// Add-a-character picker. Shown over the blank stage (UE cleared to an empty
// scene) when the switcher cycles onto the "Add" slot. The top grid offers
// every available character — duplicates are allowed, so picking one always
// pushes a NEW instance onto the roster and switches to it. The roster row
// below lists the current instances, each renamable inline and removable
// (the base Grace is permanent).
//
// Brand language matches CustomizationOverlay: frosted-slate glass, Plus
// Jakarta Sans, letterspaced caps whispers, ease-out-expo entrances.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Plus, X, Pencil } from 'lucide-react';
import type { Agent } from '../types';
import type { AgentInstance } from '../hooks/useAgentStack';
import { agentPortrait } from '../assets/agents';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface AddCharacterPickerProps {
  addable: Agent[];
  roster: AgentInstance[];
  agentById: Record<string, Agent>;
  baseInstanceId: string;
  onPick: (agentId: string) => void;
  onRename: (instanceId: string, name: string) => void;
  onRemove: (instanceId: string) => void;
  onCancel: () => void;
}

export function AddCharacterPicker({
  addable, roster, agentById, baseInstanceId, onPick, onRename, onRemove, onCancel,
}: AddCharacterPickerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

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
        gap: 30,
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
          Add an agent
        </span>
      </motion.div>

      {/* addable grid (all characters; duplicates allowed) */}
      <div style={{
        position: 'relative',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 14,
        maxWidth: 560,
      }}>
        {addable.map((a, i) => (
          <CharacterCard key={a.agentId} agent={a} onClick={() => onPick(a.agentId)} delay={0.12 + i * 0.05} />
        ))}
      </div>

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

function CharacterCard({ agent, onClick, delay }: { agent: Agent; onClick: () => void; delay: number }) {
  const portrait = agentPortrait(agent.agentId);
  return (
    <motion.button
      type="button"
      onClick={onClick}
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
        cursor: 'pointer',
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

      {/* + add badge, top-right */}
      <span style={{
        position: 'absolute',
        top: 7,
        right: 7,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: 'rgba(8,10,14,0.55)',
        border: '1px solid rgba(255,255,255,0.18)',
        color: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}>
        <Plus size={12} strokeWidth={2.4} />
      </span>

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
