// Soul.exe news REST client.
//
// Soul now sources headlines via Gemini-grounded search (replacing the
// old Guardian proxy). BYOK strict — the user's Gemini key is read from
// safeStorage and forwarded via the X-Gemini-Key header. When grounded
// search isn't enabled the panel renders a hint pointing at Settings.

import { fetchApiKeys } from './apiKeys';

const SOUL_URL = 'http://127.0.0.1:8765';

export interface NewsArticle {
  title: string;
  source: string;
  /** ISO 8601 (UTC) when the story was posted upstream. */
  published_at: string;
  url: string;
  summary: string;
  image_url?: string | null;
}

export interface NewsPayload {
  articles: NewsArticle[];
}

export interface NewsResult {
  available: boolean;
  data?: NewsPayload;
  hint?: string;
  error?: string;
}

const HINT_DISABLED =
  'Enable web search (Gemini) in Settings to fetch live news.';

export async function getNews(topic?: string): Promise<NewsResult> {
  const keys = await fetchApiKeys();
  if (!keys.grounding_search_enabled || !keys.gemini_search_api_key) {
    return { available: false, hint: HINT_DISABLED };
  }

  const qs = topic ? `?topic=${encodeURIComponent(topic)}` : '';
  let res: Response;
  try {
    res = await fetch(`${SOUL_URL}/news${qs}`, {
      method: 'GET',
      headers: { 'X-Gemini-Key': keys.gemini_search_api_key },
    });
  } catch (err) {
    return { available: false, error: `network: ${(err as Error).message}` };
  }
  if (res.status === 404) return { available: false };
  if (!res.ok) return { available: true, error: `soul /news ${res.status}` };
  try {
    const parsed = (await res.json()) as
      NewsPayload | { available: false; hint?: string };
    if ('available' in parsed && parsed.available === false) {
      return { available: false, hint: parsed.hint || HINT_DISABLED };
    }
    return { available: true, data: parsed as NewsPayload };
  } catch (err) {
    return { available: true, error: `parse: ${(err as Error).message}` };
  }
}
