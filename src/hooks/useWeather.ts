import { useState, useEffect, useCallback } from 'react';
import { HomeAssistantClient } from '../api/homeassistant';
import { WeatherData } from '../types';
import { getConfig } from '../config';
import { haFetch, hasToken } from '../api/ha-rest';
import { getOpenMeteoWeather } from '../api/open-meteo';
import { useBridgeConfig } from './useBridgeConfig';

const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes

export function useWeather(getClient: () => HomeAssistantClient | null) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { latitude, longitude } = useBridgeConfig();

  const fetchWeather = useCallback(async () => {
    const client = getClient();
    const configEntity = getConfig().weather_entity;

    // No Home Assistant: use Open-Meteo for the location saved in settings.
    if (!client?.isConnected && !hasToken()) {
      if (latitude == null || longitude == null) return;
      try {
        const om = await getOpenMeteoWeather();
        if (!om) return;
        setWeather({
          temperature: om.current.temperature,
          temperatureUnit: om.current.temperatureUnit,
          condition: om.current.condition,
          humidity: om.current.humidity,
          windSpeed: om.current.windSpeed,
          forecast: om.daily.map((d) => ({
            date: d.datetime,
            condition: d.condition,
            tempHigh: d.temperature,
            tempLow: d.templow,
          })),
        });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch weather');
      }
      return;
    }

    // Try WebSocket client first
    if (client?.isConnected) {
      try {
        const data = await client.getWeather(configEntity);
        setWeather(data);
        setError(null);
        return;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch weather');
      }
    }

    // Fall back to REST API (proxy mode)
    if (hasToken()) {
      try {
        // Try the configured entity first, then auto-discover
        let entity = null;

        if (configEntity) {
          try {
            entity = await haFetch(`/api/states/${configEntity}`) as {
              entity_id: string;
              state: string;
              attributes: Record<string, unknown>;
            };
          } catch { /* entity doesn't exist, try discovery */ }
        }

        // Auto-discover first weather entity if configured one doesn't exist
        if (!entity) {
          const states = await haFetch('/api/states') as Array<{
            entity_id: string;
            state: string;
            attributes: Record<string, unknown>;
          }>;
          entity = states.find(s => s.entity_id.startsWith('weather.'));
        }

        if (entity) {
          const attrs = entity.attributes;
          setWeather({
            temperature: (attrs.temperature as number) ?? 0,
            temperatureUnit: (attrs.temperature_unit as string) ?? '°F',
            condition: entity.state,
            humidity: attrs.humidity as number | undefined,
            windSpeed: attrs.wind_speed as number | undefined,
            forecast: [], // forecast requires a separate service call
          });
          setError(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch weather');
      }
    }
  }, [getClient, latitude, longitude]);

  useEffect(() => {
    fetchWeather();
    const interval = setInterval(fetchWeather, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchWeather]);

  return { weather, error, refresh: fetchWeather };
}
