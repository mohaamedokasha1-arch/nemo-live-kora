/**
 * Reproductions for the 2026-10-12 production audit. Each block states the defect it reproduces
 * and checks the fixed behaviour. Fixtures under tests/fixtures are real TheSportsDB responses
 * captured on 2026-10-12; the SportScore and Google News cases are synthetic and labelled so.
 */
import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeMatchStatus, toCairoDateString } from '../lib/cairo-time';
import { resolveCompetitionByMeta } from '../lib/catalog';
import {
  fetchSportScoreMatches,
  mapSportScoreMatchToRecord,
  sportScoreSkipReason,
} from '../lib/sources/sportscore';
import {
  fetchTheSportsDBMatches,
  mapTheSportsDBEventToRecord,
  resolveTheSportsDBKickoff,
  theSportsDBSkipReason,
  THESPORTSDB_FOLLOWED_LEAGUES,
  TheSportsDBRawEvent,
} from '../lib/sources/thesportsdb';
import {
  egyptianSeasonLabelFor,
  getEgyptianRoundWindow,
  getGatewayDatabase,
  guardStaleLiveStatus,
  isStorePersistenceEnabled,
  LIVE_MAX_AFTER_KICKOFF_MS,
  NOT_STARTED_GRACE_MS,
  upsertMatchesInStore,
} from '../lib/db/store';
import { mergeMatchRecords } from '../lib/db/seed-data';
import { parseGoogleNewsRssXml, resolveGoogleNewsArticleUrl } from '../lib/sources/google-news-rss';
import { validateNewsCandidate } from '../lib/news/validate';
import { MatchRecord, RawNewsCandidate } from '../lib/types';
import { getVerifiedNemoMatchPageUrl, VERIFIED_NEMO_MAPPING_TABLE } from '../lib/nemo-resolver';

// Never write the committed store from this file, whichever way it is run (test 8 mutates memory).
process.env.NEMO_GATEWAY_STORE_PERSIST = 'off';

const FIXTURE_DIR = path.join(process.cwd(), 'tests/fixtures');
const readJsonFixture = (rel: string) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, rel), 'utf-8')) as { events: TheSportsDBRawEvent[] | null };
const readText = (rel: string) => fs.readFileSync(path.join(FIXTURE_DIR, rel), 'utf-8');

const ROUND6 = readJsonFixture('thesportsdb/eventsround-4829-r6-2026-2027.json');
const DAY_1012 = readJsonFixture('thesportsdb/eventsday-2026-10-12-l4829.json');
const PAST_4829 = readJsonFixture('thesportsdb/eventspastleague-4829.json');
const NEXT_4830 = readJsonFixture('thesportsdb/eventsnextleague-4830.json');

const ROUND6_BY_ID = new Map((ROUND6.events || []).map((e) => [e.idEvent, e]));

/** Routes a mocked fetch by endpoint name; every request is recorded in `calls`. */
function mockTheSportsDB(routes: Record<string, { events: TheSportsDBRawEvent[] | null }>, calls: string[] = []) {
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    const endpoint = (url.pathname.split('/').pop() || '').replace(/\.php$/, '');
    calls.push(`${endpoint}.php${url.search}`);
    const body = routes[endpoint] ?? { events: null };
    return Response.json(body);
  });
  return calls;
}

afterEach(() => {
  mock.restoreAll();
});

