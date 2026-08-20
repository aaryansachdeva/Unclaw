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
import { ArrowLeft, Plus, X, Pencil, Lock, Download, ScanFace } from 'lucide-react';
import { AGENTS, type Agent } from '../types';
import type { AgentInstance } from '../hooks/useAgentStack';
import { agentPortrait } from '../assets/agents';
import { ClawsIcon } from './ClawsBalance';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Photo->custom-character capture flow. The inference chain is local-only and
 *  Mac-dev-only (identityInference.ts spawns python venvs + a headless UE at
 *  hardcoded absolute paths), so a packaged build cannot run it: the tile stays
 *  "Coming soon" there. Live in `npm run dev` so the flow is reachable while it
 *  is being finished. Flip to a literal `true` only once the work is hosted. */
const CUSTOM_CAPTURE_ENABLED = import.meta.env.DEV;

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
  /** Opens the photo-capture flow (QR -> Unclaw Scan -> custom character). */
  onAddCustom: () => void;
  /** Saved photo-identity characters (roster instances on the generic host),
   *  rendered as pickable cards after the catalog. */
  customInstances?: { instanceId: string; name: string }[];
  /** Switch to an EXISTING custom instance (vs onPick which adds a new one). */
  onPickInstance?: (instanceId: string) => void;
  /** False hides the whole photo-identity surface: the "Add custom" tile and
   *  any saved custom instances. Driven by CUSTOM_CHARACTERS_ENABLED. */
  allowCustom?: boolean;
}

export function AddCharacterPicker({
  entries, bundle, roster, agentById, baseInstanceId,
  onPick, onBuy, onDownload, onRename, onRemove, onCancel, onAddCustom,
  customInstances, onPickInstance, allowCustom = true,
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
        {allowCustom && (customInstances ?? []).map((c, i) => (
          <CustomInstanceCard
            key={c.instanceId}
            name={c.name}
            delay={0.12 + (entries.length + i) * 0.05}
            onClick={() => onPickInstance?.(c.instanceId)}
          />
        ))}
        {allowCustom && (
          <AddCustomCard delay={0.12 + (entries.length + (customInstances?.length ?? 0)) * 0.05} onClick={onAddCustom} />
        )}
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

// ============ trait badge ============================================
// A circled monogram marking something intrinsic about the character (as
// opposed to the top-right badge, which marks a transient STATE: buy /
// download / add). Two hues carry the meaning at 18px without a label —
// C (Custom) takes the warm-red accent because provenance is the
// distinguishing fact about these builds, O (Optimized) takes --live, the
// same token Reminders uses for a good/completed state, so it reads as
// "this one runs well". Same frosted material as the rest of the chrome;
// the tint is a wash over it, never a solid chip.
function TraitBadge({ letter, tint, title }: {
  letter: string;
  tint: string;
  title: string;
}) {
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 9.5,
        fontWeight: 800,
        lineHeight: 1,
        // Letterform sits a hair high inside a circle; nudge it back to the
        // optical center.
        paddingTop: 0.5,
        color: `color-mix(in srgb, ${tint} 42%, #ffffff)`,
        background: `color-mix(in srgb, ${tint} 20%, rgba(8, 10, 14, 0.62))`,
        border: `1px solid color-mix(in srgb, ${tint} 52%, transparent)`,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        boxShadow: `0 2px 8px -3px rgba(0,0,0,0.75), 0 0 9px -3px color-mix(in srgb, ${tint} 70%, transparent)`,
        textShadow: '0 1px 2px rgba(0,0,0,0.55)',
      }}
    >
      {letter}
    </span>
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
      {/* portrait fill, or the name AS the art when the id has no portrait.
          The nameplate is a deliberate treatment rather than a placeholder:
          letterspaced caps over a soft warm wash, so a character with no
          authored art still reads as designed instead of broken. */}
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
            padding: '0 10px 22px',
            textAlign: 'center',
            // Sized down for longer names so "Goblin" can't clip the card.
            fontSize: agent.name.length > 5 ? 13 : 15,
            fontWeight: 700,
            letterSpacing: '0.2em',
            // The tracking pushes the optical center right; pad it back.
            textIndent: '0.2em',
            textTransform: 'uppercase',
            lineHeight: 1.3,
            color: 'rgba(255,255,255,0.5)',
            textShadow: '0 1px 6px rgba(0,0,0,0.7)',
            background:
              'radial-gradient(ellipse at 50% 42%, rgba(196,68,68,0.16) 0%, rgba(196,68,68,0.05) 42%, transparent 72%)',
            filter: locked ? 'saturate(0.55) brightness(0.7)' : undefined,
          }}
        >
          {agent.name}
        </span>
      )}

      {/* trait badges, top-LEFT so they never collide with the state badge
          (+/download/price) that owns the top-right. */}
      {(agent.custom || agent.optimized) && (
        <span style={{
          position: 'absolute',
          top: 7,
          left: 7,
          display: 'inline-flex',
          gap: 4,
          zIndex: 2,
        }}>
          {agent.custom && (
            <TraitBadge letter="C" tint="var(--accent, #c44444)" title="Custom character" />
          )}
          {agent.optimized && (
            <TraitBadge letter="O" tint="var(--live, #8cbf8a)" title="Optimized build" />
          )}
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

// A saved photo-identity character: nameplate-style card (no authored
// portrait) with the C badge, picking switches to the EXISTING instance.
function CustomInstanceCard({ name, delay, onClick }: { name: string; delay: number; onClick: () => void }) {
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
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 10px 22px',
          textAlign: 'center',
          fontSize: name.length > 5 ? 13 : 15,
          fontWeight: 700,
          letterSpacing: '0.2em',
          textIndent: '0.2em',
          textTransform: 'uppercase',
          lineHeight: 1.3,
          color: 'rgba(255,255,255,0.5)',
          textShadow: '0 1px 6px rgba(0,0,0,0.7)',
          background:
            'radial-gradient(ellipse at 50% 42%, rgba(196,68,68,0.16) 0%, rgba(196,68,68,0.05) 42%, transparent 72%)',
        }}
      >
        {name}
      </span>
      <span style={{ position: 'absolute', top: 7, left: 7, display: 'inline-flex', gap: 4, zIndex: 2 }}>
        <TraitBadge letter="C" tint="var(--accent, #c44444)" title="Custom character" />
      </span>
      <span style={{
        position: 'absolute', top: 7, right: 7,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 20, height: 20, borderRadius: '50%',
        background: 'rgba(8,10,14,0.55)', border: '1px solid rgba(255,255,255,0.18)',
        color: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      }}>
        <Plus size={12} strokeWidth={2.4} />
      </span>
      <span
        aria-hidden
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 58,
          background: 'linear-gradient(to top, rgba(8,10,14,0.86) 0%, rgba(8,10,14,0.45) 55%, transparent 100%)',
        }}
      />
      <span style={{
        position: 'relative',
        padding: '0 12px 11px',
        textAlign: 'left',
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: '0.03em',
        textShadow: '0 1px 4px rgba(0,0,0,0.7)',
      }}>
        {name}
      </span>
    </motion.button>
  );
}

