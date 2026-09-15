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