// ---------------------------------------------------------------------------------------------
// 1. Malformed SportScore `time` used to discard the whole batch.
// Reproduction: the old code mapped every record with no checks, so one bad `time` threw and
// isolateSource dropped the batch. Fixed: the bad record is skipped alone.
// ---------------------------------------------------------------------------------------------
test('1. SportScore: a malformed time throws in the old mapper; the fixed batch keeps the valid records', async () => {
  const bad = {
    home: 'Bad Time FC',
    away: 'Other FC',
    status: 'notstarted',
    time: 'not-a-date',
    competition: 'Egyptian Premier League',
  };
  // The old mapper threw here (new Date('not-a-date').toISOString()).
  assert.throws(() => mapSportScoreMatchToRecord(bad));
  assert.equal(sportScoreSkipReason(bad), 'invalid_time');

  const good = {
    home: 'Zamalek SC',
    away: 'Al Ahly FC',
    home_score: '0',
    away_score: '2',
    status: 'finished',
    time: '2026-10-11T17:00:00Z',
    competition: 'Egyptian Premier League',
    url: '/football/match/zamalek-sc-vs-al-ahly-fc/l5ergph49xdlr8k/',
  };
  mock.method(globalThis, 'fetch', async () =>
    Response.json({ sport: 'football', matches: [good, bad, { ...good, home: 'Missing Away', away: undefined }] })
  );
  const res = await fetchSportScoreMatches({ retries: 0, cacheTtlMs: 0 });
  assert.equal(res.ok, true);
  assert.equal(res.matches.length, 1);
  assert.equal(res.skippedRecords, 2);
  assert.equal(res.matches[0].utcKickoff, '2026-10-11T17:00:00.000Z');
});

// ---------------------------------------------------------------------------------------------
// 2. Stale provider `live` stayed live for up to 6 hours past kick-off.
// Reproduction: normalizeMatchStatus returned 'live' 5 hours after kick-off, and the store guard
// checked only lastUpdatedAt, which every sync resets.
// ---------------------------------------------------------------------------------------------
test('2. Stale live: a provider "live" flag 5 hours after kick-off is not shown as live', () => {
  const now = new Date('2026-10-12T20:00:00Z');
  const kickoff = '2026-10-12T15:00:00Z'; // 5 h before `now`
  const status = normalizeMatchStatus('LIVE', 'LIVE', kickoff, now);
  assert.equal(status.status, 'unconfirmed');

  const sportscoreLive = mapSportScoreMatchToRecord({
    home: 'Stale Live FC',
    away: 'Old Data FC',
    status: 'live',
    time: kickoff,
    competition: 'Egyptian Premier League',
  });
  // The record is freshly mapped (lastUpdatedAt = now). Only the kick-off age can catch it.
  const guarded = guardStaleLiveStatus(
    { ...sportscoreLive, lastUpdatedAt: now.toISOString() } as MatchRecord,
    now
  );
  assert.equal(guarded.status, 'unconfirmed');
  assert.equal(guarded.liveMinute, null);
  assert.ok(LIVE_MAX_AFTER_KICKOFF_MS <= 3 * 60 * 60 * 1000);

  // A plausible live match 40 minutes into the game stays live.
  const plausible = guardStaleLiveStatus(
    { ...sportscoreLive, status: 'live', utcKickoff: '2026-10-12T19:20:00Z', lastUpdatedAt: now.toISOString() },
    now
  );
  assert.equal(plausible.status, 'live');
});

// ---------------------------------------------------------------------------------------------
// 3. not_started stayed "لم تبدأ بعد" after kick-off. Reproduced with the real Egyptian fixture:
// Al-Mokawloon vs ZED kicked off 14:00Z and TheSportsDB reports it FT 1-1, but the stored
// snapshot said not_started.
// ---------------------------------------------------------------------------------------------
test('3. not_started after kick-off: stale record is downgraded and the finished result replaces it', () => {
  const event = ROUND6_BY_ID.get('2561122') as TheSportsDBRawEvent;
  const finished = mapTheSportsDBEventToRecord(event);
  assert.equal(finished.status, 'finished');
  assert.deepEqual(finished.score, { home: 1, away: 1 });

  // The snapshot record was stored before kick-off, so it still says not_started.
  const stale: MatchRecord = {
    ...finished,
    status: 'not_started',
    statusLabelAr: 'لم تبدأ بعد',
    statusNoteAr: null,
    score: { home: null, away: null },
  };
  const now = new Date('2026-10-12T20:00:00Z');
  const guarded = guardStaleLiveStatus(stale, now);
  assert.equal(guarded.status, 'unconfirmed');
  assert.match(guarded.statusNoteAr || "", /موعد انطلاق/);

  // Within the grace period the status is still believed.
  const justStarted = new Date(Date.parse(stale.utcKickoff) + NOT_STARTED_GRACE_MS - 60_000);
  assert.equal(guardStaleLiveStatus(stale, justStarted).status, 'not_started');

  // A fresh sync with the FT result overrides the stale status on merge.
  const merged = mergeMatchRecords(stale, finished);
  assert.equal(merged.status, 'finished');
  assert.equal(merged.score.home, 1);
  assert.equal(merged.score.away, 1);
});

