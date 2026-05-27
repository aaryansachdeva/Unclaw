// Soul.exe weather REST client.
//
// Soul now reads weather via Gemini-grounded search (replacing the old
// WeatherAPI.com proxy), which means the user's Gemini key is required.
// BYOK strict — we never fall back to a dev key. When the user hasn't
// supplied a Gemini key OR hasn't enabled grounded search, the panel
// surfaces a hint pointing them at Settings, not blank data.

import { fetchApiKeys } from './apiKeys';

import { getSoulBaseUrl } from './soulBase';

export type WeatherIcon = 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog';

export interface WeatherCurrent {
  temp_c: number;
  feels_like_c: number;
  condition: string;
  icon: WeatherIcon;
  wind_kph?: number;
}

export interface WeatherHourly {
  ts: string;          // ISO local timestamp
  temp_c: number | null;
  condition: string;
  icon: WeatherIcon;
}

export interface WeatherDaily {
  date: string;        // YYYY-MM-DD
  hi_c: number | null;
  lo_c: number | null;
  condition: string;
  icon: WeatherIcon;
}

export interface WeatherPayload {
  location: string;
  current: WeatherCurrent;
  hourly: WeatherHourly[];
  daily:  WeatherDaily[];
}

export interface WeatherResult {
  /** False ⇒ panel renders the hint copy instead of data. */
  available: boolean;
  data?: WeatherPayload;
  /** Renderer-facing copy when `available: false`. Tells the user how
   *  to enable the feature. */
  hint?: string;
  error?: string;
}

export interface Coords { lat: number; lon: number; }

const HINT_DISABLED =
  'Enable web search (Gemini) in Settings to fetch live weather.';

export async function getWeather(coords?: Coords): Promise<WeatherResult> {
  // Strict BYOK: skip soul entirely when the user hasn't opted in,
  // saving a roundtrip and a 200-with-hint response.
  const keys = await fetchApiKeys();
  if (!keys.grounding_search_enabled || !keys.gemini_search_api_key) {
    return { available: false, hint: HINT_DISABLED };
  }

  const qs = coords
    ? `?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}`
    : '';
  let res: Response;
  try {
    res = await fetch(`${getSoulBaseUrl()}/weather${qs}`, {
      method: 'GET',
      headers: { 'X-Gemini-Key': keys.gemini_search_api_key },
    });
  } catch (err) {
    return { available: false, error: `network: ${(err as Error).message}` };
  }
  if (res.status === 404) return { available: false };
  if (!res.ok) return { available: true, error: `soul /weather ${res.status}` };
  try {
    const parsed = (await res.json()) as
      WeatherPayload | { available: false; hint?: string };
    if ('available' in parsed && parsed.available === false) {
      return { available: false, hint: parsed.hint || HINT_DISABLED };
    }
    return { available: true, data: parsed as WeatherPayload };
  } catch (err) {
    return { available: true, error: `parse: ${(err as Error).message}` };
  }
}
