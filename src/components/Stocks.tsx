// Stocks widget shaped after the same mobile-tab pattern as Reminders /
// News / Weather:
//
//   collapsed     [chart] Stocks  +0.42%                 (small pill)
//   click ↓
//   expanded     ┌──────────────────────────────────┐
//                │ Watchlist                    5   │
//                │ AAPL ····· $182.30  +1.23 (+0.68%)│
//                │ MSFT ····· $415.10  -0.40 (-0.10%)│
//                │ ...                              │
//                └──────────────────────────────────┘
//                [chart] Stocks  +0.42%               [×]
//
// Grows UPWARD; rows are read-only. Auto-refreshes every 60 s on mount
// since soul caches upstream for 60 s anyway (Twelve Data's free tier
// caps at 8 req/min).

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart3, X } from 'lucide-react';
import { getStocks, StockQuote } from '../services/stocks';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface StocksProps {
  /** Bumping this number forces a refetch (chat round side effects). */
  refreshKey?: number;
  /** Controlled open/close. App.tsx lifts this so only one widget panel
   *  can be expanded at a time. */
  isOpen?: boolean;
  onToggle?: () => void;
}

export function Stocks({ refreshKey = 0, isOpen, onToggle }: StocksProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen ?? internalOpen;
  const setOpen = onToggle ?? (() => setInternalOpen(o => !o));
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    const res = await getStocks();
    if (myReq !== reqIdRef.current) return;
    setAvailable(res.available);
    setQuotes(res.available && res.data ? res.data.quotes : []);
  }, []);

  useEffect(() => {
    void refresh();
    // Soul caches upstream for 60 s; widget polls every 60 s.
    const id = window.setInterval(() => { void refresh(); }, 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (refreshKey > 0) void refresh();
  }, [refreshKey, refresh]);

  if (available === false) return null;
  if (available === null) return null;

  const count = quotes.length;
  // Aggregate % change — the simple average across the watchlist. Tints the
  // pill green/red to telegraph the day at a glance.
  const avgPct = count > 0
    ? quotes.reduce((acc, q) => acc + q.change_pct, 0) / count
    : 0;
  const avgUp = avgPct >= 0;

  return (
    <div style={{ position: 'relative' }}>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              left: 0,
              width: 360,
              maxHeight: '60vh',
              overflowY: 'auto',
              padding: 14,
              borderRadius: 16,
              background: 'var(--glass-bg-panel)',
              backdropFilter: 'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              border: '1px solid var(--glass-border-focus)',
              boxShadow: [
                '0 1px 0 rgba(255, 255, 255, 0.06) inset',
                '0 16px 36px -10px rgba(0, 0, 0, 0.45)',
              ].join(', '),
              pointerEvents: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.01em',
                }}
              >
                Watchlist
              </span>
              {count > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {count}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {count === 0 ? (
                <EmptyState />
              ) : (
                quotes.map(q => <QuoteRow key={q.symbol} quote={q} />)
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Pill
        open={open}
        avgPct={avgPct}
        avgUp={avgUp}
        hasData={count > 0}
        onToggle={setOpen}
      />
    </div>
  );
}

// ---------- pill ------------------------------------------------------

function Pill({
  open, avgPct, avgUp, hasData, onToggle,
}: {
  open: boolean;
  avgPct: number;
  avgUp: boolean;
  hasData: boolean;
  onToggle: () => void;
}) {
  const [hover, setHover] = useState(false);
  const surfaceOn = hover || open;
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-expanded={open}
      aria-label={open ? 'Close stocks' : 'Open stocks'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        height: 40,
        borderRadius: 14,
        background: surfaceOn
          ? (open ? 'var(--glass-bg-hover)' : 'var(--glass-bg)')
          : 'transparent',
        backdropFilter: surfaceOn ? 'var(--glass-blur)' : 'none',
        WebkitBackdropFilter: surfaceOn ? 'var(--glass-blur)' : 'none',
        border: `1px solid ${
          surfaceOn ? (open ? 'var(--glass-border-focus)' : 'var(--glass-border)') : 'transparent'
        }`,
        boxShadow: surfaceOn
          ? '0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 12px rgba(0,0,0,0.25)'
          : 'none',
        cursor: 'pointer',
        transition:
          'background 0.2s var(--ease-out-quart), border-color 0.2s var(--ease-out-quart), box-shadow 0.2s var(--ease-out-quart)',
      }}
    >
      <BarChart3
        size={14}
        strokeWidth={2}
        color="var(--text-primary)"
        aria-hidden
        style={{
          filter: surfaceOn ? 'none' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: 'var(--text-primary)',
          textShadow: surfaceOn ? 'none' : '0 1px 2px rgba(0,0,0,0.55)',
        }}
      >
        Stocks
      </span>
      {hasData && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            // Day tint: green for up, red for down. Lives on the right
            // edge in the same slot the count occupies in the other pills,
            // so the row width stays stable across widgets.
            color: avgUp ? 'var(--live)' : 'var(--accent)',
            minWidth: 12,
            textAlign: 'right',
            opacity: open ? 1 : 0.85,
            textShadow: surfaceOn ? 'none' : '0 1px 2px rgba(0,0,0,0.55)',
          }}
        >
          {formatPct(avgPct)}
        </span>
      )}
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          marginLeft: 2,
          color: 'var(--text-ghost)',
        }}
      >
        {open ? <X size={11} strokeWidth={2.4} /> : null}
      </span>
    </motion.button>
  );
}

// ---------- row -------------------------------------------------------

function QuoteRow({ quote }: { quote: StockQuote }) {
  const [hover, setHover] = useState(false);
  const up = quote.change >= 0;
  const tint = up ? 'var(--live)' : 'var(--accent)';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 13px',
        borderRadius: 10,
        background: hover ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.045)',
        border: `1px solid ${hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
        transition:
          'background 0.18s var(--ease-out-quart), border-color 0.18s var(--ease-out-quart)',
      }}
    >
      {/* Symbol + name (truncated) */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '0.02em',
            lineHeight: 1.25,
          }}
        >
          {quote.symbol}
        </span>
        {quote.name && (
          <span
            style={{
              marginTop: 2,
              fontSize: 11.5,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              letterSpacing: '0.01em',
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {quote.name}
          </span>
        )}
      </div>

      {/* Price + change */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
            lineHeight: 1.25,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatPrice(quote.price, quote.currency)}
        </span>
        <span
          style={{
            marginTop: 2,
            fontSize: 11.5,
            fontWeight: 500,
            color: tint,
            letterSpacing: '0.01em',
            lineHeight: 1.3,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {formatChange(quote.change)} ({formatPct(quote.change_pct)})
        </span>
      </div>
    </motion.div>
  );
}

// ---------- empty state ----------------------------------------------

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={{
        padding: '14px 4px 6px 4px',
        fontSize: 12.5,
        lineHeight: 1.5,
        color: 'var(--text-secondary)',
      }}
    >
      No quotes right now. Try again in a moment.
    </motion.div>
  );
}

// ---------- helpers --------------------------------------------------

function formatPrice(price: number, currency: string): string {
  const sym = currencySymbol(currency);
  if (!Number.isFinite(price)) return `${sym}—`;
  return `${sym}${price.toFixed(2)}`;
}

function formatChange(change: number): string {
  if (!Number.isFinite(change)) return '—';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}`;
}

function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function currencySymbol(currency: string): string {
  switch ((currency || 'USD').toUpperCase()) {
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'JPY': return '¥';
    case 'INR': return '₹';
    default:    return '';
  }
}
