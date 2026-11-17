/**
 * Client for the Beacon Google Bridge (google-bridge/Code.gs), a small Google
 * Apps Script web app that serves Google Calendar, Google Tasks, news feeds
 * and NHL scores to the dashboard without Home Assistant. Google data is
 * view only: the bridge has read-only permission and no write actions.
 *
 * Connection details live in this browser's localStorage (the tablet), so
 * nothing about your Google account is baked into the published site.
 */

export interface NewsFeedConfig {
  id: string;
  label: string;
  url: string;
}

export interface BridgeConfig {
  /** Apps Script web app URL (ends in /exec). */
  url: string;
  /** Secret key printed by setup() in the Apps Script editor. */
  key: string;
  /** Location for weather + local news, e.g. "Des Moines, Iowa". */
  locationName: string;
  city: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  /** NHL team abbreviation for the score card ('' hides it). */
  nhlTeam: string;
  feeds: NewsFeedConfig[];
  /** True once the first-run setup screen has been finished or skipped. */
  setupDone: boolean;
}

const STORAGE_KEY = 'beacon-google-bridge';
export const BRIDGE_CHANGED_EVENT = 'beacon-google-bridge-changed';

export const TOP_US_FEED_URL = 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';

/** Google News search feed for any topic, limited to recent stories. */
export function googleNewsSearchUrl(query: string, days = 2): string {
  const q = `${query.trim()} when:${days}d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

export function localNewsFeed(city: string, region: string): NewsFeedConfig | null {
  if (!city.trim()) return null;
  const query = region.trim() ? `"${city.trim()}" ${region.trim()}` : `"${city.trim()}"`;
  return { id: 'local', label: `Local · ${city.trim()}`, url: googleNewsSearchUrl(query, 2) };
}

export function topicFeed(topic: string): NewsFeedConfig {
  const clean = topic.trim();
  const id = 'topic-' + clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { id, label: clean, url: googleNewsSearchUrl(`"${clean}"`, 3) };
}

export function defaultFeeds(city = '', region = ''): NewsFeedConfig[] {
  const feeds: NewsFeedConfig[] = [{ id: 'top', label: 'Top Stories', url: TOP_US_FEED_URL }];
  const local = localNewsFeed(city, region);
  if (local) feeds.push(local);
  feeds.push({ ...topicFeed('Chicago Blackhawks'), label: 'Blackhawks' });
  return feeds;
}

const DEFAULT_CONFIG: BridgeConfig = {
  url: '',
  key: '',
  locationName: '',
  city: '',
  region: '',
  latitude: null,
  longitude: null,
  nhlTeam: 'CHI',
  feeds: defaultFeeds(),
  setupDone: false,
};

let cached: BridgeConfig | null = null;

export function getBridgeConfig(): BridgeConfig {
  if (cached) return cached;
  let stored: Partial<BridgeConfig> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<BridgeConfig>;
  } catch {
    /* storage unavailable or corrupt — fall back to defaults */
  }
  cached = {
    ...DEFAULT_CONFIG,
    ...stored,
    feeds: Array.isArray(stored.feeds) ? stored.feeds : DEFAULT_CONFIG.feeds,
  };
  return cached;
}

export function saveBridgeConfig(patch: Partial<BridgeConfig>): BridgeConfig {
  const next = { ...getBridgeConfig(), ...patch };
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore — config still applies for this session */
  }
  window.dispatchEvent(new Event(BRIDGE_CHANGED_EVENT));
  return next;
}

export function isBridgeConfigured(cfg: BridgeConfig = getBridgeConfig()): boolean {
  return !!cfg.url && !!cfg.key;
}

export function hasWeatherLocation(cfg: BridgeConfig = getBridgeConfig()): boolean {
  return cfg.latitude != null && cfg.longitude != null;
}

/**
 * Lets you set up the tablet by opening one link instead of typing a long URL:
 *   https://you.github.io/beacon/?bridge=<web app url>&key=<key>
 * The values are saved locally and removed from the address bar.
 */
export function captureSetupFromUrl(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('bridge');
    const key = params.get('key');
    if (!url || !key) return;
    saveBridgeConfig({ url: url.trim(), key: key.trim() });
    params.delete('bridge');
    params.delete('key');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
  } catch {
    /* ignore malformed URLs */
  }
}

// ---------------------------------------------------------------------------
// Wire types (must match google-bridge/Code.gs)
// ---------------------------------------------------------------------------

export interface BridgeCalendar {
  id: string;
  name: string;
  color: string;
  primary: boolean;
  canEdit: boolean;
}

export interface BridgeEvent {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description: string;
  location: string;
  recurring: boolean;
}

export interface BridgeTaskList {
  id: string;
  title: string;
}

export interface BridgeTask {
  id: string;
  listId: string;
  title: string;
  notes: string;
  due: string | null;
  status: 'needs_action' | 'completed';
  completed: string | null;
}

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  published: string | null;
}

export interface FeedResult {
  items: NewsItem[];
  error: string | null;
  fetchedAt?: string;
}

export interface NhlTeamInfo {
  abbrev: string;
  name: string;
  score: number | null;
}

export interface NhlGame {
  id: number;
  startTimeUTC: string;
  state: string;
  gameType: number;
  venue: string;
  home: NhlTeamInfo;
  away: NhlTeamInfo;
}

export interface NhlSummary {
  team: string;
  live: NhlGame | null;
  last: NhlGame | null;
  next: NhlGame | null;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

interface BridgeEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function requireConfig(cfg?: Pick<BridgeConfig, 'url' | 'key'>): Pick<BridgeConfig, 'url' | 'key'> {
  const c = cfg ?? getBridgeConfig();
  if (!c.url || !c.key) throw new BridgeError('Google is not connected yet. Add your bridge URL and key in Settings.');
  return c;
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) throw new BridgeError(`Google bridge error (HTTP ${res.status}).`);
  let body: BridgeEnvelope<T>;
  try {
    body = (await res.json()) as BridgeEnvelope<T>;
  } catch {
    throw new BridgeError(
      'The bridge sent back something unexpected. Check that the URL ends in /exec and the web app access is "Anyone".',
    );
  }
  if (!body.ok) throw new BridgeError(body.error || 'Google bridge error.');
  return body.data as T;
}

async function bridgeGet<T>(
  action: string,
  params: Record<string, string> = {},
  cfg?: Pick<BridgeConfig, 'url' | 'key'>,
): Promise<T> {
  const c = requireConfig(cfg);
  let url: URL;
  try {
    url = new URL(c.url);
  } catch {
    throw new BridgeError('The bridge URL is not a valid web address.');
  }
  url.searchParams.set('action', action);
  url.searchParams.set('key', c.key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  } catch {
    throw new BridgeError('Could not reach the Google bridge. Check the tablet is online and the URL is right.');
  }
  return unwrap<T>(res);
}

async function bridgePost<T>(action: string, body: object): Promise<T> {
  const c = requireConfig();
  let res: Response;
  try {
    // text/plain keeps this a "simple" request (no CORS preflight, which
    // Apps Script web apps can't answer).
    res = await fetch(c.url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, action, key: c.key }),
    });
  } catch {
    throw new BridgeError('Could not reach the Google bridge. Check the tablet is online.');
  }
  return unwrap<T>(res);
}

/** The bridge is view only: Google Calendar and Google Tasks can't be changed from the dashboard. */
export const GOOGLE_READ_ONLY_MESSAGE =
  'Google Calendar and Google Tasks are view-only on this dashboard. Make changes in the Google apps on your phone or computer.';

export const googleBridge = {
  ping: (cfg?: Pick<BridgeConfig, 'url' | 'key'>) => bridgeGet<{ timeZone: string; readOnly?: boolean }>('ping', {}, cfg),
  calendars: () => bridgeGet<BridgeCalendar[]>('calendars'),
  events: (startIso: string, endIso: string) => bridgeGet<BridgeEvent[]>('events', { start: startIso, end: endIso }),
  tasks: () => bridgeGet<{ lists: BridgeTaskList[]; tasks: BridgeTask[] }>('tasks'),
  news: (feeds: NewsFeedConfig[]) =>
    bridgePost<Record<string, FeedResult>>('news', { feeds: feeds.map((f) => ({ id: f.id, url: f.url })) }),
  nhl: (team: string) => bridgeGet<NhlSummary>('nhl', { team }),
};
