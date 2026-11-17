/**
 * Beacon Google Bridge
 * ---------------------------------------------------------------------------
 * A tiny Google Apps Script web app that runs under YOUR Google account and
 * hands the Beacon dashboard what it needs, as JSON:
 *
 *   - Google Calendar events (view only)
 *   - Google Tasks (view only)
 *   - News feeds (RSS / Atom, fetched server-side so the browser has no CORS issues)
 *   - NHL team schedule / score (Chicago Blackhawks by default)
 *
 * VIEW ONLY: appsscript.json limits this script to read-only access to your
 * calendars and tasks, so it cannot create, change or delete anything there.
 *
 * Every request must carry the secret key that setup() creates, so only your
 * dashboard can read your calendar. See google-bridge/README.md for setup.
 */

var NEWS_CACHE_SECONDS = 600;     // 10 minutes
var NHL_CACHE_SECONDS = 300;      // 5 minutes (60s while a game is live)
var MAX_FEEDS = 10;
var MAX_ITEMS_PER_FEED = 20;
var MAX_EVENT_RANGE_DAYS = 62;

// ---------------------------------------------------------------------------
// One-time setup: run this from the Apps Script editor (Run ▶ setup).
// It creates your secret key and triggers Google's permission prompt.
// ---------------------------------------------------------------------------
function setup() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('BEACON_KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('BEACON_KEY', key);
  }
  // Touch each service once so the authorization prompt covers all of them.
  CalendarApp.getDefaultCalendar().getName();
  Tasks.Tasklists.list({ maxResults: 1 });
  UrlFetchApp.fetch('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', { muteHttpExceptions: true });

  Logger.log('Setup complete. Your Beacon key is:\n\n' + key + '\n');
  Logger.log('Next: Deploy ▶ New deployment ▶ Web app (Execute as: Me, Who has access: Anyone).');
}

/** Run this if your key is ever exposed. Then update the key on the tablet. */
function rotateKey() {
  PropertiesService.getScriptProperties().deleteProperty('BEACON_KEY');
  setup();
}

// ---------------------------------------------------------------------------
// HTTP entry points
// ---------------------------------------------------------------------------
function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad request body' });
  }
  return handle_(body);
}

