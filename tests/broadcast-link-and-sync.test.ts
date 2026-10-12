import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNemoBroadcastUrl,
  isLinkableNemoMatchSlug,
  NEMO_LIVE_STREAM_ANCHOR,
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

test('Broadcast link: a SportScore slug resolves to the NEMO Sports match page with the #live-stream anchor', () => {
  assert.equal(NEMO_LIVE_STREAM_ANCHOR, 'live-stream');
  assert.equal(
    buildNemoBroadcastUrl('sao-paulo-vs-vitoria-ba'),
    'https://nemo-sports.vercel.app/matches/sao-paulo-vs-vitoria-ba#live-stream'
  );

  // A non-Egyptian SportScore fixture that is NOT in the manual bridge table still links,
  // because the slug is the identifier NEMO Sports keys its match pages by.
  const brazil = mapSportScoreMatchToRecord({
    home: 'Sao Paulo',
    away: 'Vitoria BA',
    status: 'notstarted',
    time: '2026-10-12T22:30:00Z',
    competition: 'Brasileiro Serie A',
    url: '/football/match/sao-paulo-vs-vitoria-ba/k82rekhg0vyzrep/',
  });
  assert.equal(brazil.externalIds.sportscoreSlug, 'sao-paulo-vs-vitoria-ba');
  assert.equal(brazil.nemoLink.linkType, 'direct_match');
  assert.equal(brazil.nemoLink.verified, true);
  assert.deepEqual(brazil.nemoLink.matchedBy, ['original_match_id']);
  assert.equal(
    brazil.nemoLink.url,
    'https://nemo-sports.vercel.app/matches/sao-paulo-vs-vitoria-ba#live-stream'
  );

  // Egyptian league fixture from SportScore (also in the bridge table) → same destination.
  const egy = mapSportScoreMatchToRecord({
    home: 'Zamalek SC',
    away: 'Al Ahly FC',
    home_score: '0',
    away_score: '2',
    status: 'finished',
    time: '2026-10-11T17:00:00Z',
    competition: 'Egyptian Premier League',
    url: '/football/match/zamalek-sc-vs-al-ahly-fc/l5ergph49xdlr8k/',
  });
  assert.equal(
    egy.nemoLink.url,
    'https://nemo-sports.vercel.app/matches/zamalek-sc-vs-al-ahly-fc#live-stream'
  );
  assert.ok(egy.nemoLink.matchedBy.includes('original_match_id'));
  assert.ok(egy.nemoLink.matchedBy.includes('mapping_table'));
});

test('Broadcast link: never links from a guessed/placeholder slug or a TheSportsDB-only fixture', () => {
  assert.equal(isLinkableNemoMatchSlug('zamalek-sc-vs-al-ahly-fc'), true);
  assert.equal(isLinkableNemoMatchSlug('team-4wyrn4h9jwyq86p-vs-team-dn1m1gh15xlmoep'), false);
  assert.equal(isLinkableNemoMatchSlug('single-token-without-separator'), false);
  assert.equal(isLinkableNemoMatchSlug(null), false);
  assert.equal(isLinkableNemoMatchSlug(''), false);

  const placeholder = resolveNemoSportsLink({
    sportscoreSlug: 'team-4wyrn4h9jwyq86p-vs-team-dn1m1gh15xlmoep',
    competitionCode: 'UNKNOWN',
    homeTeamId: 'team-ss-team-4wyrn4h9jwyq86p',
    awayTeamId: 'team-ss-team-dn1m1gh15xlmoep',
    cairoDate: '2026-10-12',
  });
  assert.equal(placeholder.url, null);
  assert.equal(placeholder.linkType, 'unavailable');

  // TheSportsDB-only Egyptian fixture: no SportScore slug, not bridged → no link, no fallback.
  const tsdbOnly = mapTheSportsDBEventToRecord({
    idEvent: '2561124',
    idAPIfootball: '1612253',
    strEvent: 'Pyramids vs Ceramica Cleopatra',
    idLeague: '4829',
    strLeague: 'Egyptian Premier League',
    strHomeTeam: 'Pyramids',
    strAwayTeam: 'Ceramica Cleopatra',
    strTimestamp: '2026-10-12T17:00:00Z',
    dateEvent: '2026-10-12',
    strStatus: 'NS',
  });
  assert.equal(tsdbOnly.nemoLink.url, null);
  assert.equal(tsdbOnly.nemoLink.competitionUrl, null);
  assert.equal(tsdbOnly.nemoLink.scheduleUrl, null);
});

test('Deduplication: the same fixture from SportScore and TheSportsDB is stored once and gains the broadcast link', () => {
  const tsdb = mapTheSportsDBEventToRecord({
    idEvent: '9900001',
    strEvent: 'Smouha vs Ceramica Cleopatra',
    idLeague: '4829',
    strLeague: 'Egyptian Premier League',
    strHomeTeam: 'Smouha',
    strAwayTeam: 'Ceramica Cleopatra',
    strTimestamp: '2026-10-19T14:00:00Z',
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

  const dbBefore = getGatewayDatabase();
  const preExisting = dbBefore.matches.find((m) => buildMatchDedupKey(m) === buildMatchDedupKey(ss));
  const before = dbBefore.matches.length;
  upsertMatchesInStore([tsdb]);
  upsertMatchesInStore([ss]);
  upsertMatchesInStore([ss]); // repeated sync must not duplicate
  const db = getGatewayDatabase();
  const stored = db.matches.filter((m) => buildMatchDedupKey(m) === buildMatchDedupKey(ss));
  assert.equal(stored.length, 1);
  assert.equal(db.matches.length, preExisting ? before : before + 1);
  assert.equal(stored[0].id, preExisting ? preExisting.id : tsdb.id, 'first-seen id is kept stable');
  assert.equal(stored[0].externalIds.thesportsdbEventId, '9900001');
  assert.equal(stored[0].externalIds.sportscoreSlug, 'smouha-sc-vs-ceramica-cleopatra-fc');
  assert.equal(
    stored[0].nemoLink.url,
    'https://nemo-sports.vercel.app/matches/smouha-sc-vs-ceramica-cleopatra-fc#live-stream'
  );
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
  const fresh = guardStaleLiveStatus(live);
  assert.equal(fresh.status, 'live');

  const stale = guardStaleLiveStatus({
    ...live,
    lastUpdatedAt: new Date(Date.now() - STALE_LIVE_MAX_AGE_MS - 60_000).toISOString(),
  });
  assert.equal(stale.status, 'unconfirmed');
  assert.equal(stale.liveMinute, null);
  // Score is preserved as the last known value, not invented or zeroed.
  assert.equal(stale.score.home, 1);
  assert.equal(stale.score.away, 0);
});

test('TheSportsDB endpoints follow the calendar (next/past league) instead of a hard-coded round number', () => {
  const endpoints = buildTheSportsDBEndpoints(['2026-10-11', '2026-10-12', '2026-10-13']);
  const urls = endpoints.map((e) => e.url);
  assert.ok(THESPORTSDB_FOLLOWED_LEAGUES.some((l) => l.id === '4829'), 'Egyptian Premier League is followed');
  assert.ok(urls.some((u) => u.endsWith('/eventsnextleague.php?id=4829')));
  assert.ok(urls.some((u) => u.endsWith('/eventspastleague.php?id=4829')));
  assert.ok(urls.some((u) => u.includes('eventsday.php?d=2026-10-12&s=Soccer')));
  assert.ok(!urls.some((u) => u.includes('eventsround.php')), 'no fixed round numbers');
  assert.ok(urls.every((u) => u.startsWith('https://www.thesportsdb.com/api/v1/json/3/')));
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