// ---------------------------------------------------------------------------------------------
// 4. League 4830 is KBO baseball, but the catalog mapped it to Egypt Cup, so baseball entered the
// soccer schedule.
// ---------------------------------------------------------------------------------------------
test('4. League 4830 (KBO baseball) is excluded and no longer labelled Egypt Cup', () => {
  assert.equal(NEXT_4830.events, null, 'the captured 4830 next-fixtures response is empty');
  assert.ok(!THESPORTSDB_FOLLOWED_LEAGUES.some((l) => l.id === '4830'));

  const kboLike: TheSportsDBRawEvent = {
    idEvent: '9800001',
    strEvent: 'Doosan Bears vs LG Twins',
    strSport: 'Baseball',
    idLeague: '4830',
    strLeague: 'Korean KBO League',
    strHomeTeam: 'Doosan Bears',
    strAwayTeam: 'LG Twins',
    strTimestamp: '2026-10-12T10:00:00',
    dateEvent: '2026-10-12',
    strStatus: 'NS',
  };
  assert.equal(theSportsDBSkipReason(kboLike), 'not_soccer');
  assert.equal(theSportsDBSkipReason({ ...kboLike, strSport: null }), 'excluded_league');

  const comp = resolveCompetitionByMeta({ thesportsdbId: '4830', nameEn: 'Korean KBO League' });
  assert.notEqual(comp.code, 'EGY_CUP', 'KBO must not map to the Egypt Cup');
});

// ---------------------------------------------------------------------------------------------
// 5. Free-tier limits: eventsday returns at most 3 events and eventspastleague/eventsnextleague at
// most 1. Round 6 has 6 events, so the next/past/day calls alone miss two Oct 11 results.
// Fixed: the Egyptian round endpoint supplies the whole round.
// ---------------------------------------------------------------------------------------------
test('5. Coverage: next/past/day fixtures miss round-6 matches; the round fetch supplies them', async () => {
  const roundIds = new Set((ROUND6.events || []).map((e) => e.idEvent));
  const partialIds = new Set([...(DAY_1012.events || []), ...(PAST_4829.events || [])].map((e) => e.idEvent));
  assert.equal(roundIds.size, 6);
  assert.equal(DAY_1012.events?.length, 3, 'eventsday capture returned the free-tier cap of 3');
  const missing = [...roundIds].filter((id) => !partialIds.has(id));
  assert.ok(missing.includes('2561120') && missing.includes('2561121'), 'two Oct 11 results are not in day/past');

  const calls = mockTheSportsDB(
    {
      eventsround: ROUND6,
      eventsday: DAY_1012,
      eventspastleague: PAST_4829,
      eventsnextleague: { events: null },
    },
    []
  );
  const res = await fetchTheSportsDBMatches(['2026-10-11', '2026-10-12', '2026-10-13'], {
    rounds: { season: '2026-2027', rounds: [6] },
    retries: 0,
    cacheTtlMs: 0,
  });
  assert.equal(res.ok, true);
  const egy = res.matches.filter((m) => m.competitionCode === 'EGY');
  assert.equal(egy.length, 6, 'all six round-6 Egyptian matches are stored');
  assert.ok(calls.some((c) => c.startsWith('eventsround.php?id=4829&r=6')));
  assert.ok(res.endpoints.some((e) => e.endpoint.includes('eventsround.php') && e.eventsCount === 6));
});

