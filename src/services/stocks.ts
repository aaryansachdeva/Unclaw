// Soul.exe stocks REST client.
//
// Soul now sources quotes via Gemini-grounded search (replacing the old
// Twelve Data proxy). BYOK strict — the user's Gemini key is read from
// safeStorage and forwarded via the X-Gemini-Key header. When grounded
// search isn't enabled the panel renders a hint pointing at Settings.
//
// Trade-off vs the prior plumbing: prices and percent-changes are
// paraphrased from search results, not pulled from a quote API. Fine
// for a glance widget, not a trading dashboard. Cached server-side for
// 60 min so a flurry of widget mounts doesn't burn the user's free
// grounded quota.

import { fetchApiKeys } from './apiKeys';

const SOUL_URL = 'http://127.0.0.1:8765';

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
  'Enable web search (Gemini) in Settings to fetch live stock prices.';

export async function getStocks(symbols?: string[]): Promise<StocksResult> {
  const keys = await fetchApiKeys();
  if (!keys.grounding_search_enabled || !keys.gemini_search_api_key) {
    return { available: false, hint: HINT_DISABLED };
  }

  const qs = symbols && symbols.length > 0
    ? `?symbols=${encodeURIComponent(symbols.join(','))}`
    : '';
  let res: Response;
  try {
    res = await fetch(`${SOUL_URL}/stocks${qs}`, {
      method: 'GET',
      headers: { 'X-Gemini-Key': keys.gemini_search_api_key },
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
