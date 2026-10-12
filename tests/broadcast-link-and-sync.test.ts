import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import MatchCard, { BROADCAST_CTA_LABEL_AR } from '../components/MatchCard';
import {
  NEMO_BROADCAST_PATH,
  NEMO_BROADCAST_SECTION_URL,
  resolveNemoSportsLink,
} from '../lib/nemo-resolver';
import { buildMatchDedupKey } from '../lib/match-identity';
import { mapSportScoreMatchToRecord } from '../lib/sources/sportscore';
import {
  buildTheSportsDBEndpoints,
  mapTheSportsDBEventToRecord,
  THESPORTSDB_FOLLOWED_LEAGUES,
} from '../lib/sources/thesportsdb';
import {
  getGatewayDatabase,
  guardStaleLiveStatus,
  recordMatchesSyncAttempt,
  STALE_LIVE_MAX_AGE_MS,
  upsertMatchesInStore,
} from '../lib/db/store';
import { describeMatchesFreshness } from '../lib/freshness';
import { MatchRecord } from '../lib/types';

const WATCH_URL = 'https://nemo-sports.vercel.app/watch';

test('Broadcast CTA: every match resolves to the general NEMO Sports /watch section', () => {
  assert.equal(NEMO_BROADCAST_PATH, '/watch');
  assert.equal(NEMO_BROADCAST_SECTION_URL, WATCH_URL);

  const sportscore = mapSportScoreMatchToRecord({
    home: 'Sao Paulo',
    away: 'Vitoria BA',
    status: 'notstarted',
    time: '2026-10-12T22:30:00Z',
    competition: 'Brasileiro Serie A',
    url: '/football/match/sao-paulo-vs-vitoria-ba/k82rekhg0vyzrep/',
  });
  const tsdb = mapTheSportsDBEventToRecord({
    idEvent: '2561124',
    idAPIfootball: '1612253',
    strEvent: 'Pyramids vs Ceramica Cleopatra',
    idLeague: '4829',
    strLeague: 'Egyptian Premier League',
    strHomeTeam: 'Pyramids',
    strAwayTeam: 'Ceramica Cleopatra',
    strTimestamp: '2026-10-12T17:00:00',
    dateEvent: '2026-10-12',
    strStatus: 'NS',
  });
  for (const record of [sportscore, tsdb]) {
    assert.equal(record.nemoLink.linkType, 'broadcast_section');
    assert.equal(record.nemoLink.url, WATCH_URL);
    assert.equal(record.nemoLink.competitionUrl, null);
    assert.equal(record.nemoLink.scheduleUrl, null);
  }

  // The destination is a clean URL: no fragment, no query, no per-match slug.
  const url = new URL(WATCH_URL);
  assert.equal(url.pathname, '/watch');
  assert.equal(url.hash, '');
  assert.equal(url.search, '');
  assert.ok(!WATCH_URL.includes('/matches/'));
  assert.ok(!WATCH_URL.includes('live-stream'));

  // Unknown source data, a placeholder slug and an unmapped competition all get the same CTA.
  const placeholder = resolveNemoSportsLink({
    sportscoreSlug: 'team-4wyrn4h9jwyq86p-vs-team-dn1m1gh15xlmoep',
    competitionCode: 'UNKNOWN',
    homeTeamId: 'team-ss-team-4wyrn4h9jwyq86p',
    awayTeamId: 'team-ss-team-dn1m1gh15xlmoep',
    cairoDate: '2026-10-12',
  });
  assert.equal(placeholder.url, WATCH_URL);
});

test('Broadcast CTA: MatchCard renders a /watch link on every card with the general-section label', () => {
  const base = mapTheSportsDBEventToRecord({
    idEvent: '2561124',
    strEvent: 'Pyramids vs Ceramica Cleopatra',
    idLeague: '4829',
    strLeague: 'Egyptian Premier League',
    strHomeTeam: 'Pyramids',
    strAwayTeam: 'Ceramica Cleopatra',
    strTimestamp: '2026-10-12T17:00:00',
    dateEvent: '2026-10-12',
    strStatus: 'NS',
  }) as MatchRecord;
  const confirmedHtml = renderToStaticMarkup(MatchCard({ match: base }));
  assert.match(confirmedHtml, /<a [^>]*href="https:\/\/nemo-sports\.vercel\.app\/watch"/);
  assert.ok(confirmedHtml.includes(BROADCAST_CTA_LABEL_AR));
  assert.equal(BROADCAST_CTA_LABEL_AR, 'قسم البث العام على NEMO Sports');
  assert.ok(!confirmedHtml.includes('/matches/'));
  assert.ok(!confirmedHtml.includes('#live-stream'));
  assert.ok(!confirmedHtml.includes('لا يتوفر رابط بث'));
  assert.ok(confirmedHtml.includes('17:00') || confirmedHtml.includes('5:00 PM'), 'confirmed time is shown');

  // Unconfirmed kick-off: the card still links to /watch but shows no invented clock time.
  const unconfirmed = mapTheSportsDBEventToRecord({
    idEvent: '9900002',
    strEvent: 'Smouha vs Ghazl El Mahalla',
    idLeague: '4829',
    strLeague: 'Egyptian Premier League',
    strHomeTeam: 'Smouha',
    strAwayTeam: 'Ghazl El Mahalla',
    dateEvent: '2026-10-19',
    strTime: '16:00:00',
    strStatus: 'NS',
  }) as MatchRecord;
  const unconfirmedHtml = renderToStaticMarkup(MatchCard({ match: unconfirmed }));
  assert.ok(unconfirmedHtml.includes('الموعد غير مؤكد'));
  assert.ok(!unconfirmedHtml.includes('4:00 PM'), 'the 16:00 default must never be shown');
  assert.ok(unconfirmedHtml.includes('href="https://nemo-sports.vercel.app/watch"'));
});

