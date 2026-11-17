import { useState, useEffect, useCallback } from 'react';
import { googleBridge, FeedResult, NewsFeedConfig, NhlSummary, isBridgeConfigured } from '../api/google-bridge';
import { useBridgeConfig } from './useBridgeConfig';

const REFRESH_MS = 10 * 60 * 1000;
const NHL_REFRESH_MS = 5 * 60 * 1000;
const NHL_LIVE_REFRESH_MS = 60 * 1000;

export interface NewsState {
  feeds: Array<{ config: NewsFeedConfig; result: FeedResult | null }>;
  nhl: NhlSummary | null;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
  refresh: () => void;
}

// One shared snapshot so the dashboard card and the News screen don't double-fetch.
interface Snapshot {
  key: string;
  results: Record<string, FeedResult>;
  nhl: NhlSummary | null;
  newsAt: number;
  nhlAt: number;
  error: string | null;
}
let snapshot: Snapshot | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

async function load(feeds: NewsFeedConfig[], nhlTeam: string, key: string, force: boolean): Promise<void> {
  if (inflight) return inflight;
  const now = Date.now();
  const prev = snapshot && snapshot.key === key ? snapshot : null;
  const liveGame = !!prev?.nhl?.live;
  const needNews = force || !prev || now - prev.newsAt > REFRESH_MS;
  const needNhl = !!nhlTeam && (force || !prev || now - prev.nhlAt > (liveGame ? NHL_LIVE_REFRESH_MS : NHL_REFRESH_MS));
  if (!needNews && !needNhl) return;

  inflight = (async () => {
    const next: Snapshot = prev
      ? { ...prev, error: null }
      : { key, results: {}, nhl: null, newsAt: 0, nhlAt: 0, error: null };
    const [newsRes, nhlRes] = await Promise.allSettled([
      needNews && feeds.length ? googleBridge.news(feeds) : Promise.resolve(null),
      needNhl ? googleBridge.nhl(nhlTeam) : Promise.resolve(null),
    ]);
    if (newsRes.status === 'fulfilled' && newsRes.value) {
      next.results = newsRes.value;
      next.newsAt = Date.now();
    } else if (newsRes.status === 'rejected') {
      next.error = newsRes.reason instanceof Error ? newsRes.reason.message : 'Could not load news';
    }
    if (nhlRes.status === 'fulfilled' && nhlRes.value) {
      next.nhl = nhlRes.value;
      next.nhlAt = Date.now();
    }
    if (!nhlTeam) next.nhl = null;
    snapshot = next;
    notify();
  })();
  try {
    await inflight;
  } finally {
    inflight = null;
  }
}

export function useNews(): NewsState {
  const cfg = useBridgeConfig();
  const enabled = isBridgeConfigured(cfg);
  const key = JSON.stringify([cfg.url, cfg.nhlTeam, cfg.feeds.map((f) => f.url)]);
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const run = useCallback(async (force: boolean) => {
    if (!enabled) return;
    setLoading(true);
    try {
      await load(cfg.feeds, cfg.nhlTeam, key, force);
    } finally {
      setLoading(false);
    }
  }, [enabled, key, cfg.feeds, cfg.nhlTeam]);

  useEffect(() => {
    if (!enabled) return;
    run(false);
    // Check every minute; load() only hits the network when data is stale
    // (10 min for news, 5 min for scores, 1 min while a game is live).
    const interval = setInterval(() => run(false), 60 * 1000);
    return () => clearInterval(interval);
  }, [enabled, run]);

  const snap = snapshot && snapshot.key === key ? snapshot : null;
  return {
    feeds: cfg.feeds.map((config) => ({ config, result: snap?.results[config.id] ?? null })),
    nhl: snap?.nhl ?? null,
    loading,
    error: enabled ? snap?.error ?? null : 'Connect Google in Settings → Google & News to see news.',
    updatedAt: snap?.newsAt || null,
    refresh: () => {
      run(true);
    },
  };
}

/** "5m ago", "3h ago", "Mon" */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(t).toLocaleDateString(undefined, { weekday: 'short' });
}

/** Stories under an hour old get a "New" tag. */
export function isFresh(iso: string | null, now = Date.now()): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && now - t < 60 * 60 * 1000;
}
