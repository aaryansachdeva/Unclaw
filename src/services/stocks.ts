// Soul.exe stocks REST client.
//
// Soul serves quotes from Yahoo Finance chart data: free, keyless,
// unofficial, so soul keeps a stale-cache fallback. No gate (2026-09-15).


import { getSoulBaseUrl } from './soulBase';

export interface StockQuote {
  symbol: string;
  name: string;
  /** Last trade price (last close when the market is closed). */
  price: number;
  change: number;
  change_pct: number;
  currency: string;
}

export interface StocksPayload {
  quotes: StockQuote[];
}

export interface StocksResult {
  available: boolean;
  data?: StocksPayload;
  hint?: string;
  error?: string;
}

const HINT_DISABLED =
  'Live stock prices could not be reached right now.';

/** One match from the ticker search. */
export interface SymbolMatch {
  symbol: string;
  name: string;
  /** Exchange display name, e.g. "NASDAQ". */
  exchange: string;
  /** equity | etf | index | mutualfund | cryptocurrency | currency */
  kind: string;
}

/** A Yahoo-shaped ticker (AAPL, BRK-B, AAPL.TO, ^GSPC, EURUSD=X); mirrors
 *  soul.widgets_free.SYMBOL_RE. */
export const SYMBOL_RE = /^[A-Z0-9.^=-]{1,15}$/;
/** Soul quotes at most this many at once (widgets_free.MAX_SYMBOLS). */
export const MAX_SYMBOLS = 20;

export async function getStocks(symbols?: string[]): Promise<StocksResult> {
  // No key, no gate (2026-09-15): soul serves this from free public
  // sources (MET Norway, Google News / BBC RSS, Yahoo chart data) and
  // caches it, so the widget works for every user from first run.

  const qs = symbols && symbols.length > 0
    ? `?symbols=${encodeURIComponent(symbols.join(','))}`
    : '';
  let res: Response;
  try {
    res = await fetch(`${getSoulBaseUrl()}/stocks${qs}`, {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { available: false, error: `network: ${(err as Error).message}` };
  }
  if (res.status === 404) return { available: false };
  if (!res.ok) return { available: true, error: `soul /stocks ${res.status}` };
  try {
    const parsed = (await res.json()) as
      StocksPayload | { available: false; hint?: string };
    if ('available' in parsed && parsed.available === false) {
      return { available: false, hint: parsed.hint || HINT_DISABLED };
    }
    return { available: true, data: parsed as StocksPayload };
  } catch (err) {
    return { available: true, error: `parse: ${(err as Error).message}` };
  }
}

/** Ticker search for the stocks glance's add field. null = unreachable,
 *  [] = no matches. */
export async function searchSymbols(q: string, signal?: AbortSignal): Promise<SymbolMatch[] | null> {
  const data = await soulSearch<{ matches?: SymbolMatch[] }>(`/stocks/search?q=${encodeURIComponent(q)}`, signal);
  if (data == null) return null;
  return Array.isArray(data.matches) ? data.matches : [];
}

/** GET a soul search route, bounded to 10 s and cancellable by the caller
 *  (the field aborts the request a new keystroke replaces). null on any
 *  failure, including an older soul without the route. */
async function soulSearch<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(`${getSoulBaseUrl()}${path}`, { signal: ctl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
