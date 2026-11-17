/**
 * Weather from Open-Meteo (https://open-meteo.com): free, no account or API
 * key, and callable straight from the browser. Used whenever Beacon isn't
 * connected to Home Assistant. Output is shaped like Home Assistant's weather
 * data so the existing weather UI works unchanged.
 */
import { getBridgeConfig } from './google-bridge';

export interface OmCurrent {
  condition: string;
  temperature: number;
  temperatureUnit: string;
  humidity?: number;
  windSpeed?: number;
  windBearing?: number;
  pressure?: number;
  feelsLike?: number;
}

export interface OmDaily {
  datetime: string; // yyyy-MM-dd
  condition: string;
  temperature: number; // high
  templow: number;
  precipitation_probability?: number;
}

export interface OmHourly {
  datetime: string; // local, e.g. 2026-11-16T14:00
  condition: string;
  temperature: number;
  humidity?: number;
  wind_speed?: number;
  precipitation_probability?: number;
}

export interface OmWeather {
  current: OmCurrent;
  daily: OmDaily[];
  hourly: OmHourly[];
  fetchedAt: number;
}

export interface GeoResult {
  name: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
}

/** WMO weather code → Home Assistant condition name (drives icons + labels). */
export function wmoToCondition(code: number, isDay = true): string {
  if (code === 0) return isDay ? 'sunny' : 'clear-night';
  if (code === 1 || code === 2) return isDay ? 'partlycloudy' : 'clear-night';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'rainy';
  if (code === 61 || code === 63 || code === 80 || code === 81) return 'rainy';
  if (code === 65 || code === 82) return 'pouring';
  if (code === 66 || code === 67) return 'snowy-rainy';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowy';
  if (code >= 95) return 'lightning-rainy';
  return 'cloudy';
}

const TTL_MS = 10 * 60 * 1000;
let cache: { key: string; data: OmWeather } | null = null;
let inflight: { key: string; promise: Promise<OmWeather> } | null = null;

interface OmResponse {
  current?: Record<string, number>;
  current_units?: Record<string, string>;
  daily?: Record<string, Array<number | string>>;
  hourly?: Record<string, Array<number | string>>;
}

function buildUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,relative_humidity_2m,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    forecast_days: '7',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export function parseOpenMeteo(json: OmResponse): OmWeather {
  const c = json.current ?? {};
  const unit = json.current_units?.temperature_2m ?? '°F';
  const current: OmCurrent = {
    condition: wmoToCondition(Number(c.weather_code), c.is_day !== 0),
    temperature: Math.round(Number(c.temperature_2m)),
    temperatureUnit: unit,
    humidity: c.relative_humidity_2m != null ? Math.round(c.relative_humidity_2m) : undefined,
    windSpeed: c.wind_speed_10m != null ? Math.round(c.wind_speed_10m) : undefined,
    windBearing: c.wind_direction_10m,
    pressure: c.surface_pressure != null ? Math.round(c.surface_pressure) : undefined,
    feelsLike: c.apparent_temperature != null ? Math.round(c.apparent_temperature) : undefined,
  };

  const d = json.daily ?? {};
  const dTimes = (d.time ?? []) as string[];
  const daily: OmDaily[] = dTimes.map((t, i) => ({
    datetime: t,
    condition: wmoToCondition(Number(d.weather_code?.[i])),
    temperature: Math.round(Number(d.temperature_2m_max?.[i])),
    templow: Math.round(Number(d.temperature_2m_min?.[i])),
    precipitation_probability: d.precipitation_probability_max?.[i] != null
      ? Number(d.precipitation_probability_max[i])
      : undefined,
  }));

  const h = json.hourly ?? {};
  const hTimes = (h.time ?? []) as string[];
  const hourly: OmHourly[] = hTimes.map((t, i) => ({
    datetime: t,
    condition: wmoToCondition(Number(h.weather_code?.[i]), Number(h.is_day?.[i]) !== 0),
    temperature: Math.round(Number(h.temperature_2m?.[i])),
    humidity: h.relative_humidity_2m?.[i] != null ? Number(h.relative_humidity_2m[i]) : undefined,
    wind_speed: h.wind_speed_10m?.[i] != null ? Math.round(Number(h.wind_speed_10m[i])) : undefined,
    precipitation_probability: h.precipitation_probability?.[i] != null
      ? Number(h.precipitation_probability[i])
      : undefined,
  }));

  return { current, daily, hourly, fetchedAt: Date.now() };
}

/**
 * Weather for the location saved in Google & News settings. Shared cache, so
 * the dashboard, calendar and weather screen make one request between them.
 * Returns null when no location has been set.
 */
export async function getOpenMeteoWeather(force = false): Promise<OmWeather | null> {
  const { latitude, longitude } = getBridgeConfig();
  if (latitude == null || longitude == null) return null;
  const key = `${latitude},${longitude}`;

  if (!force && cache && cache.key === key && Date.now() - cache.data.fetchedAt < TTL_MS) return cache.data;
  if (inflight && inflight.key === key) return inflight.promise;

  const promise = (async () => {
    const res = await fetch(buildUrl(latitude, longitude));
    if (!res.ok) throw new Error(`Weather service error (HTTP ${res.status})`);
    const data = parseOpenMeteo((await res.json()) as OmResponse);
    cache = { key, data };
    return data;
  })();
  inflight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inflight?.promise === promise) inflight = null;
  }
}

/** City search for the settings screen (Open-Meteo geocoding, US-first). */
export async function searchPlaces(query: string): Promise<GeoResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // "Des Moines, IA" → search the city part; the region narrows results below.
  const [cityPart, regionPart = ''] = q.split(',').map((s) => s.trim());
  const params = new URLSearchParams({ name: cityPart, count: '10', language: 'en', format: 'json' });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!res.ok) throw new Error('Place search failed');
  const json = (await res.json()) as {
    results?: Array<{ name: string; admin1?: string; country?: string; country_code?: string; latitude: number; longitude: number }>;
  };
  const regionLower = regionPart.toLowerCase();
  const all = json.results ?? [];
  const matching = regionLower
    ? all.filter((r) => (r.admin1 ?? '').toLowerCase().startsWith(regionLower) || (r.country ?? '').toLowerCase().startsWith(regionLower))
    : all;
  // Abbreviations like "IA" won't match "Iowa"; fall back to every result.
  return (matching.length ? matching : all)
    .slice()
    .sort((a, b) => Number(b.country_code === 'US') - Number(a.country_code === 'US'))
    .map((r) => ({
      name: r.name,
      region: r.admin1 ?? '',
      country: r.country ?? '',
      latitude: r.latitude,
      longitude: r.longitude,
    }));
}
