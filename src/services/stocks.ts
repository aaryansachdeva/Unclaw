// Soul.exe stocks REST client.
//
// Soul.exe proxies Twelve Data's `/quote` endpoint and normalizes the
// response into the shape below. Same `available` envelope as
// reminders/news/weather: the panel silently hides when soul doesn't
// expose /stocks (older deploys).
//
// Cached server-side for 60 s — Twelve Data's free tier caps at 8 req/min
// and the API key lives ONLY in soul.exe (never shipped to the renderer).

const SOUL_URL = 'http://127.0.0.1:8765';

export interface StockQuote {
  symbol: string;
  name: string;
  /** Last close when the market is closed; live close otherwise. */
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
  error?: string;
}

export async function getStocks(symbols?: string[]): Promise<StocksResult> {
  const qs = symbols && symbols.length > 0
    ? `?symbols=${encodeURIComponent(symbols.join(','))}`
    : '';
  let res: Response;
  try {
    res = await fetch(`${SOUL_URL}/stocks${qs}`, { method: 'GET' });
  } catch (err) {
    return { available: false, error: `network: ${(err as Error).message}` };
  }
  if (res.status === 404) return { available: false };
  if (!res.ok) return { available: true, error: `soul /stocks ${res.status}` };
  try {
    const data = (await res.json()) as StocksPayload;
    return { available: true, data };
  } catch (err) {
    return { available: true, error: `parse: ${(err as Error).message}` };
  }
}