function handle_(p) {
  try {
    checkKey_(p.key);
    var action = String(p.action || '');
    switch (action) {
      case 'ping':          return ok_({ timeZone: tz_(), readOnly: true });
      case 'calendars':     return ok_(listCalendars_());
      case 'events':        return ok_(listEvents_(p.start, p.end));
      case 'tasks':         return ok_(listTasks_());
      case 'news':          return ok_(getNews_(p.feeds));
      case 'nhl':           return ok_(getNhl_(p.team));
      default:              throw new Error('Unknown action: ' + action);
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function checkKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('BEACON_KEY');
  if (!expected) throw new Error('Bridge not set up yet: run setup() in the Apps Script editor.');
  if (!key || String(key) !== expected) throw new Error('Invalid key');
}

function ok_(data) { return json_({ ok: true, data: data }); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
var tzCache_ = null;
function tz_() {
  if (!tzCache_) tzCache_ = CalendarApp.getDefaultCalendar().getTimeZone() || Session.getScriptTimeZone();
  return tzCache_;
}

/** Full ISO timestamp (with Z or offset) → Date. */
function parseInstant_(s) {
  var d = new Date(String(s || ''));
  if (isNaN(d.getTime())) throw new Error('Bad time: ' + s);
  return d;
}

function fmtDay_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function fmtInstant_(d) { return Utilities.formatDate(d, tz_(), "yyyy-MM-dd'T'HH:mm:ssXXX"); }

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
function visibleCalendars_() {
  return CalendarApp.getAllCalendars().filter(function (c) {
    return !c.isHidden() && c.isSelected();
  });
}

function listCalendars_() {
  return visibleCalendars_().map(function (c) {
    return {
      id: c.getId(),
      name: c.getName(),
      color: c.getColor(),
      primary: c.isMyPrimaryCalendar(),
      canEdit: c.isOwnedByMe(),
    };
  });
}

function listEvents_(startIso, endIso) {
  var start = parseInstant_(startIso);
  var end = parseInstant_(endIso);
  if (end <= start) throw new Error('End must be after start');
  if ((end - start) / 86400000 > MAX_EVENT_RANGE_DAYS) throw new Error('Date range too large');

  var out = [];
  visibleCalendars_().forEach(function (cal) {
    var events;
    try {
      events = cal.getEvents(start, end);
    } catch (err) {
      return; // skip calendars we can't read
    }
    events.forEach(function (ev) {
      var allDay = ev.isAllDayEvent();
      out.push({
        id: ev.getId() + '|' + ev.getStartTime().getTime(),
        calendarId: cal.getId(),
        title: ev.getTitle() || '(No title)',
        start: allDay ? fmtDay_(ev.getAllDayStartDate()) : fmtInstant_(ev.getStartTime()),
        end: allDay ? fmtDay_(ev.getAllDayEndDate()) : fmtInstant_(ev.getEndTime()),
        allDay: allDay,
        description: (ev.getDescription() || '').slice(0, 2000),
        location: ev.getLocation() || '',
        recurring: ev.isRecurringEvent(),
      });
    });
  });
  out.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  return out;
}

// ---------------------------------------------------------------------------
// Google Tasks, view only (uses the "Tasks API" advanced service declared in
// appsscript.json)
// ---------------------------------------------------------------------------
function listTasks_() {
  var lists = Tasks.Tasklists.list({ maxResults: 20 }).items || [];
  var todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  var tasks = [];
  var seen = {};
  lists.forEach(function (list) {
    var open = Tasks.Tasks.list(list.id, { showCompleted: false, maxResults: 100 }).items || [];
    var doneToday = (Tasks.Tasks.list(list.id, {
      showCompleted: true,
      showHidden: true,
      completedMin: todayStart.toISOString(),
      maxResults: 100,
    }).items || []).filter(function (t) { return t.status === 'completed'; });

    open.concat(doneToday).forEach(function (t) {
      if (!t.title || !String(t.title).trim() || seen[t.id]) return;
      seen[t.id] = true;
      tasks.push({
        id: t.id,
        listId: list.id,
        title: String(t.title).trim(),
        notes: t.notes || '',
        // Google Tasks stores due dates as midnight UTC; only the date part is meaningful.
        due: t.due ? String(t.due).slice(0, 10) : null,
        status: t.status === 'completed' ? 'completed' : 'needs_action',
        completed: t.completed || null,
      });
    });
  });

  return {
    lists: lists.map(function (l) { return { id: l.id, title: l.title }; }),
    tasks: tasks,
  };
}

// ---------------------------------------------------------------------------
// News feeds (RSS 2.0 and Atom)
// ---------------------------------------------------------------------------
function getNews_(feedsParam) {
  var feeds = typeof feedsParam === 'string' ? JSON.parse(feedsParam || '[]') : (feedsParam || []);
  if (!Array.isArray(feeds)) throw new Error('feeds must be a list');
  feeds = feeds.filter(function (f) {
    return f && f.id && /^https?:\/\//i.test(String(f.url || ''));
  }).slice(0, MAX_FEEDS);

  var cache = CacheService.getScriptCache();
  var result = {};
  var toFetch = [];

  feeds.forEach(function (f) {
    var cacheKey = 'feed:' + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(f.url)));
    var hit = cache.get(cacheKey);
    if (hit) {
      result[f.id] = JSON.parse(hit);
    } else {
      toFetch.push({ feed: f, cacheKey: cacheKey });
    }
  });

  if (toFetch.length) {
    var responses = UrlFetchApp.fetchAll(toFetch.map(function (x) {
      return { url: String(x.feed.url), muteHttpExceptions: true, followRedirects: true };
    }));
    responses.forEach(function (res, i) {
      var x = toFetch[i];
      var entry = { items: [], error: null, fetchedAt: new Date().toISOString() };
      if (res.getResponseCode() === 200) {
        try {
          entry.items = parseFeed_(res.getContentText()).slice(0, MAX_ITEMS_PER_FEED);
        } catch (err) {
          entry.error = 'Could not read this feed';
        }
      } else {
        entry.error = 'Feed returned HTTP ' + res.getResponseCode();
      }
      result[x.feed.id] = entry;
      if (!entry.error) {
        var s = JSON.stringify(entry);
        if (s.length < 90000) cache.put(x.cacheKey, s, NEWS_CACHE_SECONDS);
      }
    });
  }
  return result;
}

function parseFeed_(xml) {
  var root = XmlService.parse(xml).getRootElement();
  var items = [];

  if (root.getName() === 'rss') {
    var channel = root.getChild('channel');
    var channelTitle = channel ? channel.getChildText('title') : '';
    (channel ? channel.getChildren('item') : []).forEach(function (it) {
      items.push(newsItem_(
        it.getChildText('title'),
        it.getChildText('link'),
        it.getChildText('pubDate'),
        it.getChildText('source') || channelTitle
      ));
    });
  } else if (root.getName() === 'feed') {
    var atom = XmlService.getNamespace('http://www.w3.org/2005/Atom');
    var feedTitle = root.getChildText('title', atom);
    root.getChildren('entry', atom).forEach(function (en) {
      var linkEl = en.getChild('link', atom);
      var href = linkEl && linkEl.getAttribute('href') ? linkEl.getAttribute('href').getValue() : '';
      items.push(newsItem_(
        en.getChildText('title', atom),
        href,
        en.getChildText('published', atom) || en.getChildText('updated', atom),
        feedTitle
      ));
    });
  } else {
    throw new Error('Unsupported feed format');
  }

  return items.filter(function (i) { return i.title && i.link; });
}

function newsItem_(title, link, dateText, source) {
  title = String(title || '').replace(/\s+/g, ' ').trim();
  source = String(source || '').trim();
  // Google News appends " - Source Name" to every headline; drop the duplicate.
  if (source && title.length > source.length + 3 && title.slice(-(source.length + 3)) === ' - ' + source) {
    title = title.slice(0, -(source.length + 3));
  }
  var d = dateText ? new Date(dateText) : null;
  return {
    title: title,
    link: String(link || '').trim(),
    source: source,
    published: d && !isNaN(d.getTime()) ? d.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// NHL schedule (public NHL web API)
// ---------------------------------------------------------------------------
function getNhl_(teamParam) {
  var team = String(teamParam || 'CHI').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'CHI';
  var cache = CacheService.getScriptCache();
  var cacheKey = 'nhl:' + team;
  var hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);

  var res = UrlFetchApp.fetch('https://api-web.nhle.com/v1/club-schedule-season/' + team + '/now', {
    muteHttpExceptions: true,
    followRedirects: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('NHL schedule unavailable (HTTP ' + res.getResponseCode() + ')');

  var games = (JSON.parse(res.getContentText()).games || []).map(function (g) {
    return {
      id: g.id,
      startTimeUTC: g.startTimeUTC,
      state: g.gameState,
      gameType: g.gameType,
      venue: g.venue && g.venue.default ? g.venue.default : '',
      home: nhlTeam_(g.homeTeam),
      away: nhlTeam_(g.awayTeam),
    };
  });

  var isLive = function (g) { return g.state === 'LIVE' || g.state === 'CRIT'; };
  var isDone = function (g) { return g.state === 'OFF' || g.state === 'FINAL'; };
  var isUpcoming = function (g) { return g.state === 'FUT' || g.state === 'PRE'; };

  var done = games.filter(isDone);
  var result = {
    team: team,
    live: games.filter(isLive)[0] || null,
    last: done.length ? done[done.length - 1] : null,
    next: games.filter(isUpcoming)[0] || null,
  };
  cache.put(cacheKey, JSON.stringify(result), result.live ? 60 : NHL_CACHE_SECONDS);
  return result;
}

function nhlTeam_(t) {
  t = t || {};
  var place = t.placeName && t.placeName.default ? t.placeName.default : '';
  var common = t.commonName && t.commonName.default ? t.commonName.default : '';
  return {
    abbrev: t.abbrev || '',
    name: (place + ' ' + common).trim() || t.abbrev || '',
    score: typeof t.score === 'number' ? t.score : null,
  };
}