test('Deduplication: the same fixture from SportScore and TheSportsDB is stored once', () => {
  const tsdb = mapTheSportsDBEventToRecord({
    idEvent: '9900001',
    strEvent: 'Smouha vs Ceramica Cleopatra',
    idLeague: '4829',
    strLeague: 'Egyptian Premier League',
    strHomeTeam: 'Smouha',
    strAwayTeam: 'Ceramica Cleopatra',
    strTimestamp: '2026-10-19T14:00:00',
    dateEvent: '2026-10-19',
    strStatus: 'NS',
  });
  const ss = mapSportScoreMatchToRecord({
    home: 'Smouha SC',
    away: 'Ceramica Cleopatra FC',
    status: 'notstarted',
    time: '2026-10-19T14:00:00Z',
    competition: 'Egyptian Premier League',
    url: '/football/match/smouha-sc-vs-ceramica-cleopatra-fc/zz11yy22xx33/',
  });
  assert.notEqual(tsdb.id, ss.id, 'provider ids differ');
  assert.equal(buildMatchDedupKey(tsdb), buildMatchDedupKey(ss), 'same competition/date/teams');

  upsertMatchesInStore([tsdb]);
  upsertMatchesInStore([ss]);
  upsertMatchesInStore([ss]); // repeated sync must not duplicate
  const stored = getGatewayDatabase().matches.filter((m) => buildMatchDedupKey(m) === buildMatchDedupKey(ss));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].externalIds.thesportsdbEventId, '9900001');
  assert.equal(stored[0].externalIds.sportscoreSlug, 'smouha-sc-vs-ceramica-cleopatra-fc');
  assert.equal(stored[0].nemoLink.url, WATCH_URL);
});

test('Stale live guard: a "live" record older than the freshness window is shown as unconfirmed, never as live', () => {
  const live = mapSportScoreMatchToRecord({
    home: 'Pyramids FC',
    away: 'Enppi',
    home_score: '1',
    away_score: '0',
    status: 'live',
    time: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    competition: 'Egyptian Premier League',
    url: '/football/match/pyramids-fc-vs-enppi/abc123def456/',
  });
  assert.equal(live.status, 'live');
  assert.equal(guardStaleLiveStatus(live).status, 'live');

  const stale = guardStaleLiveStatus({
    ...live,
    lastUpdatedAt: new Date(Date.now() - STALE_LIVE_MAX_AGE_MS - 60_000).toISOString(),
  });
  assert.equal(stale.status, 'unconfirmed');
  assert.equal(stale.liveMinute, null);
  assert.equal(stale.score.home, 1, 'last known score is kept, not zeroed');
  assert.equal(stale.score.away, 0);
});

test('TheSportsDB endpoints: Egyptian rounds first, no baseball league, no fixed API key path', () => {
  const endpoints = buildTheSportsDBEndpoints(['2026-10-11', '2026-10-12', '2026-10-13'], {
    season: '2026-2027',
    rounds: [5, 6, 7],
  });
  const urls = endpoints.map((e) => e.url);
  assert.ok(THESPORTSDB_FOLLOWED_LEAGUES.some((l) => l.id === '4829'), 'Egyptian Premier League is followed');
  assert.ok(!THESPORTSDB_FOLLOWED_LEAGUES.some((l) => l.id === '4830'), 'league 4830 (KBO baseball) is not followed');
  assert.ok(urls.some((u) => u.endsWith('/eventsround.php?id=4829&r=6&s=2026-2027')));
  assert.ok(urls.some((u) => u.endsWith('/eventsnextleague.php?id=4829')));
  assert.ok(urls.some((u) => u.endsWith('/eventspastleague.php?id=4829')));
  assert.ok(urls.some((u) => u.includes('eventsday.php?d=2026-10-12&s=Soccer')));
  assert.ok(urls.every((u) => /\/api\/v1\/json\/[^/]+\//.test(u)));
  assert.ok(urls.every((u) => !u.includes('id=4830')));
});

test('Sync bookkeeping: last attempt, last success and failure outcome are recorded and described honestly', () => {
  recordMatchesSyncAttempt({
    ok: true,
    trigger: 'test',
    messageAr: 'ok',
    matchesFetched: 12,
    sourcesOk: ['sportscore', 'thesportsdb'],
    sourcesFailed: [],
  });
  let meta = getGatewayDatabase().meta;
  assert.ok(meta.lastMatchesSyncAttemptAt);
  assert.equal(meta.lastSuccessfulMatchesSyncAt, meta.lastMatchesSyncAttemptAt);
  assert.match(describeMatchesFreshness(meta) || '', /آخر تحديث للمباريات من المصادر/);

  const successAt = meta.lastSuccessfulMatchesSyncAt;
  recordMatchesSyncAttempt({
    ok: false,
    trigger: 'test',
    messageAr: 'failed',
    matchesFetched: 0,
    sourcesOk: [],
    sourcesFailed: ['sportscore', 'thesportsdb'],
  });
  meta = getGatewayDatabase().meta;
  assert.equal(meta.lastSuccessfulMatchesSyncAt, successAt, 'failure does not overwrite last success');
  assert.equal(meta.lastMatchesSyncResult?.ok, false);
  assert.match(describeMatchesFreshness(meta) || '', /تعذر تحديث المباريات/);
});
