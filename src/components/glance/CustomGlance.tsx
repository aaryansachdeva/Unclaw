// A custom widget the connected model built from a description (services/
// customWidgets). Same language as the built-in glances: compact shows one
// line at a time (a list cycles like stocks, a metric is a number, text is
// a line); expanded lists everything. A draft, fresh from the model, wears
// a "draft" note and a Keep / Discard pair until the user decides.

import { forwardRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, type DragControls } from 'framer-motion';
import { Check, RefreshCw, X } from 'lucide-react';

import type { CustomWidget, WidgetItem } from '../../services/customWidgets';
import { GlanceSection, GlanceRow, GLANCE_META_STYLE, GLANCE_ROW_STYLE } from './GlanceSection';
import { useCycle } from './useCycle';

const CYCLE_MS = 5000;
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface Props {
  widget: CustomWidget;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  panel?: ReactNode;
  onLayout?: () => void;
  editing?: boolean;
  dragControls?: DragControls;
  onRemove?: () => void;
  /** Draft decisions and a manual refresh; the owner refetches after. */
  onKeep: () => void;
  onDiscard: () => void;
  onRefresh: () => void;
}

const ghost = (text: string) => (
  <div style={{ ...GLANCE_ROW_STYLE, color: 'var(--text-ghost)', fontSize: 12.5, cursor: 'default' }}>{text}</div>
);

function ItemLine({ item }: { item: WidgetItem }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1, overflow: 'hidden' }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 13, lineHeight: 1.3, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
          {item.title}
        </span>
        {item.value && (
          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{item.value}</span>
        )}
      </span>
      {item.meta && (
        <span style={{ ...GLANCE_META_STYLE, textTransform: 'none', letterSpacing: '0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.meta}
        </span>
      )}
    </span>
  );
}

function MetricLine({ value, unit, delta, caption }: { value?: string; unit?: string; delta?: string; caption?: string }) {
  const up = delta ? !delta.trim().startsWith('-') : null;
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{value}</span>
        {unit && <span style={{ ...GLANCE_META_STYLE }}>{unit}</span>}
        {delta && (
          <span style={{ ...GLANCE_META_STYLE, color: up ? 'var(--live)' : 'var(--danger)', opacity: 1 }}>{delta}</span>
        )}
      </span>
      {caption && <span style={{ ...GLANCE_META_STYLE, textTransform: 'none', letterSpacing: '0.01em' }}>{caption}</span>}
    </span>
  );
}

/** Keep / Discard for a draft: two quiet text buttons on one line. */
function DraftDecision({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const btn = (label: string, icon: ReactNode, onClick: () => void, primary: boolean) => (
    <button
      type="button"
      data-sheet-trigger
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 9px', borderRadius: 999,
        background: primary ? 'var(--glass-bg-hover)' : 'transparent',
        border: '1px solid var(--glass-border)',
        color: primary ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, letterSpacing: '0.02em',
        cursor: 'pointer', textShadow: 'var(--text-shadow-floating)',
      }}
    >
      {icon}{label}
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: 6, padding: '4px 8px 2px' }}>
      {btn('Keep', <Check size={11} strokeWidth={2.6} />, onKeep, true)}
      {btn('Discard', <X size={11} strokeWidth={2.6} />, onDiscard, false)}
    </div>
  );
}

