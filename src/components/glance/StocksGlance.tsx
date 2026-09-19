// Stocks glance: one quote at a time (symbol, price, day change in green
// or the danger tone), cycling through the watchlist. Expanded, every
// quote as a row in the same language with the company name under it, and
// the watchlist is edited right there: x on hover drops a ticker, the grip
// reorders, and a ticker search adds more. Data from soul's free Yahoo
// chart path (services/stocks), every 10 min; the watchlist follows the
// account in user settings (glance.stocks).

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls, type DragControls } from 'framer-motion';
import { GripVertical } from 'lucide-react';

import { getStocks, searchSymbols, MAX_SYMBOLS, SYMBOL_RE, type StockQuote, type SymbolMatch } from '../../services/stocks';
import { GlanceSection, GlanceRow, GLANCE_META_STYLE, GLANCE_ROW_STYLE } from './GlanceSection';
import { GlanceSearch, GlanceAddButton, GlanceHeaderAdd, GlanceRemoveButton } from './GlanceSearch';
import { useCycle } from './useCycle';

const CYCLE_MS = 5000;
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface Props {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  panel?: ReactNode;
  refreshKey: number;
  /** The saved watchlist in display order; null = never edited, soul's
   *  starter set. */
  symbols?: string[] | null;
  /** Absent = the watchlist is read-only here. */
  onSymbolsChange?: (next: string[]) => void;
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
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 'calc(13px * var(--glance-text, 1))', lineHeight: 1.3, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      <span style={{ fontWeight: 600, letterSpacing: '0.02em', minWidth: 44 }}>{q.symbol}</span>
      <span style={{ fontWeight: 500 }}>{money(q.price)}</span>
      <span style={{ ...GLANCE_META_STYLE, color: up ? 'var(--live)' : 'var(--danger)', opacity: 1 }}>
        {up ? '+' : ''}{q.change_pct.toFixed(2)}%
      </span>
    </span>
  );
}

