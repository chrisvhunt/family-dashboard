import { useState } from 'react';
import { Check, X, Search, Plus, RotateCcw } from 'lucide-react';
import {
  googleBridge,
  saveBridgeConfig,
  defaultFeeds,
  localNewsFeed,
  topicFeed,
  isBridgeConfigured,
  NewsFeedConfig,
} from '../api/google-bridge';
import { searchPlaces, GeoResult } from '../api/open-meteo';
import { useBridgeConfig } from '../hooks/useBridgeConfig';

const NHL_TEAMS: Array<[string, string]> = [
  ['', 'None (hide scores)'],
  ['ANA', 'Anaheim Ducks'], ['BOS', 'Boston Bruins'], ['BUF', 'Buffalo Sabres'], ['CGY', 'Calgary Flames'],
  ['CAR', 'Carolina Hurricanes'], ['CHI', 'Chicago Blackhawks'], ['COL', 'Colorado Avalanche'],
  ['CBJ', 'Columbus Blue Jackets'], ['DAL', 'Dallas Stars'], ['DET', 'Detroit Red Wings'],
  ['EDM', 'Edmonton Oilers'], ['FLA', 'Florida Panthers'], ['LAK', 'Los Angeles Kings'], ['MIN', 'Minnesota Wild'],
  ['MTL', 'Montréal Canadiens'], ['NSH', 'Nashville Predators'], ['NJD', 'New Jersey Devils'],
  ['NYI', 'New York Islanders'], ['NYR', 'New York Rangers'], ['OTT', 'Ottawa Senators'],
  ['PHI', 'Philadelphia Flyers'], ['PIT', 'Pittsburgh Penguins'], ['SJS', 'San Jose Sharks'],
  ['SEA', 'Seattle Kraken'], ['STL', 'St. Louis Blues'], ['TBL', 'Tampa Bay Lightning'],
  ['TOR', 'Toronto Maple Leafs'], ['UTA', 'Utah Mammoth'], ['VAN', 'Vancouver Canucks'],
  ['VGK', 'Vegas Golden Knights'], ['WSH', 'Washington Capitals'], ['WPG', 'Winnipeg Jets'],
];

type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok'; timeZone: string } | { kind: 'error'; message: string };

/**
 * Google bridge connection, weather/local-news location, news feeds and team.
 * Shown on first run (GoogleSetupView) and under Settings → Google & News.
 */