export const CustomGlance = forwardRef<HTMLDivElement, Props>(function CustomGlance(
  { widget, open, onOpen, onClose, editing, dragControls, onRemove, onKeep, onDiscard, onRefresh },
  ref,
) {
  const { spec, data } = widget;
  const draft = spec.status === 'draft';
  const [hover, setHover] = useState(false);
  const items = data?.items ?? [];
  const kind = data?.kind ?? spec.view.type;
  const cycleCount = kind === 'list' ? items.length : 0;
  const idx = useCycle(cycleCount, CYCLE_MS, hover || open || cycleCount < 2);
  const shown = kind === 'list' ? items[idx] ?? items[0] : undefined;
  const empty = !data || (kind === 'list' ? items.length === 0 : kind === 'metric' ? !data.value : !data.text);

  const openUrl = (url?: string) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const compact = empty
    ? ghost(data?.error ? 'Source unavailable' : 'Fetching…')
    : kind === 'list' && shown ? (
      <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${idx}:${shown.title}`}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
          >
            <GlanceRow onClick={onOpen} ariaLabel={`Open ${spec.label}`}>
              <ItemLine item={shown} />
            </GlanceRow>
          </motion.div>
        </AnimatePresence>
      </div>
    ) : kind === 'metric' ? (
      <GlanceRow onClick={onOpen} ariaLabel={`Open ${spec.label}`}>
        <MetricLine value={data?.value} unit={data?.unit} delta={data?.delta} caption={data?.caption} />
      </GlanceRow>
    ) : (
      <GlanceRow onClick={onOpen} ariaLabel={`Open ${spec.label}`}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{data?.text}</span>
          {data?.meta && <span style={{ ...GLANCE_META_STYLE, textTransform: 'none', letterSpacing: '0.01em' }}>{data.meta}</span>}
        </span>
      </GlanceRow>
    );

  const expanded: ReactNode = open ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {kind === 'list' && items.map((it, i) => (
        <div
          key={`${i}:${it.title}`}
          data-sheet-trigger
          role={it.url ? 'link' : undefined}
          tabIndex={it.url ? 0 : undefined}
          onClick={() => openUrl(it.url)}
          onKeyDown={(e) => { if (e.key === 'Enter') openUrl(it.url); }}
          style={{ ...GLANCE_ROW_STYLE, alignItems: 'flex-start', cursor: it.url ? 'pointer' : 'default', color: 'var(--text-primary)' }}
          onMouseEnter={(e) => { if (it.url) e.currentTarget.style.background = 'var(--glass-bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ItemLine item={it} />
        </div>
      ))}
      {kind === 'metric' && (
        <div style={{ ...GLANCE_ROW_STYLE, cursor: 'default', color: 'var(--text-primary)' }}>
          <MetricLine value={data?.value} unit={data?.unit} delta={data?.delta} caption={data?.caption} />
        </div>
      )}
      {kind === 'text' && (
        <div
          data-sheet-trigger
          onClick={() => openUrl(data?.url)}
          style={{ ...GLANCE_ROW_STYLE, cursor: data?.url ? 'pointer' : 'default', color: 'var(--text-primary)' }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13, lineHeight: 1.4 }}>{data?.text}</span>
            {data?.meta && <span style={{ ...GLANCE_META_STYLE, textTransform: 'none', letterSpacing: '0.01em' }}>{data.meta}</span>}
          </span>
        </div>
      )}
      {empty && ghost(data?.error ? `Source unavailable: ${data.error}` : 'Nothing to show yet')}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 8px 0' }}>
        <span style={{ ...GLANCE_META_STYLE, textTransform: 'none', letterSpacing: '0.01em', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {spec.summary || `Every ${spec.refresh_min} min`}{data?.stale ? ' · stale' : ''}
        </span>
        <button
          type="button"
          data-sheet-trigger
          aria-label={`Refresh ${spec.label}`}
          title="Refresh"
          onClick={(e) => { e.stopPropagation(); onRefresh(); }}
          style={{ display: 'inline-flex', background: 'transparent', border: 'none', color: 'var(--text-ghost)', cursor: 'pointer', padding: 2 }}
        >
          <RefreshCw size={12} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  ) : undefined;

  return (
    <GlanceSection
      ref={ref}
      label={spec.label}
      note={draft ? '· draft' : undefined}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      panel={expanded}
      editing={editing}
      dragControls={dragControls}
      onRemove={onRemove}
    >
      {compact}
      {draft && <DraftDecision onKeep={onKeep} onDiscard={onDiscard} />}
    </GlanceSection>
  );
});