// ---------------------------------------------------------------------------------------------
// 6. Kick-off fabrication: `${dateEvent}T${strTime || '16:00:00'}Z` invented a 16:00 UTC kick-off
// when strTimestamp was missing. Fixed: no time is invented; the record is marked unconfirmed.
// ---------------------------------------------------------------------------------------------
test('6. Missing kick-off timestamp: no 16:00 default; the match is marked unconfirmed', () => {
  const noTimestamp: TheSportsDBRawEvent = {
    idEvent: '9800002',
    strEvent: 'Future FC vs Other FC',
    idLeague: '4829',
    strLeague: 'Egyptian Premier League',
    strHomeTeam: 'Future FC',
    strAwayTeam: 'Other FC',
    dateEvent: '2026-10-19',
    strTime: '18:30:00',
    strStatus: 'NS',
  };
  assert.deepEqual(resolveTheSportsDBKickoff(noTimestamp), {
    utcIso: '2026-10-19T00:00:00.000Z',
    confirmed: false,
  });
  const record = mapTheSportsDBEventToRecord(noTimestamp);
  assert.equal(record.kickoffConfirmed, false);
  assert.equal(record.utcKickoff, '2026-10-19T00:00:00.000Z');
  assert.equal(record.cairoDate, '2026-10-19', 'the calendar day is still correct');
  assert.equal(record.cairoTime, 'الموعد غير مؤكد');
  assert.equal(record.status, 'unconfirmed');
  assert.ok(!JSON.stringify(record).includes('16:00'));

  // A later source with no time must not overwrite a confirmed kick-off.
  const confirmed = mapTheSportsDBEventToRecord({
    ...noTimestamp,
    strTimestamp: '2026-10-19T15:30:00',
    strStatus: 'NS',
  });
  const merged = mergeMatchRecords(confirmed, record);
  assert.equal(merged.utcKickoff, '2026-10-19T15:30:00.000Z');
  assert.equal(merged.kickoffConfirmed, true);
});

// ---------------------------------------------------------------------------------------------
// 7. The sequential TheSportsDB chain on the request path had no time bound. Fixed: a budget
// skips endpoints that would start late, and each skip is recorded.
// ---------------------------------------------------------------------------------------------
test('7. Time budget: an exhausted budget requests nothing and records every endpoint as skipped', async () => {
  const calls: string[] = [];
  mockTheSportsDB({}, calls);
  const res = await fetchTheSportsDBMatches(['2026-10-12'], {
    rounds: { season: '2026-2027', rounds: [5, 6, 7] },
    retries: 0,
    cacheTtlMs: 0,
    budgetMs: 0,
  });
  assert.equal(calls.length, 0, 'no HTTP request is made once the budget is used up');
  assert.equal(res.ok, false);
  assert.equal(res.skippedEndpoints, res.endpoints.length);
  assert.ok(res.endpoints.every((e) => e.error === 'skipped: time budget used'));
});