// The "make your own" tile at the end of the store grid. Same footprint as a
// CharacterCard but deliberately quieter: dashed hairline, no portrait, a
// scan glyph over the same warm radial wash the nameplate fallback uses — it
// reads as an invitation, not another character.
function AddCustomCard({ delay, onClick }: { delay: number; onClick: () => void }) {
  const enabled = CUSTOM_CAPTURE_ENABLED;
  return (
    <motion.button
      type="button"
      onClick={enabled ? onClick : undefined}
      disabled={!enabled}
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: enabled ? 1 : 0.55, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: EASE_OUT_EXPO, delay }}
      whileHover={enabled ? { y: -3, scale: 1.03 } : undefined}
      whileTap={enabled ? { scale: 0.97 } : undefined}
      style={{
        pointerEvents: 'auto',
        position: 'relative',
        width: 116,
        height: 148,
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        background: 'var(--glass-bg, rgba(40, 48, 65, 0.38))',
        border: '1px dashed rgba(255, 255, 255, 0.18)',
        borderRadius: 14,
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        cursor: enabled ? 'pointer' : 'default',
        color: 'var(--text-primary)',
        boxShadow: '0 10px 28px -12px rgba(0,0,0,0.6)',
        transition: 'border-color 200ms var(--ease-out-quart)',
      }}
      onMouseEnter={enabled ? (e) => { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent, #c44444) 55%, transparent)'; } : undefined}
      onMouseLeave={enabled ? (e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; } : undefined}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at 50% 42%, rgba(196,68,68,0.14) 0%, rgba(196,68,68,0.04) 42%, transparent 72%)',
        }}
      />
      <ScanFace
        size={26}
        strokeWidth={1.6}
        style={{ position: 'relative', color: 'var(--text-secondary)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))' }}
      />
      <span style={{
        position: 'relative',
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textIndent: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
        textShadow: '0 1px 3px rgba(0,0,0,0.6)',
      }}>
        Add custom
      </span>
      {enabled ? (
        <span style={{
          position: 'relative',
          margin: '0 12px',
          fontSize: 9,
          lineHeight: 1.45,
          color: 'var(--text-ghost)',
          textShadow: '0 1px 2px rgba(0,0,0,0.55)',
        }}>
          From a photo of you
        </span>
      ) : (
        <span style={{
          position: 'relative',
          padding: '3px 9px',
          borderRadius: 999,
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: '0.16em',
          textIndent: '0.16em',
          textTransform: 'uppercase',
          color: 'color-mix(in srgb, var(--accent, #c44444) 45%, #ffffff)',
          background: 'color-mix(in srgb, var(--accent, #c44444) 16%, rgba(8, 10, 14, 0.6))',
          border: '1px solid color-mix(in srgb, var(--accent, #c44444) 40%, transparent)',
        }}>
          Coming soon
        </span>
      )}
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
  // Traits come off the catalog, not the instance: a renamed grace_custom is
  // still a custom build. The pill is 20px, so only the C fits without turning
  // the row into a badge soup — Optimized is implied by Custom for now and
  // stays a picker-only detail.
  const traits = AGENTS.find((a) => a.agentId === instance.agentId);

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
      {traits?.custom && (
        <TraitBadge letter="C" tint="var(--accent, #c44444)" title="Custom character" />
      )}
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
