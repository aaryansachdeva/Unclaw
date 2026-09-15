// Soul.exe weather REST client.
//
// Soul serves weather from MET Norway (free, keyless) and geocodes the
// profile city through Open-Meteo when geolocation is unavailable. No key,
// no gate: the widget works for every user from first run (2026-09-15).


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
  'Live weather could not be reached right now.';

export async function getWeather(coords?: Coords): Promise<WeatherResult> {
  // No key, no gate (2026-09-15): soul serves this from free public
  // sources (MET Norway, Google News / BBC RSS, Yahoo chart data) and
  // caches it, so the widget works for every user from first run.

  const qs = coords
    ? `?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}`
    : '';
  let res: Response;
  try {
    res = await fetch(`${getSoulBaseUrl()}/weather${qs}`, {
      method: 'GET',
      // Bound the request so a wedged-but-listening soul can't hang the
      // widget spinner forever (chat + idle paths already do this).
      signal: AbortSignal.timeout(15000),
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
