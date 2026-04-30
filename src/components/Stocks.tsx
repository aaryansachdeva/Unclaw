// Stocks panel content. Wrapped by SheetPanel; auto-refreshes every
// 60 s on mount because soul caches upstream for 60 s anyway (Twelve
// Data's free tier caps at 8 req/min).

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { getStocks, StockQuote } from '../services/stocks';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface StocksPanelProps {
  refreshKey?: number;
  /** Bubble the watchlist's average day-pct up so the dock badge can
   *  tint it green/red. */
  onDayPctChange?: (pct: number | null) => void;
}

export function StocksPanel({ refreshKey = 0, onDayPctChange }: StocksPanelProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
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
    const id = window.setInterval(() => { void refresh(); }, 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (refreshKey > 0) void refresh();
  }, [refreshKey, refresh]);

  // Bubble aggregate pct up.
  useEffect(() => {
    if (!quotes.length) {
      onDayPctChange?.(null);
      return;
    }
    const avg = quotes.reduce((acc, q) => acc + q.change_pct, 0) / quotes.length;
    onDayPctChange?.(avg);
  }, [quotes, onDayPctChange]);

  if (available === false) {
    return (
      <div style={unavailableStyle}>
        Stocks aren't available on this build of soul.
      </div>
    );
  }
  if (available === null) return null;

  const count = quotes.length;
  const avgPct = count > 0
    ? quotes.reduce((acc, q) => acc + q.change_pct, 0) / count
    : 0;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
          }}
        >
          {count > 0 ? `${count} symbols` : 'Empty watchlist'}
        </span>
        {count > 0 && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: avgPct >= 0 ? 'var(--live)' : 'var(--accent)',
            }}
          >
            {formatPct(avgPct)}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {count === 0 ? (
          <EmptyState />
        ) : (
          quotes.map((q, i) => (
            <QuoteRow
              key={q.symbol}
              quote={q}
              staggerDelay={Math.min(0.04 * i, 0.32)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------- row -------------------------------------------------------

function QuoteRow({ quote, staggerDelay }: { quote: StockQuote; staggerDelay: number }) {
  const [hover, setHover] = useState(false);
  const up = quote.change >= 0;
  const tint = up ? 'var(--live)' : 'var(--accent)';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: staggerDelay, ease: EASE_OUT_EXPO }}
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
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              letterSpacing: 0,
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
            fontSize: 12,
            fontWeight: 500,
            color: tint,
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

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={{
        padding: '14px 4px 6px 4px',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--text-secondary)',
      }}
    >
      No quotes right now. Try again in a moment.
    </motion.div>
  );
}

const unavailableStyle: React.CSSProperties = {
  padding: '14px 4px',
  fontSize: 13,
  color: 'var(--text-secondary)',
};

// ---------- helpers --------------------------------------------------

function formatPrice(price: number, currency: string): string {
  const sym = currencySymbol(currency);
  if (!Number.isFinite(price)) return `${sym}-`;
  return `${sym}${price.toFixed(2)}`;
}

function formatChange(change: number): string {
  if (!Number.isFinite(change)) return '-';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}`;
}

function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return '-';
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