export function GoogleSettingsPanel() {
  const cfg = useBridgeConfig();
  const [url, setUrl] = useState(cfg.url);
  const [key, setKey] = useState(cfg.key);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  const [placeQuery, setPlaceQuery] = useState(cfg.locationName);
  const [places, setPlaces] = useState<GeoResult[] | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [topic, setTopic] = useState('');
  const [rssLabel, setRssLabel] = useState('');
  const [rssUrl, setRssUrl] = useState('');

  const connectionDirty = url.trim() !== cfg.url || key.trim() !== cfg.key;

  const handleTestAndSave = async () => {
    const draft = { url: url.trim(), key: key.trim() };
    if (!draft.url || !draft.key) {
      setTest({ kind: 'error', message: 'Enter both the web app URL and the key.' });
      return;
    }
    setTest({ kind: 'testing' });
    try {
      const info = await googleBridge.ping(draft);
      saveBridgeConfig(draft);
      setTest({ kind: 'ok', timeZone: info.timeZone });
    } catch (err) {
      setTest({ kind: 'error', message: err instanceof Error ? err.message : 'Connection failed' });
    }
  };

  const handleSearch = async () => {
    setSearching(true);
    setPlaceError(null);
    try {
      const results = await searchPlaces(placeQuery);
      setPlaces(results);
      if (results.length === 0) setPlaceError('No matching places. Try just the city name.');
    } catch {
      setPlaceError('Place search failed. Check the tablet is online.');
    } finally {
      setSearching(false);
    }
  };

  const choosePlace = (p: GeoResult) => {
    const local = localNewsFeed(p.name, p.region);
    const localIndex = cfg.feeds.findIndex((f) => f.id === 'local');
    let feeds: NewsFeedConfig[] = cfg.feeds;
    if (local && localIndex >= 0) {
      // Point the existing local feed at the new city.
      feeds = cfg.feeds.map((f, i) => (i === localIndex ? local : f));
    } else if (local && !cfg.city) {
      // First time a city is set: add local news right after Top Stories.
      feeds = [...cfg.feeds.slice(0, 1), local, ...cfg.feeds.slice(1)];
    }
    const locationName = [p.name, p.region].filter(Boolean).join(', ');
    saveBridgeConfig({
      city: p.name,
      region: p.region,
      locationName,
      latitude: p.latitude,
      longitude: p.longitude,
      feeds,
    });
    setPlaceQuery(locationName);
    setPlaces(null);
  };

  const removeFeed = (id: string) => saveBridgeConfig({ feeds: cfg.feeds.filter((f) => f.id !== id) });

  const moveFeed = (id: string, dir: -1 | 1) => {
    const i = cfg.feeds.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cfg.feeds.length) return;
    const feeds = [...cfg.feeds];
    [feeds[i], feeds[j]] = [feeds[j], feeds[i]];
    saveBridgeConfig({ feeds });
  };

  const addTopic = () => {
    if (!topic.trim()) return;
    const feed = topicFeed(topic);
    if (!cfg.feeds.some((f) => f.id === feed.id)) saveBridgeConfig({ feeds: [...cfg.feeds, feed] });
    setTopic('');
  };

  const addRss = () => {
    const u = rssUrl.trim();
    if (!/^https?:\/\//i.test(u)) return;
    const label = rssLabel.trim() || new URL(u).hostname.replace(/^www\./, '');
    const feed = { id: `rss-${Date.now().toString(36)}`, label, url: u };
    saveBridgeConfig({ feeds: [...cfg.feeds, feed] });
    setRssLabel('');
    setRssUrl('');
  };

  return (
    <div className="google-panel">
      {/* ---- Connection ---- */}
      <div className="settings-group">
        <div className="google-panel-heading">
          Google connection
          {isBridgeConfigured(cfg) && !connectionDirty && test.kind !== 'ok' && (
            <span className="google-status google-status--ok"><Check size={14} /> Connected</span>
          )}
        </div>
        <p className="settings-row-sublabel google-panel-help">
          Paste the web app URL and key from your Beacon Google Bridge (see the setup guide). This links your Google
          Calendar, Google Tasks and news feeds.
        </p>
        <label className="google-field">
          <span className="settings-row-label">Web app URL</span>
          <input
            type="url"
            className="settings-input google-input"
            placeholder="https://script.google.com/macros/s/…/exec"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="google-field">
          <span className="settings-row-label">Key</span>
          <div className="google-key-row">
            <input
              type={showKey ? 'text' : 'password'}
              className="settings-input google-input"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="button" className="settings-btn" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        <div className="google-actions">
          <button
            type="button"
            className="settings-btn settings-btn--primary"
            onClick={handleTestAndSave}
            disabled={test.kind === 'testing'}
          >
            {test.kind === 'testing' ? 'Testing…' : 'Test & save'}
          </button>
          {test.kind === 'ok' && (
            <span className="google-status google-status--ok">
              <Check size={14} /> Connected (calendar time zone: {test.timeZone})
            </span>
          )}
          {test.kind === 'error' && (
            <span className="google-status google-status--error"><X size={14} /> {test.message}</span>
          )}
        </div>
      </div>

      {/* ---- Location ---- */}
      <div className="settings-group">
        <div className="google-panel-heading">Location</div>
        <p className="settings-row-sublabel google-panel-help">
          Used for the weather and your local news feed.
          {cfg.locationName && <> Currently: <strong>{cfg.locationName}</strong>.</>}
        </p>
        <div className="google-key-row">
          <input
            type="text"
            className="settings-input google-input"
            placeholder="City, e.g. Des Moines"
            value={placeQuery}
            onChange={(e) => setPlaceQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
          />
          <button type="button" className="settings-btn" onClick={handleSearch} disabled={searching}>
            <Search size={16} /> {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
        {placeError && <div className="google-status google-status--error">{placeError}</div>}
        {places && places.length > 0 && (
          <ul className="google-place-list">
            {places.map((p) => (
              <li key={`${p.latitude},${p.longitude}`}>
                <button type="button" className="google-place" onClick={() => choosePlace(p)}>
                  <span>{p.name}</span>
                  <span className="google-place-sub">{[p.region, p.country].filter(Boolean).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- News feeds ---- */}
      <div className="settings-group">
        <div className="google-panel-heading">News &amp; topics</div>
        <p className="settings-row-sublabel google-panel-help">
          Each feed becomes a column on the News screen. The first feed gets the most space on the dashboard.
        </p>
        <ul className="google-feed-list">
          {cfg.feeds.map((f, i) => (
            <li key={f.id} className="google-feed">
              <span className="google-feed-label">{f.label}</span>
              <span className="google-feed-actions">
                <button type="button" className="settings-btn" onClick={() => moveFeed(f.id, -1)} disabled={i === 0} aria-label={`Move ${f.label} up`}>↑</button>
                <button type="button" className="settings-btn" onClick={() => moveFeed(f.id, 1)} disabled={i === cfg.feeds.length - 1} aria-label={`Move ${f.label} down`}>↓</button>
                <button type="button" className="settings-btn settings-btn--danger" onClick={() => removeFeed(f.id)} aria-label={`Remove ${f.label}`}>
                  <X size={14} />
                </button>
              </span>
            </li>
          ))}
          {cfg.feeds.length === 0 && <li className="settings-row-sublabel">No feeds. Add a topic below.</li>}
        </ul>
        <div className="google-key-row">
          <input
            type="text"
            className="settings-input google-input"
            placeholder="Add a topic, e.g. Iowa Hawkeyes, AI, gardening"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTopic();
            }}
          />
          <button type="button" className="settings-btn" onClick={addTopic}>
            <Plus size={16} /> Add topic
          </button>
        </div>
        <details className="google-advanced">
          <summary>Add a specific RSS feed</summary>
          <div className="google-key-row">
            <input type="text" className="settings-input google-input" placeholder="Name" value={rssLabel} onChange={(e) => setRssLabel(e.target.value)} />
            <input type="url" className="settings-input google-input" placeholder="https://example.com/feed.xml" value={rssUrl} onChange={(e) => setRssUrl(e.target.value)} />
            <button type="button" className="settings-btn" onClick={addRss}>Add</button>
          </div>
        </details>
        <button
          type="button"
          className="settings-btn google-reset"
          onClick={() => saveBridgeConfig({ feeds: defaultFeeds(cfg.city, cfg.region) })}
        >
          <RotateCcw size={14} /> Restore default feeds
        </button>
      </div>

      {/* ---- Hockey ---- */}
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">NHL team scores</div>
            <div className="settings-row-sublabel">Live score, last result and next game on the dashboard</div>
          </div>
          <select
            className="form-select"
            value={cfg.nhlTeam}
            onChange={(e) => saveBridgeConfig({ nhlTeam: e.target.value })}
            style={{ maxWidth: 220 }}
          >
            {NHL_TEAMS.map(([abbr, name]) => (
              <option key={abbr || 'none'} value={abbr}>{name}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
