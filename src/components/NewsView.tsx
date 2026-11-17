import { RefreshCw, ExternalLink } from 'lucide-react';
import { useNews, timeAgo, isFresh } from '../hooks/useNews';
import type { NhlGame, NhlSummary, NewsItem } from '../api/google-bridge';

const NHL_GAME_TYPES: Record<number, string> = { 1: 'Preseason', 3: 'Playoffs' };

function gameTime(game: NhlGame): string {
  const d = new Date(game.startTimeUTC);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Tonight ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
}

function opponentLine(game: NhlGame, team: string): string {
  const home = game.home.abbrev === team;
  const opp = home ? game.away : game.home;
  return `${home ? 'vs' : '@'} ${opp.name || opp.abbrev}`;
}

function resultLine(game: NhlGame, team: string): { label: string; tone: 'win' | 'loss' | 'neutral' } {
  const us = game.home.abbrev === team ? game.home : game.away;
  const them = game.home.abbrev === team ? game.away : game.home;
  if (us.score == null || them.score == null) return { label: 'Final', tone: 'neutral' };
  const won = us.score > them.score;
  return { label: `${won ? 'W' : 'L'} ${us.score}–${them.score}`, tone: won ? 'win' : 'loss' };
}

/** Compact score / schedule line for the team (live game, last result, next game). */
export function NhlGameStrip({ nhl, compact = false }: { nhl: NhlSummary; compact?: boolean }) {
  const { team, live, last, next } = nhl;
  const ref = live ?? next ?? last;
  const ours = ref ? (ref.home.abbrev === team ? ref.home : ref.away) : null;
  // "Chicago Blackhawks" → "Blackhawks"
  const shortName = ours?.name.split(' ').slice(-1)[0] || team;

  return (
    <div className={`nhl-strip${compact ? ' nhl-strip--compact' : ''}`}>
      <span className="nhl-strip-team">🏒 {shortName}</span>
      {live ? (
        <span className="nhl-strip-item nhl-strip-item--live">
          <span className="nhl-live-dot" /> LIVE {live.away.abbrev} {live.away.score ?? 0} – {live.home.abbrev} {live.home.score ?? 0}
        </span>
      ) : (
        <>
          {last && (() => {
            const r = resultLine(last, team);
            return (
              <span className={`nhl-strip-item nhl-strip-item--${r.tone}`}>
                {r.label} {opponentLine(last, team)}
              </span>
            );
          })()}
          {next && (
            <span className="nhl-strip-item">
              Next: {opponentLine(next, team)} · {gameTime(next)}
              {NHL_GAME_TYPES[next.gameType] ? ` (${NHL_GAME_TYPES[next.gameType]})` : ''}
            </span>
          )}
          {!last && !next && <span className="nhl-strip-item">No games scheduled</span>}
        </>
      )}
    </div>
  );
}

function StoryRow({ item, now }: { item: NewsItem; now: number }) {
  return (
    <li className="news-story">
      <a href={item.link} target="_blank" rel="noopener noreferrer" className="news-story-link">
        <span className="news-story-title">
          {isFresh(item.published, now) && <span className="news-new-pill">New</span>}
          {item.title}
        </span>
        <span className="news-story-meta">
          {[item.source, timeAgo(item.published, now)].filter(Boolean).join(' · ')}
        </span>
      </a>
    </li>
  );
}

export function NewsView() {
  const { feeds, nhl, loading, error, updatedAt, refresh } = useNews();
  const now = Date.now();

  return (
    <div className="news-view">
      <header className="news-header">
        <div>
          <h1 className="news-title">News</h1>
          {updatedAt && <div className="news-updated">Updated {timeAgo(new Date(updatedAt).toISOString(), now)}</div>}
        </div>
        <button type="button" className="news-refresh" onClick={refresh} disabled={loading} aria-label="Refresh news">
          <RefreshCw size={18} className={loading ? 'news-spin' : undefined} />
          Refresh
        </button>
      </header>

      {nhl && <NhlGameStrip nhl={nhl} />}
      {error && <div className="news-error">{error}</div>}

      <div className="news-columns">
        {feeds.map(({ config, result }) => (
          <section key={config.id} className="news-column">
            <h2 className="news-column-title">{config.label}</h2>
            {!result ? (
              <div className="news-empty">{loading ? 'Loading…' : 'No stories yet'}</div>
            ) : result.error ? (
              <div className="news-empty">{result.error}</div>
            ) : result.items.length === 0 ? (
              <div className="news-empty">No recent stories</div>
            ) : (
              <ul className="news-list">
                {result.items.slice(0, 12).map((item) => (
                  <StoryRow key={item.link} item={item} now={now} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <p className="news-footnote">
        <ExternalLink size={12} /> Tap a headline to open the full story.
      </p>
    </div>
  );
}
