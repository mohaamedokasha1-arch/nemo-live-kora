import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import MatchCard, {
  UNVERIFIED_MATCH_LINK_LABEL_AR,
  VERIFIED_MATCH_LINK_LABEL_AR,
} from '../components/MatchCard';
import {
  getVerifiedNemoMatchPageUrl,
  resolveNemoSportsLink,
  VERIFIED_NEMO_MAPPING_TABLE,
  VERIFIED_NEMO_SPORTS_ORIGIN,
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
import { migrateGatewayDatabase } from '../lib/news/migrate';
import { describeMatchesFreshness } from '../lib/freshness';
import { toCairoTimeArabic } from '../lib/cairo-time';
import type { MatchRecord } from '../lib/types';

const EXACT_MATCH_URL =
  'https://nemo-sports.vercel.app/matches/zamalek-sc-vs-al-ahly-fc#live-stream';

function zamalekVsAhlyInput(overrides: Partial<Parameters<typeof resolveNemoSportsLink>[0]> = {}) {
  return {
    thesportsdbEventId: '2561121',
    apiFootballFixtureId: '1612250',
    competitionCode: 'EGY',
    homeTeamId: 'team-zamalek',
    awayTeamId: 'team-al-ahly',
    cairoDate: '2026-10-11',
    ...overrides,
  };
}

test('Match resolver only allows exact, date-matched source identities in the verified table', () => {
  assert.equal(VERIFIED_NEMO_SPORTS_ORIGIN, 'https://nemo-sports.vercel.app');
  assert.equal(VERIFIED_NEMO_MAPPING_TABLE.filter((entry) => entry.verifiedNemoMatchSlug).length, 2);

  const verified = resolveNemoSportsLink(zamalekVsAhlyInput());
  assert.equal(verified.linkType, 'direct_match');
  assert.equal(verified.url, EXACT_MATCH_URL);
  assert.equal(verified.verified, true);
  assert.match(verified.subLabelAr, /لا نفترض توفر بث نشط/);
  assert.equal(
    getVerifiedNemoMatchPageUrl({
      ...VERIFIED_NEMO_MAPPING_TABLE[0],
      verifiedNemoMatchSlug: 'an-unverified-match',
    }),
    null
  );

  const qanalMasry = resolveNemoSportsLink({
    thesportsdbEventId: '2561120',
    apiFootballFixtureId: '1612249',
    competitionCode: 'EGY',
    homeTeamId: 'team-el-qanah',
    awayTeamId: 'team-al-masry',
    cairoDate: '2026-10-11',
  });
  assert.equal(
    qanalMasry.url,
    'https://nemo-sports.vercel.app/matches/olympic-el-qanal-vs-al-masry#live-stream'
  );

  for (const input of [
    zamalekVsAhlyInput({ cairoDate: '2026-10-12' }),
    zamalekVsAhlyInput({ homeTeamId: 'team-al-ahly', awayTeamId: 'team-zamalek' }),
    zamalekVsAhlyInput({ thesportsdbEventId: 'untrusted-id', apiFootballFixtureId: null }),
    {
      sportscoreSlug: 'zamalek-sc-vs-al-ahly-fc',
      competitionCode: 'EGY',
      homeTeamId: 'team-zamalek',
      awayTeamId: 'team-al-ahly',
      cairoDate: '2026-10-11',
    },
  ]) {
    const rejected = resolveNemoSportsLink(input);
    assert.equal(rejected.url, null);
    assert.equal(rejected.linkType, 'unavailable');
    assert.equal(rejected.verified, false);
  }

  const otherwiseMappedButUnverified = resolveNemoSportsLink({
    thesportsdbEventId: '2561124',
    apiFootballFixtureId: '1612253',
    competitionCode: 'EGY',
    homeTeamId: 'team-pyramids',
    awayTeamId: 'team-ceramica',
    cairoDate: '2026-10-12',
  });
  assert.equal(otherwiseMappedButUnverified.url, null);
});

test('MatchCard links only verified fixtures; other cards are non-clickable and hide unconfirmed times', () => {
  const verifiedMatch = mapTheSportsDBEventToRecord({
    idEvent: '2561121',
    idAPIfootball: '1612250',
    strEvent: 'Zamalek vs Al Ahly',
    idLeague: '4829',
    strLeague: 'Egyptian Premier League',
    strHomeTeam: 'Zamalek',
    strAwayTeam: 'Al Ahly',
    strTimestamp: '2026-10-11T17:00:00Z',
    dateEvent: '2026-10-11',
    strStatus: 'FT',
    intHomeScore: 0,
    intAwayScore: 2,
  });
  const verifiedHtml = renderToStaticMarkup(MatchCard({ match: verifiedMatch }));
  assert.ok(verifiedHtml.includes(`href="${EXACT_MATCH_URL}"`));
  assert.ok(verifiedHtml.includes('انتهت المباراة — لا يوجد بث موثّق حاليًا'));
  assert.ok(verifiedHtml.includes(VERIFIED_MATCH_LINK_LABEL_AR) === false);
  assert.ok(verifiedHtml.includes(toCairoTimeArabic(verifiedMatch.utcKickoff)));

  const unmatched = mapTheSportsDBEventToRecord({
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
  const unmatchedHtml = renderToStaticMarkup(MatchCard({ match: unmatched }));
  assert.match(unmatchedHtml, /^<article [^>]*kl-match-card-unlinked/);
  assert.ok(unmatchedHtml.includes(UNVERIFIED_MATCH_LINK_LABEL_AR));
  assert.ok(!unmatchedHtml.includes('href='));
  assert.ok(!unmatchedHtml.includes('nemo-sports.vercel.app'));
  assert.ok(unmatchedHtml.includes(toCairoTimeArabic(unmatched.utcKickoff)));

  const noSourceTime = mapTheSportsDBEventToRecord({
    idEvent: '9900002',
    strEvent: 'Smouha vs Ghazl El Mahalla',
    idLeague: '4829',
    strLeague: 'Egyptian Premier League',
    strHomeTeam: 'Smouha',
    strAwayTeam: 'Ghazl El Mahalla',
    dateEvent: '2026-10-19',
    strTime: '16:00:00',
    strStatus: 'NS',
  });
  const noSourceTimeHtml = renderToStaticMarkup(MatchCard({ match: noSourceTime }));
  assert.equal(noSourceTime.kickoffConfirmed, false);
  assert.ok(noSourceTimeHtml.includes('الموعد غير مؤكد'));
  assert.ok(!noSourceTimeHtml.includes('16:00'));
  assert.ok(!noSourceTimeHtml.includes('4:00'));
  assert.ok(!noSourceTimeHtml.includes('<time'));
  assert.ok(!noSourceTimeHtml.includes('href='));
});

test('Legacy kickoff migration preserves only evidence-backed times and guards unsupported status', () => {
  const db = getGatewayDatabase();
  assert.ok(db.matches.length > 0);
  assert.ok(db.matches.every((match) => typeof match.kickoffConfirmed === 'boolean'));

  const seededTheSportsDBMatch = db.matches.find(
    (match) => match.primarySource === 'thesportsdb' && match.externalIds.thesportsdbEventId
  );
  assert.ok(seededTheSportsDBMatch);
  assert.equal(seededTheSportsDBMatch.kickoffConfirmed, true);

  const rawDateOnly = mapTheSportsDBEventToRecord({
    idEvent: '9900003',
    strEvent: 'Smouha vs Ghazl El Mahalla',
    idLeague: '4829',
    strLeague: 'Egyptian Premier League',
    strHomeTeam: 'Smouha',
    strAwayTeam: 'Ghazl El Mahalla',
    dateEvent: '2026-10-19',
    strTime: '16:00:00',
    strStatus: 'NS',
  });
  const legacyRecordFields = { ...rawDateOnly };
  delete legacyRecordFields.kickoffConfirmed;
  const legacyRecord = {
    ...legacyRecordFields,
    status: 'not_started' as const,
    cairoTime: '04:00 م',
  } as MatchRecord;
  const migrated = migrateGatewayDatabase({ ...db, matches: [legacyRecord] });
  const migratedRecord = migrated.matches.find(
    (match) => match.externalIds.thesportsdbEventId === '9900003'
  );
  assert.ok(migratedRecord);
  assert.equal(migratedRecord.kickoffConfirmed, false);
  assert.equal(migratedRecord.cairoTime, 'الموعد غير مؤكد');
  assert.equal(migratedRecord.status, 'unconfirmed');
  assert.equal(migratedRecord.nemoLink.url, null);
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
  const stored = getGatewayDatabase().matches.filter(
    (match) => buildMatchDedupKey(match) === buildMatchDedupKey(ss)
  );
  assert.equal(stored.length, 1);
  assert.equal(stored[0].externalIds.thesportsdbEventId, '9900001');
  assert.equal(stored[0].externalIds.sportscoreSlug, 'smouha-sc-vs-ceramica-cleopatra-fc');
  assert.equal(stored[0].nemoLink.url, null);
  assert.equal(stored[0].nemoLink.linkType, 'unavailable');
});

test('Stale live guard: an old "live" record is not shown as live', () => {
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

  const noKickoffConfirmation = guardStaleLiveStatus({ ...live, kickoffConfirmed: false });
  assert.equal(noKickoffConfirmation.status, 'unconfirmed');
});

test('TheSportsDB endpoints: Egyptian rounds first, no baseball league, no fixed API key path', () => {
  const endpoints = buildTheSportsDBEndpoints(['2026-10-11', '2026-10-12', '2026-10-13'], {
    season: '2026-2027',
    rounds: [5, 6, 7],
  });
  const urls = endpoints.map((endpoint) => endpoint.url);
  assert.ok(THESPORTSDB_FOLLOWED_LEAGUES.some((league) => league.id === '4829'));
  assert.ok(!THESPORTSDB_FOLLOWED_LEAGUES.some((league) => league.id === '4830'));
  assert.ok(urls.some((url) => url.endsWith('/eventsround.php?id=4829&r=6&s=2026-2027')));
  assert.ok(urls.some((url) => url.endsWith('/eventsnextleague.php?id=4829')));
  assert.ok(urls.some((url) => url.endsWith('/eventspastleague.php?id=4829')));
  assert.ok(urls.some((url) => url.includes('eventsday.php?d=2026-10-12&s=Soccer')));
  assert.ok(urls.every((url) => /\/api\/v1\/json\/[^/]+\//.test(url)));
  assert.ok(urls.every((url) => !url.includes('id=4830')));
});

test('Sync bookkeeping: attempt, last success, and failure are reported honestly', () => {
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
  assert.equal(meta.lastSuccessfulMatchesSyncAt, successAt);
  assert.equal(meta.lastMatchesSyncResult?.ok, false);
  assert.match(describeMatchesFreshness(meta) || '', /تعذر تحديث المباريات/);
});
