import { useState, useCallback, useMemo, useRef } from 'react';
import { CalendarEvent, CalendarInfo, CalendarColorMember, resolveCalendarColor } from '../types';
import { googleBridge, BridgeCalendar, BridgeEvent } from '../api/google-bridge';

/** Beacon-side calendar ids for Google calendars are prefixed so App can route writes. */
export const GCAL_PREFIX = 'gcal:';

export function isGoogleCalendarId(id: string): boolean {
  return id.startsWith(GCAL_PREFIX);
}

/**
 * Google Calendar through the Apps Script bridge, view only. Mirrors the read
 * side of useCalendarEvents (the Home Assistant hook) so App can merge both.
 */
export function useGoogleCalendar(
  enabled: boolean,
  colorOptions?: {
    calendarColors?: Record<string, string>;
    members?: CalendarColorMember[];
  },
) {
  const [rawCalendars, setRawCalendars] = useState<BridgeCalendar[]>([]);
  const [rawEvents, setRawEvents] = useState<BridgeEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const rawCalendarsRef = useRef<BridgeCalendar[]>([]);

  const calendars: CalendarInfo[] = useMemo(
    () =>
      rawCalendars.map((c, index) => {
        const id = GCAL_PREFIX + c.id;
        return {
          id,
          name: c.name,
          color: resolveCalendarColor(id, index, { ...colorOptions, defaultColor: c.color || undefined }),
        };
      }),
    [rawCalendars, colorOptions?.calendarColors, colorOptions?.members],
  );

  const events: CalendarEvent[] = useMemo(() => {
    const byId = new Map(calendars.map((c) => [c.id, c]));
    return rawEvents.map((ev) => {
      const calId = GCAL_PREFIX + ev.calendarId;
      const cal = byId.get(calId);
      return {
        id: ev.id,
        title: ev.title,
        start: ev.start,
        end: ev.end,
        allDay: ev.allDay,
        description: ev.description || undefined,
        location: ev.location || undefined,
        calendarId: calId,
        calendarName: cal?.name ?? 'Google',
        color: cal?.color ?? '#3b82f6',
        hasStableId: true,
      };
    });
  }, [rawEvents, calendars]);

  const fetchCalendars = useCallback(async () => {
    if (!enabled) return [];
    try {
      const cals = await googleBridge.calendars();
      rawCalendarsRef.current = cals;
      setRawCalendars(cals);
      setError(null);
      return cals;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Google calendars');
      return [];
    }
  }, [enabled]);

  const fetchEvents = useCallback(async (startIso: string, endIso: string) => {
    if (!enabled) return;
    try {
      if (rawCalendarsRef.current.length === 0) await fetchCalendars();
      const evs = await googleBridge.events(startIso, endIso);
      setRawEvents(evs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Google events');
    }
  }, [enabled, fetchCalendars]);

  const primaryCalendarId = useMemo(() => {
    const primary = rawCalendars.find((c) => c.primary);
    return primary ? GCAL_PREFIX + primary.id : undefined;
  }, [rawCalendars]);

  return { calendars, events, error, primaryCalendarId, fetchCalendars, fetchEvents };
}