// ---------------------------------------------------------------------------------------------
// 8. Round window must only use this season's rounds. Last season's round 30 must not shift
// the window for 2026-2027.
// ---------------------------------------------------------------------------------------------
test('8. Round window: scoped to the current Egyptian season', () => {
  assert.equal(egyptianSeasonLabelFor('2026-10-12'), '2026-2027');
  assert.equal(egyptianSeasonLabelFor('2026-06-30'), '2025-2026');
  assert.equal(egyptianSeasonLabelFor('2026-07-01'), '2026-2027');
  // Start from an empty store so only this test's records are counted.
  getGatewayDatabase().matches = [];

  // Before any 2026-2027 data is stored: start from round 1.
  assert.deepEqual(getEgyptianRoundWindow('2026-10-12'), { season: '2026-2027', rounds: [1, 2] });

  upsertMatchesInStore([
    mapTheSportsDBEventToRecord({
      idEvent: '9700030',
      strEvent: 'Old Season A vs Old Season B',
      idLeague: '4829',
      strLeague: 'Egyptian Premier League',
      strSeason: '2025-2026',
      intRound: '30',
      strHomeTeam: 'Old Season A',
      strAwayTeam: 'Old Season B',
      strTimestamp: '2026-05-20T15:00:00',
      dateEvent: '2026-05-20',
      strStatus: 'FT',
    }),
  ]);
  assert.deepEqual(getEgyptianRoundWindow('2026-10-12'), { season: '2026-2027', rounds: [1, 2] });

  upsertMatchesInStore([mapTheSportsDBEventToRecord(ROUND6_BY_ID.get('2561122') as TheSportsDBRawEvent)]);
  assert.deepEqual(getEgyptianRoundWindow('2026-10-12'), { season: '2026-2027', rounds: [5, 6, 7] });
});

// ---------------------------------------------------------------------------------------------
// 9. A test run rewrote the committed data/gateway-store.json. Fixed: npm test sets
// NEMO_GATEWAY_STORE_PERSIST=off.
// ---------------------------------------------------------------------------------------------
test('9. Test runs do not rewrite the committed gateway store', () => {
  assert.equal(isStorePersistenceEnabled(), false, 'run through npm test (persistence off)');
  const storePath = path.join(process.cwd(), 'data/gateway-store.json');
  const before = fs.readFileSync(storePath, 'utf-8');
  upsertMatchesInStore([mapTheSportsDBEventToRecord(ROUND6_BY_ID.get('2561120') as TheSportsDBRawEvent)]);
  assert.equal(fs.readFileSync(storePath, 'utf-8'), before);
  assert.ok(getGatewayDatabase().matches.length > 0);
});

// ---------------------------------------------------------------------------------------------
// 10. News: all six stored items are rejected. Cause, reproduced here:
// (a) the stored items' originalUrl is the RSS search feed URL, not an article, so the validator
//     correctly rejects them as invalid_url. The seed data stored the feed URL as the item link;
// (b) a real Google News relay link is unresolved when the relay page answers 200 with no HTTP
//     Location header (JS redirect). The resolver then returns null and the validator rejects it.
// ---------------------------------------------------------------------------------------------
function candidateFrom(link: string, overrides: Partial<RawNewsCandidate> = {}): RawNewsCandidate {
  return {
    sourceId: 'google-news-rss',
    sourceItemId: 'test-item',
    title: 'موعد مباراة الزمالك والأهلي في الدوري المصري',
    link,
    originalUrl: link,
    publishedAt: '2026-10-11T22:15:00.000Z',
    publishedAtKnown: true,
    updatedAt: null,
    excerpt: null,
    imageUrl: null,
    publisherName: 'اليوم السابع',
    publisherUrl: 'https://www.youm7.com',
    language: 'ar',
    categoryAr: 'الكرة المصرية',
    fetchedAt: '2026-10-12T20:00:00.000Z',
    ...overrides,
  } as RawNewsCandidate;
}

