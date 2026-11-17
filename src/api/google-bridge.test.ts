import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureSetupFromUrl,
  defaultFeeds,
  getBridgeConfig,
  googleNewsSearchUrl,
  isBridgeConfigured,
  localNewsFeed,
  saveBridgeConfig,
  topicFeed,
} from './google-bridge';
import { parseSimpleRrule, toBridgeWrite, isGoogleCalendarId } from '../hooks/useGoogleCalendar';
import { daysUntil } from '../components/cards/TasksCard';

describe('news feed helpers', () => {
  it('builds a Google News search feed limited to recent stories', () => {
    const url = googleNewsSearchUrl('"Chicago Blackhawks"', 3);
    expect(url.startsWith('https://news.google.com/rss/search?q=')).toBe(true);
    expect(decodeURIComponent(url)).toContain('"Chicago Blackhawks" when:3d');
    expect(url).toContain('ceid=US:en');
  });

  it('makes a local feed only when a city is known', () => {
    expect(localNewsFeed('', 'Iowa')).toBeNull();
    const feed = localNewsFeed('Des Moines', 'Iowa');
    expect(feed?.id).toBe('local');
    expect(feed?.label).toBe('Local · Des Moines');
    expect(decodeURIComponent(feed!.url)).toContain('"Des Moines" Iowa');
  });

  it('defaults to top stories, local news and the Blackhawks', () => {
    expect(defaultFeeds().map((f) => f.id)).toEqual(['top', 'topic-chicago-blackhawks']);
    const withCity = defaultFeeds('Des Moines', 'Iowa');
    expect(withCity.map((f) => f.label)).toEqual(['Top Stories', 'Local · Des Moines', 'Blackhawks']);
  });

  it('gives topics stable ids', () => {
    expect(topicFeed('  AI & Robotics ').id).toBe('topic-ai-robotics');
  });
});

describe('bridge config', () => {
  beforeEach(() => {
    localStorage.clear();
    saveBridgeConfig({ url: '', key: '' });
  });

  it('is not configured until both URL and key are set', () => {
    expect(isBridgeConfigured()).toBe(false);
    saveBridgeConfig({ url: 'https://script.google.com/macros/s/abc/exec' });
    expect(isBridgeConfigured()).toBe(false);
    saveBridgeConfig({ key: 'secret' });
    expect(isBridgeConfigured()).toBe(true);
    expect(JSON.parse(localStorage.getItem('beacon-google-bridge')!).key).toBe('secret');
  });

  it('picks up ?bridge=&key= from the address bar and removes them', () => {
    window.history.replaceState(null, '', '/?bridge=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2Fxyz%2Fexec&key=k123&view=1');
    captureSetupFromUrl();
    expect(getBridgeConfig().url).toBe('https://script.google.com/macros/s/xyz/exec');
    expect(getBridgeConfig().key).toBe('k123');
    expect(window.location.search).toBe('?view=1');
  });
});

describe('Google Calendar writes', () => {
  it('recognises Google calendar ids', () => {
    expect(isGoogleCalendarId('gcal:family@group.calendar.google.com')).toBe(true);
    expect(isGoogleCalendarId('calendar.home')).toBe(false);
  });

  it('parses the simple repeat rules the event form produces', () => {
    expect(parseSimpleRrule('FREQ=WEEKLY;UNTIL=20261231T235959Z')).toEqual({ freq: 'WEEKLY', until: '2026-12-31' });
    expect(parseSimpleRrule('FREQ=DAILY')).toEqual({ freq: 'DAILY', until: undefined });
    expect(parseSimpleRrule('FREQ=YEARLY')).toBeUndefined();
    expect(parseSimpleRrule(undefined)).toBeUndefined();
  });

  it('turns a timed event into absolute times using the tablet clock', () => {
    const w = toBridgeWrite('gcal:primary@example.com', {
      summary: 'Dentist',
      start_date_time: '2026-12-03T15:30:00',
      end_date_time: '2026-12-03T16:30:00',
    });
    expect(w.calendarId).toBe('primary@example.com');
    expect(w.allDay).toBe(false);
    expect(new Date(w.start!).getTime()).toBe(new Date(2026, 11, 3, 15, 30).getTime());
    expect(new Date(w.end!).getTime() - new Date(w.start!).getTime()).toBe(60 * 60 * 1000);
  });

  it('keeps all-day dates as plain dates', () => {
    const w = toBridgeWrite('gcal:x', { summary: 'Trip', start_date: '2026-12-20', end_date: '2026-12-23', rrule: 'FREQ=MONTHLY;UNTIL=20270601T235959Z' }, 'uid|1');
    expect(w).toMatchObject({ allDay: true, startDate: '2026-12-20', endDate: '2026-12-23', eventId: 'uid|1' });
    expect(w.recurrence).toEqual({ freq: 'MONTHLY', until: '2027-06-01' });
  });

  it('leaves times alone for title-only edits', () => {
    const w = toBridgeWrite('gcal:x', { summary: 'Renamed' }, 'uid|1');
    expect(w.allDay).toBeUndefined();
    expect(w.start).toBeUndefined();
  });
});

describe('task due dates', () => {
  const now = new Date(2026, 10, 16, 21, 0); // Nov 16, 9pm local
  it('counts whole days from today', () => {
    expect(daysUntil('2026-11-16', now)).toBe(0);
    expect(daysUntil('2026-11-17', now)).toBe(1);
    expect(daysUntil('2026-11-14', now)).toBe(-2);
    expect(daysUntil('2026-12-16', now)).toBe(30);
  });
});
