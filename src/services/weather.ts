// Soul.exe weather REST client.
//
// Soul.exe (the local Python server on :8765) proxies a tiny subset of
// Open-Meteo and normalizes it so the renderer doesn't care about the
// upstream provider. The `available` flag mirrors the reminders pattern:
// if soul is older than the build that added /weather, the call returns
// `available: false` and the panel hides itself silently.

const SOUL_URL = 'http://127.0.0.1:8765';

export type WeatherIcon = 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog';

export interface WeatherCurrent {
  temp_c: number;
  feels_like_c: number;
  condition: string;
  icon: WeatherIcon;
  wind_kph?: number;
}

export interface WeatherHourly {
  ts: string;          // ISO local timestamp from Open-Meteo
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
  /** True only when soul exposes /weather. False ⇒ panel hides. */
  available: boolean;
  data?: WeatherPayload;
  error?: string;
}

export interface Coords { lat: number; lon: number; }

export async function getWeather(coords?: Coords): Promise<WeatherResult> {
  const qs = coords
    ? `?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}`
    : '';
  let res: Response;
  try {
    res = await fetch(`${SOUL_URL}/weather${qs}`, { method: 'GET' });
  } catch (err) {
    return { available: false, error: `network: ${(err as Error).message}` };
  }
  if (res.status === 404) return { available: false };
  if (!res.ok) return { available: true, error: `soul /weather ${res.status}` };
  try {
    const data = (await res.json()) as WeatherPayload;
    return { available: true, data };
  } catch (err) {
    return { available: true, error: `parse: ${(err as Error).message}` };
  }
}
