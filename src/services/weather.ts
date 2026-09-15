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

/** One match from the place search. */
export interface PlaceMatch {
  /** Geocoder id, stable for the same place. */
  id: string;
  name: string;
  /** Admin area and country, e.g. "Ontario, Canada". */
  region: string;
  lat: number;
  lon: number;
}

export async function getWeather(
  coords?: Coords,
  opts: { name?: string; primary?: boolean } = {},
): Promise<WeatherResult> {
  // No key, no gate (2026-09-15): soul serves this from free public
  // sources (MET Norway, Google News / BBC RSS, Yahoo chart data) and
  // caches it, so the widget works for every user from first run.

  // A place from the user's list passes its own name (soul skips the
  // reverse geocode) and whether it is the first one, whose forecast the
  // chat tier reads from soul's cache.
  const params = new URLSearchParams();
  if (coords) {
    params.set('lat', String(coords.lat));
    params.set('lon', String(coords.lon));
  }
  if (opts.name) params.set('name', opts.name);
  if (opts.primary !== undefined) params.set('primary', opts.primary ? 'true' : 'false');
  const qs = params.toString() ? `?${params.toString()}` : '';
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

/** Place search for the weather glance's add field. null = unreachable
 *  (geocoder down, older soul), [] = no matches. */
export async function searchPlaces(q: string, signal?: AbortSignal): Promise<PlaceMatch[] | null> {
  const data = await soulSearch<{ places?: PlaceMatch[] }>(`/weather/places?q=${encodeURIComponent(q)}`, signal);
  if (data == null) return null;
  return Array.isArray(data.places) ? data.places : [];
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
