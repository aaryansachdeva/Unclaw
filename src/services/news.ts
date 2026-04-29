// Soul.exe news REST client.
//
// Soul.exe proxies Hacker News Algolia and normalizes the response into
// the shape below. Same `available` pattern as reminders/weather: the
// panel silently hides when soul doesn't expose /news.

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
  error?: string;
}

export async function getNews(topic?: string): Promise<NewsResult> {
  const qs = topic ? `?topic=${encodeURIComponent(topic)}` : '';
  let res: Response;
  try {
    res = await fetch(`${SOUL_URL}/news${qs}`, { method: 'GET' });
  } catch (err) {
    return { available: false, error: `network: ${(err as Error).message}` };
  }
  if (res.status === 404) return { available: false };
  if (!res.ok) return { available: true, error: `soul /news ${res.status}` };
  try {
    const data = (await res.json()) as NewsPayload;
    return { available: true, data };
  } catch (err) {
    return { available: true, error: `parse: ${(err as Error).message}` };
  }
}
