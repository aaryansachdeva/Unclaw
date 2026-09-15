// Soul.exe news REST client.
//
// Soul serves headlines from Google News RSS in the user's locale, with
// BBC World as the fallback. Free, keyless, no gate (2026-09-15).


import { getSoulBaseUrl } from './soulBase';

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
  'Live news could not be reached right now.';

export async function getNews(topic?: string): Promise<NewsResult> {
  // No key, no gate (2026-09-15): soul serves this from free public
  // sources (MET Norway, Google News / BBC RSS, Yahoo chart data) and
  // caches it, so the widget works for every user from first run.

  const qs = topic ? `?topic=${encodeURIComponent(topic)}` : '';
  let res: Response;
  try {
    res = await fetch(`${getSoulBaseUrl()}/news${qs}`, {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
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

/** What soul could read of one article (GET /news/article). */
export interface ArticleRead {
  url: string;
  /** The publisher URL the Google News link resolved to. */
  resolved_url: string;
  site: string;
  title: string;
  /** Readable article text, capped; empty when the site could not be read. */
  text: string;
  text_from: 'jsonld' | 'paragraphs' | 'description' | 'none';
}

/** Read one article through soul for the News glance's Summarize. null on
 *  any failure (older soul, network); the chat then gets the headline. */
export async function readArticle(url: string): Promise<ArticleRead | null> {
  if (!url) return null;
  try {
    const res = await fetch(`${getSoulBaseUrl()}/news/article?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ArticleRead;
  } catch {
    return null;
  }
}
