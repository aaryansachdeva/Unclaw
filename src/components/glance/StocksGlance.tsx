// Stocks glance: one quote at a time (symbol, price, day change in green
// or the danger tone), cycling through the watchlist. Expanded, every
// quote as a row in the same language with the company name under it.
// Data from soul's free Yahoo chart path (services/stocks), every 10 min.

import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, type DragControls } from 'framer-motion';

import { getStocks, type StockQuote } from '../../services/stocks';
import { GlanceSection, GlanceRow, GLANCE_META_STYLE } from './GlanceSection';
import { useCycle } from './useCycle';

const CYCLE_MS = 5000;
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface Props {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  panel?: ReactNode;
  refreshKey: number;
  /** Edit mode (GlanceColumn): header only, drag handle and remove. */
  editing?: boolean;
  dragControls?: DragControls;
  onRemove?: () => void;
  onLayout?: () => void;
}

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function QuoteLine({ q }: { q: StockQuote }) {
  const up = q.change_pct >= 0;
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ fontWeight: 600, letterSpacing: '0.02em', minWidth: 44 }}>{q.symbol}</span>
      <span style={{ fontWeight: 500 }}>{money(q.price)}</span>
      <span style={{ ...GLANCE_META_STYLE, color: up ? 'var(--live)' : 'var(--danger)', opacity: 1 }}>
        {up ? '+' : ''}{q.change_pct.toFixed(2)}%
      </span>
    </span>
  );
}

export const StocksGlance = forwardRef<HTMLDivElement, Props>(function StocksGlance(
  { open, onOpen, onClose, refreshKey, onLayout, editing, dragControls, onRemove },
  ref,
) {
  const [quotes, setQuotes] = useState<StockQuote[] | null>(null);
  const [off, setOff] = useState(false);
  const [hover, setHover] = useState(false);
  const reqRef = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++reqRef.current;
    const res = await getStocks();
    if (my !== reqRef.current) return;
    if (res.available && res.data) { setQuotes(res.data.quotes); setOff(false); }
    else setOff(true);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);
  useEffect(() => { if (refreshKey > 0) void refresh(); }, [refreshKey, refresh]);
  useEffect(() => { onLayout?.(); }, [quotes, off, onLayout]);

  const idx = useCycle(quotes?.length ?? 0, CYCLE_MS, hover || open);
  const shown = quotes && quotes.length ? quotes[idx] : null;
  const avg = quotes && quotes.length
    ? quotes.reduce((a, q) => a + q.change_pct, 0) / quotes.length
    : null;
  const note = avg == null ? null : `${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%`;

  const ghost = (text: string) => (
    <div style={{ padding: '3px 8px 6px', fontSize: 12.5, fontWeight: 500, color: 'var(--text-ghost)', textShadow: 'var(--text-shadow-floating)' }}>
      {text}
    </div>
  );

  const expanded = quotes && (
    <div>
      {quotes.length === 0 && ghost('Empty watchlist')}
      {quotes.map((q) => (
        <GlanceRow key={q.symbol} align="flex-start">
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <QuoteLine q={q} />
            <span style={{ ...GLANCE_META_STYLE, textTransform: 'none', letterSpacing: '0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
              {q.name}
            </span>
          </span>
        </GlanceRow>
      ))}
      <div style={{ ...GLANCE_META_STYLE, padding: '6px 8px 0', opacity: 0.55 }}>Delayed quotes</div>
    </div>
  );

  return (
    <GlanceSection ref={ref} label="Stocks" note={note} open={open} onOpen={onOpen} onClose={onClose} panel={expanded ?? undefined} editing={editing} dragControls={dragControls} onRemove={onRemove}>
      {!quotes && !off && ghost('Fetching quotes…')}
      {off && !quotes && ghost('Quotes unavailable')}
      {quotes && quotes.length === 0 && ghost('Empty watchlist')}
      {shown && (
        /* One quote at a time, cycling every few seconds with a soft
           cross-fade; pauses under the pointer so it can be read. */
        <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={shown.symbol}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
            >
              <GlanceRow onClick={onOpen} ariaLabel={`Open stocks (${shown.symbol})`}>
                <QuoteLine q={shown} />
              </GlanceRow>
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </GlanceSection>
  );
});
