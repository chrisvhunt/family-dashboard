import { describe, it, expect } from 'vitest';
import { parseOpenMeteo, wmoToCondition } from './open-meteo';
import { timeAgo, isFresh } from '../hooks/useNews';

describe('wmoToCondition', () => {
  it('maps WMO codes onto Home Assistant condition names', () => {
    expect(wmoToCondition(0)).toBe('sunny');
    expect(wmoToCondition(0, false)).toBe('clear-night');
    expect(wmoToCondition(2)).toBe('partlycloudy');
    expect(wmoToCondition(3)).toBe('cloudy');
    expect(wmoToCondition(45)).toBe('fog');
    expect(wmoToCondition(53)).toBe('rainy');
    expect(wmoToCondition(65)).toBe('pouring');
    expect(wmoToCondition(67)).toBe('snowy-rainy');
    expect(wmoToCondition(73)).toBe('snowy');
    expect(wmoToCondition(86)).toBe('snowy');
    expect(wmoToCondition(95)).toBe('lightning-rainy');
  });
});

describe('parseOpenMeteo', () => {
  it('shapes current, daily and hourly data like Home Assistant', () => {
    const w = parseOpenMeteo({
      current: {
        temperature_2m: 38.6,
        relative_humidity_2m: 71,
        apparent_temperature: 31.2,
        weather_code: 3,
        wind_speed_10m: 12.4,
        wind_direction_10m: 300,
        surface_pressure: 1012.3,
        is_day: 1,
      },
      current_units: { temperature_2m: '°F' },
      daily: {
        time: ['2026-11-16', '2026-11-17'],
        weather_code: [3, 71],
        temperature_2m_max: [41.4, 35.9],
        temperature_2m_min: [29.5, 24.1],
        precipitation_probability_max: [10, 80],
      },
      hourly: {
        time: ['2026-11-16T21:00', '2026-11-16T22:00'],
        weather_code: [0, 1],
        temperature_2m: [33.3, 32.6],
        precipitation_probability: [0, 5],
        relative_humidity_2m: [70, 72],
        wind_speed_10m: [9.8, 8.1],
        is_day: [0, 0],
      },
    });
    expect(w.current).toMatchObject({ condition: 'cloudy', temperature: 39, temperatureUnit: '°F', feelsLike: 31, humidity: 71 });
    expect(w.daily[1]).toEqual({ datetime: '2026-11-17', condition: 'snowy', temperature: 36, templow: 24, precipitation_probability: 80 });
    expect(w.hourly[0]).toMatchObject({ datetime: '2026-11-16T21:00', condition: 'clear-night', temperature: 33 });
  });
});

describe('news time labels', () => {
  const now = new Date('2026-11-16T20:00:00Z').getTime();
  it('formats recency', () => {
    expect(timeAgo('2026-11-16T19:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-11-16T19:35:00Z', now)).toBe('25m ago');
    expect(timeAgo('2026-11-16T15:00:00Z', now)).toBe('5h ago');
    expect(timeAgo(null, now)).toBe('');
  });
  it('flags stories under an hour old', () => {
    expect(isFresh('2026-11-16T19:10:00Z', now)).toBe(true);
    expect(isFresh('2026-11-16T18:10:00Z', now)).toBe(false);
  });
});
