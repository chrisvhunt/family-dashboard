import { DashboardCardProps } from '../../types/dashboard-cards';
import { useNews, timeAgo, isFresh } from '../../hooks/useNews';
import { NhlGameStrip } from '../NewsView';

/** Team score line plus the newest headlines from each feed. */
export function Headlines({ max = 8 }: { max?: number }) {
  const { feeds, nhl, error } = useNews();
  const now = Date.now();

  // Take turns between feeds (top, local, team, top, …) so every topic is
  // represented even when only a few headlines fit on screen.
  const perFeed = feeds.map(({ config, result }, i) =>
    (result?.items ?? []).slice(0, i === 0 ? 4 : 3).map((item) => ({ item, label: config.label })),
  );
  const rows: Array<{ item: (typeof perFeed)[number][number]['item']; label: string }> = [];
  for (let round = 0; rows.length < max && perFeed.some((f) => f.length > round); round++) {
    for (const f of perFeed) {
      if (f[round] && rows.length < max) rows.push(f[round]);
    }
  }

  return (
    <>
      {nhl && <NhlGameStrip nhl={nhl} compact />}
      {rows.length === 0 ? (
        <div className="news-empty news-empty--card">{error ?? 'Loading headlines…'}</div>
      ) : (
        <ul className="news-card-list">
          {rows.map(({ item, label }) => (
            <li key={item.link} className="news-card-item">
              <a href={item.link} target="_blank" rel="noopener noreferrer">
                <span className="news-card-title">
                  {isFresh(item.published, now) && <span className="news-new-pill">New</span>}
                  {item.title}
                </span>
                <span className="news-card-meta">
                  {label} · {timeAgo(item.published, now) || item.source}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Dashboard sidebar "Headlines" card. */
export function NewsCard({ context }: DashboardCardProps) {
  const open = context.onNewsClick;
  return (
    <section className="dash-sidebar-section news-card">
      <h3 className="dash-sidebar-heading">
        {open ? (
          <button type="button" className="news-card-heading-btn" onClick={open}>
            Headlines <span aria-hidden="true">›</span>
          </button>
        ) : (
          'Headlines'
        )}
      </h3>
      <Headlines />
    </section>
  );
}