export const StocksGlance = forwardRef<HTMLDivElement, Props>(function StocksGlance(
  { open, onOpen, onClose, refreshKey, onLayout, editing, dragControls, onRemove, symbols, onSymbolsChange },
  ref,
) {
  const [quotes, setQuotes] = useState<StockQuote[] | null>(null);
  const [off, setOff] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [hover, setHover] = useState(false);
  const [adding, setAdding] = useState(false);
  // While a row is dragged the order lives here and is saved once, on drop.
  const [draft, setDraft] = useState<string[] | null>(null);
  const draftRef = useRef<string[] | null>(null);
  const reqRef = useRef(0);
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  const refresh = useCallback(async () => {
    const my = ++reqRef.current;
    const syms = symbolsRef.current;
    if (syms && syms.length === 0) { setQuotes([]); setOff(false); setFetching(false); return; }
    setFetching(true);
    const res = await getStocks(syms ?? undefined);
    if (my !== reqRef.current) return;
    setFetching(false);
    if (res.available && res.data) { setQuotes(res.data.quotes); setOff(false); }
    else setOff(true);
  }, []);

  // Refetch when the set of tickers changes; a reorder is display only.
  const setKey = symbols ? [...symbols].sort().join(',') : '';
  useEffect(() => { void refresh(); }, [setKey, refresh]);
  useEffect(() => {
    const id = window.setInterval(() => { void refresh(); }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);
  useEffect(() => { if (refreshKey > 0) void refresh(); }, [refreshKey, refresh]);
  useEffect(() => { onLayout?.(); }, [quotes, off, adding, onLayout]);
  useEffect(() => { if (!open) setAdding(false); }, [open]);

  const bySym = useMemo(() => new Map<string, StockQuote>((quotes ?? []).map((q) => [q.symbol, q])), [quotes]);
  const listed = useMemo(() => symbols ?? (quotes ?? []).map((q) => q.symbol), [symbols, quotes]);
  const listedRef = useRef(listed);
  listedRef.current = listed;
  const order = draft ?? listed;
  const ordered = useMemo(
    () => listed.map((s) => bySym.get(s)).filter((q): q is StockQuote => q !== undefined),
    [listed, bySym],
  );

  const idx = useCycle(ordered.length, CYCLE_MS, hover || open);
  const shown = ordered.length ? ordered[idx] : null;

  const canEdit = !!onSymbolsChange;
  // Before the first edit the list IS whatever soul returned, so adding
  // waits for that answer rather than replacing the starter set.
  const canAdd = canEdit && (symbols != null || quotes != null) && listed.length < MAX_SYMBOLS;

  const addSymbol = (raw: string) => {
    const sym = raw.trim().toUpperCase();
    setAdding(false);
    if (!onSymbolsChange || !SYMBOL_RE.test(sym)) return;
    const base = listedRef.current;
    if (base.includes(sym)) return;
    onSymbolsChange([...base, sym].slice(0, MAX_SYMBOLS));
  };
  const removeSymbol = (sym: string) => onSymbolsChange?.(listedRef.current.filter((s) => s !== sym));
  const commitOrder = () => {
    const next = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (next && next.join(',') !== listedRef.current.join(',')) onSymbolsChange?.(next);
  };

  const ghost = (text: string) => (
    <div style={{ padding: '3px 8px 6px', fontSize: 'calc(12.5px * var(--glance-text, 1))', fontWeight: 500, color: 'var(--text-ghost)', textShadow: 'var(--text-shadow-floating)' }}>
      {text}
    </div>
  );

  const expanded = quotes || off ? (
    <div>
      {adding && (
        <GlanceSearch<SymbolMatch>
          placeholder="Ticker or company"
          ariaLabel="Search for a ticker"
          search={searchSymbols}
          toItem={(m) => ({ key: m.symbol, primary: m.symbol, secondary: [m.name, m.exchange].filter(Boolean).join(' · ') })}
          onPick={(m) => addSymbol(m.symbol)}
          onRaw={(text) => {
            if (!SYMBOL_RE.test(text.toUpperCase())) return false;
            addSymbol(text);
            return true;
          }}
          onCancel={() => setAdding(false)}
          emptyHint="No matches. Enter adds it as typed."
        />
      )}
      {order.length === 0 && !adding && ghost(off ? 'Quotes unavailable' : 'Empty watchlist')}
      <Reorder.Group
        axis="y"
        values={order}
        onReorder={(next: string[]) => { draftRef.current = next; setDraft(next); }}
        as="div"
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
      >
        {order.map((sym) => (
          <StockRow
            key={sym}
            symbol={sym}
            quote={bySym.get(sym)}
            pending={fetching}
            editable={canEdit}
            onRemove={() => removeSymbol(sym)}
            onDragEnd={commitOrder}
          />
        ))}
      </Reorder.Group>
      {canAdd && !adding && <GlanceAddButton onClick={() => setAdding(true)}>Add a ticker</GlanceAddButton>}
      <div style={{ ...GLANCE_META_STYLE, padding: '6px 8px 0', opacity: 0.55 }}>Delayed quotes</div>
    </div>
  ) : undefined;

  return (
    <GlanceSection
      ref={ref}
      label="Stocks"
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      panel={expanded}
      editing={editing}
      dragControls={dragControls}
      onRemove={onRemove}
      action={canAdd ? (
        <GlanceHeaderAdd label="Add a ticker" onClick={() => { if (!open) onOpen(); setAdding(true); }} />
      ) : undefined}
    >
      {!quotes && !off && ghost('Fetching quotes…')}
      {off && !quotes && ghost('Quotes unavailable')}
      {quotes && !shown && ghost(listed.length === 0 ? 'Empty watchlist' : fetching ? 'Fetching quotes…' : 'Quotes unavailable')}
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

/** One watchlist row in the expanded view. Dragging starts only from the
 *  grip (dragListener off), so the row itself stays a plain row; the grip
 *  and the x appear on hover or keyboard focus and stay while dragging.
 *  They sit at the end of the company-name line, which is capped short
 *  enough to leave them room, so the quote line never reflows on hover. */
function StockRow({
  symbol, quote, pending, editable, onRemove, onDragEnd,
}: {
  symbol: string;
  quote?: StockQuote;
  pending: boolean;
  editable: boolean;
  onRemove: () => void;
  onDragEnd: () => void;
}) {
  const controls = useDragControls();
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const tools = editable && (hover || dragging);
  return (
    <Reorder.Item
      value={symbol}
      as="div"
      dragListener={false}
      dragControls={controls}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => { setDragging(false); onDragEnd(); }}
      whileDrag={{ scale: 1.02, zIndex: 2 }}
      style={{ position: 'relative', borderRadius: 8 }}
    >
      <div
        data-sheet-trigger
        tabIndex={editable ? 0 : undefined}
        aria-label={quote ? `${symbol}, ${quote.name}` : symbol}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(false); }}
        style={{
          ...GLANCE_ROW_STYLE,
          alignItems: 'flex-start',
          position: 'relative',
          padding: '3px 6px 3px 8px',
          color: 'var(--text-primary)',
          outline: 'none',
          background: hover || dragging ? 'var(--glass-bg-hover)' : 'transparent',
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1, overflow: 'hidden' }}>
          {quote ? <QuoteLine q={quote} /> : (
            <span style={{ fontSize: 'calc(13px * var(--glance-text, 1))', fontWeight: 600, letterSpacing: '0.02em', lineHeight: 1.3, whiteSpace: 'nowrap' }}>{symbol}</span>
          )}
          <span style={{ ...GLANCE_META_STYLE, textTransform: 'none', letterSpacing: '0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: editable ? 150 : 196 }}>
            {quote ? quote.name : pending ? 'Fetching quote…' : 'No quote for this symbol'}
          </span>
        </span>
        <AnimatePresence>
          {tools && (
            <motion.span
              key="tools"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              style={{ position: 'absolute', right: 6, bottom: 3, display: 'inline-flex', alignItems: 'center', gap: 2 }}
            >
              <span
                role="button"
                aria-label={`Drag to reorder ${symbol}`}
                title="Drag to reorder"
                onPointerDown={(e) => { controls.start(e); }}
                style={{
                  width: 18, height: 18,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-ghost)', cursor: 'grab', touchAction: 'none',
                }}
              >
                <GripVertical size={13} strokeWidth={2.2} />
              </span>
              <GlanceRemoveButton label={symbol} onClick={onRemove} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </Reorder.Item>
  );
}