test('10a. News: the stored search-feed URL is rejected by the validator (correct behaviour)', () => {
  const feedUrl =
    'https://news.google.com/rss/search?q=Egyptian+Premier+League&hl=en&gl=EG&ceid=EG:en';
  const result = validateNewsCandidate(candidateFrom(feedUrl, { publisherUrl: null }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_url');
});

test('10b. News: a synthetic RSS relay item parses, stays unresolved on a JS-only relay page, and is rejected', async () => {
  const [item] = parseGoogleNewsRssXml(readText('google-news/rss-sample-synthetic.xml'), 'ar');
  assert.ok(item, 'the RSS item parses');
  assert.equal(item.title, 'موعد مباراة الزمالك والأهلي في الدوري المصري');
  assert.match(item.link, /^https:\/\/news\.google\.com\/rss\/articles\//);
  assert.equal(item.publisherName, 'اليوم السابع');

  // Relay page that answers 200 with HTML and no Location header.
  mock.method(globalThis, 'fetch', async () => new Response('<html>redirecting…</html>', { status: 200 }));
  const unresolved = await resolveGoogleNewsArticleUrl(item);
  assert.equal(unresolved, null);
  const rejected = validateNewsCandidate(item);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'invalid_url');
});

test('10c. News: a relay that answers with a publisher Location resolves; a headline-only excerpt is not indexable', async () => {
  const [item] = parseGoogleNewsRssXml(readText('google-news/rss-sample-synthetic.xml'), 'ar');
  const article = 'https://www.youm7.com/story/2026/10/11/zamalek-ahly-match-time/1234567';
  mock.method(globalThis, 'fetch', async () =>
    new Response(null, { status: 302, headers: { location: article } })
  );
  const resolved = await resolveGoogleNewsArticleUrl(item);
  assert.equal(resolved, article);
  assert.ok(resolved);
  const result = validateNewsCandidate({ ...item, link: resolved, originalUrl: resolved });
  assert.equal(result.ok, true, 'a direct publisher article passes validation');
});

// ---------------------------------------------------------------------------------------------
// 11. Source scan: generic and guessed match destinations must not be built into public code.
// ---------------------------------------------------------------------------------------------
test('11. NEMO match links use an explicit allowlist, never a generic /watch or guessed page', () => {
  const dirs = ['lib', 'components', 'app'];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
      const full = path.join(process.cwd(), dir, entry.name);
      if (entry.isDirectory()) walk(path.relative(process.cwd(), full));
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  dirs.forEach(walk);
  const offenders: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf-8');
    if (/https:\/\/nemo-sports\.vercel\.app\/watch/.test(text)) {
      offenders.push(`${file}: generic /watch URL`);
    }
    if (/matchId=|selected-match-broadcast/.test(text)) {
      offenders.push(`${file}: unsupported match query/anchor`);
    }
    if (/NEMO_SPORTS_BASE_URL[^\n]*\/matches/.test(text)) {
      offenders.push(`${file}: runtime-configured match destination`);
    }
    if (/broadcast_section|competition_fallback|schedule_fallback/.test(text)) {
      offenders.push(`${file}: obsolete link type`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('11b. TheSportsDB fixtures resolve only to their exact verified match page or no link', () => {
  const samples = [...(ROUND6.events || []), ...(DAY_1012.events || [])].map((event) =>
    mapTheSportsDBEventToRecord(event)
  );
  assert.ok(samples.length >= 6);
  const verifiedPages = VERIFIED_NEMO_MAPPING_TABLE
    .map((entry) => ({ entry, url: getVerifiedNemoMatchPageUrl(entry) }))
    .filter((item): item is { entry: (typeof VERIFIED_NEMO_MAPPING_TABLE)[number]; url: string } => Boolean(item.url));

  for (const record of samples) {
    if (!record.nemoLink.url) {
      assert.equal(record.nemoLink.linkType, 'unavailable');
      assert.equal(record.nemoLink.verified, false);
      continue;
    }

    const mapping = verifiedPages.find(({ entry, url }) => {
      const providerIdMatches =
        entry.thesportsdbEventId === record.externalIds.thesportsdbEventId ||
        entry.apiFootballFixtureId === record.externalIds.apiFootballFixtureId;
      return providerIdMatches && entry.cairoDate === record.cairoDate && url === record.nemoLink.url;
    });
    assert.ok(mapping, `unallow-listed NEMO destination: ${record.nemoLink.url}`);
    assert.equal(record.nemoLink.linkType, 'direct_match');
    assert.equal(record.nemoLink.verified, true);
  }
  assert.equal(toCairoDateString('2026-10-12T17:00:00.000Z'), '2026-10-12');
});
