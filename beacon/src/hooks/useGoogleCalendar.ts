import { useState, useCallback, useMemo, useRef } from 'react';
import { CalendarEvent, CalendarInfo, CalendarColorMember, resolveCalendarColor } from '../types';
import { googleBridge, BridgeCalendar, BridgeEvent, BridgeEventWrite } from '../api/google-bridge';

/** Beacon-side calendar ids for Google calendars are prefixed so App can route writes. */
export const GCAL_PREFIX = 'gcal:';

export function isGoogleCalendarId(id: string): boolean {
  return id.startsWith(GCAL_PREFIX);
}

function toGoogleId(id: string): string {
  return id.slice(GCAL_PREFIX.length);
}

/** Same shape App passes to the HA calendar hook. */
export interface CalendarWriteData {
  summary?: string;
  start_date_time?: string;
  end_date_time?: string;
  start_date?: string;
  end_date?: string;
  description?: string;
  location?: string;
  rrule?: string;
}

/** Local wall-clock "2026-11-16T09:00:00" → absolute ISO, using the tablet's time zone. */
function localToIso(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date/time: ${local}`);
  return d.toISOString();
}

/** "FREQ=WEEKLY;UNTIL=20261231T235959Z" → { freq: 'WEEKLY', until: '2026-12-31' } */
export function parseSimpleRrule(rrule?: string): BridgeEventWrite['recurrence'] | undefined {
  if (!rrule) return undefined;
  const parts = Object.fromEntries(
    rrule.split(';').map((p) => {
      const [k, v = ''] = p.split('=');
      return [k.trim().toUpperCase(), v.trim()];
    }),
  );
  const freq = parts.FREQ as 'DAILY' | 'WEEKLY' | 'MONTHLY' | undefined;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL || '');
  return { freq, until: m ? `${m[1]}-${m[2]}-${m[3]}` : undefined };
}

export function toBridgeWrite(calendarId: string, data: CalendarWriteData, eventId?: string): BridgeEventWrite {
  const write: BridgeEventWrite = {
    calendarId: toGoogleId(calendarId),
    eventId,
    summary: data.summary,
    description: data.description,
    location: data.location,
  };
  if (data.start_date) {
    write.allDay = true;
    write.startDate = data.start_date;
    write.endDate = data.end_date || data.start_date;
  } else if (data.start_date_time && data.end_date_time) {
    write.allDay = false;
    write.start = localToIso(data.start_date_time);
    write.end = localToIso(data.end_date_time);
  }
  const recurrence = parseSimpleRrule(data.rrule);
  if (recurrence) write.recurrence = recurrence;
  return write;
}

/**
 * Google Calendar through the Apps Script bridge. Mirrors the API of
 * useCalendarEvents (the Home Assistant hook) so App can merge both.
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

  const createEvent = useCallback(async (calendarId: string, data: CalendarWriteData) => {
    await googleBridge.createEvent(toBridgeWrite(calendarId, data));
  }, []);

  const updateEvent = useCallback(async (calendarId: string, eventId: string, data: CalendarWriteData) => {
    await googleBridge.updateEvent(toBridgeWrite(calendarId, data, eventId));
  }, []);

  const deleteEvent = useCallback(async (calendarId: string, eventId: string) => {
    await googleBridge.deleteEvent(toGoogleId(calendarId), eventId);
  }, []);

  const primaryCalendarId = useMemo(() => {
    const primary = rawCalendars.find((c) => c.primary);
    return primary ? GCAL_PREFIX + primary.id : undefined;
  }, [rawCalendars]);

  return { calendars, events, error, primaryCalendarId, fetchCalendars, fetchEvents, createEvent, updateEvent, deleteEvent };
}
