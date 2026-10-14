import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  auditMatchLinkIntegrity,
  blockingLinkIssues,
  buildMatchDedupKey,
  getStableMatchId,
} from '../lib/match-identity';
import {
  VERIFIED_NEMO_MAPPING_TABLE,
  findVerifiedMatchMapping,
  getVerifiedNemoMatchPageUrl,
  resolveNemoSportsLink,
} from '../lib/nemo-resolver';
import {
  TheSportsDBRawEvent,
  mapTheSportsDBEventToRecord,
} from '../lib/sources/thesportsdb';
import { mapSportScoreMatchToRecord } from '../lib/sources/sportscore';
import type { MatchRecord } from '../lib/types';

const ROUND6 = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'tests/fixtures/thesportsdb/eventsround-4829-r6-2026-2027.json'),
    'utf-8'
  )
) as { events: TheSportsDBRawEvent[] };
const byId = new Map(ROUND6.events.map((event) => [event.idEvent, event]));

// ---------------------------------------------------------------------------------------------
// 1. The two fixtures the visitors actually complained about are bound to their real ids.
// ---------------------------------------------------------------------------------------------
test('Zamalek vs Al Ahly resolves to the API-Football fixture id and its verified page', () => {
  const record = mapTheSportsDBEventToRecord(byId.get('2561121') as TheSportsDBRawEvent);
  assert.equal(record.externalIds.thesportsdbEventId, '2561121');
  assert.equal(record.externalIds.apiFootballFixtureId, '1612250');
  assert.equal(record.id, 'match-api-football-1612250', 'the provider id wins over a synthetic key');
  assert.equal(record.homeTeam.nameAr, 'الزمالك');
  assert.equal(record.awayTeam.nameAr, 'الأهلي');
  assert.equal(record.cairoDate, '2026-10-11');
  assert.equal(record.score.home, 0);
  assert.equal(record.score.away, 2);
  assert.equal(
    record.nemoLink.url,
    'https://nemo-sports.vercel.app/matches/zamalek-sc-vs-al-ahly-fc#live-stream'
  );
  assert.equal(record.nemoLink.linkType, 'direct_match');
  assert.deepEqual(record.nemoLink.matchedBy, [
    'provider_match_id',
    'competition_id',
    'team_ids',
    'match_date',
    'mapping_table',
  ]);
});

test('El Qanah vs Al Masry resolves to its own fixture id and page, not the derby’s', () => {
  const record = mapTheSportsDBEventToRecord(byId.get('2561120') as TheSportsDBRawEvent);
  assert.equal(record.externalIds.apiFootballFixtureId, '1612249');
  assert.equal(record.id, 'match-api-football-1612249');
  assert.equal(record.homeTeam.nameAr, 'القناة');
  assert.equal(record.awayTeam.nameAr, 'المصري البورسعيدي');
  assert.equal(
    record.nemoLink.url,
    'https://nemo-sports.vercel.app/matches/olympic-el-qanal-vs-al-masry#live-stream'
  );
  assert.notEqual(record.id, 'match-api-football-1612250');
  assert.notEqual(record.nemoLink.url, 'https://nemo-sports.vercel.app/matches/zamalek-sc-vs-al-ahly-fc#live-stream');
});

test('every stored fixture of round 6 keeps a distinct identity and never borrows a page', () => {
  const records = ROUND6.events.map((event) => mapTheSportsDBEventToRecord(event));
  const ids = records.map((record) => record.id);
  assert.equal(new Set(ids).size, ids.length, 'no two fixtures share an id');

  const linked = records.filter((record) => record.nemoLink.url);
  assert.equal(linked.length, 2, 'only the two verified fixtures expose a broadcast link');
  for (const record of records.filter((r) => !r.nemoLink.url)) {
    assert.equal(record.nemoLink.linkType, 'unavailable');
    assert.match(record.nemoLink.labelAr, /لا يوجد رابط بث مطابق موثّق/);
  }
});

// ---------------------------------------------------------------------------------------------
// 2. The regression that sent visitors to an OLD match: same clubs, different date.
// ---------------------------------------------------------------------------------------------
test('a new fixture between the same clubs does not inherit the old verified page', () => {
  const nextSeasonDerby: TheSportsDBRawEvent = {
    ...(byId.get('2561121') as TheSportsDBRawEvent),
    idEvent: '2600001',
    idAPIfootball: '1700001',
    dateEvent: '2027-04-18',
    strTimestamp: '2027-04-18T17:00:00',
    intHomeScore: null,
    intAwayScore: null,
    strStatus: null,
  };
  const record = mapTheSportsDBEventToRecord(nextSeasonDerby);
  assert.equal(record.cairoDate, '2027-04-18');
  assert.equal(record.id, 'match-api-football-1700001');
  assert.equal(record.nemoLink.url, null, 'no page is verified for the new date');
  assert.equal(record.nemoLink.linkType, 'unavailable');
  assert.notEqual(record.id, 'match-api-football-1612250');
});

test('the resolver refuses a mapping whose date, teams or competition do not match', () => {
  const verified = VERIFIED_NEMO_MAPPING_TABLE.find((entry) => entry.apiFootballFixtureId === '1612250');
  assert.ok(verified);
  const base = {
    apiFootballFixtureId: '1612250',
    competitionCode: 'EGY',
    homeTeamId: 'team-zamalek',
    awayTeamId: 'team-al-ahly',
  };
  assert.equal(resolveNemoSportsLink({ ...base, cairoDate: '2026-10-11' }).linkType, 'direct_match');
  assert.equal(resolveNemoSportsLink({ ...base, cairoDate: '2026-10-12' }).linkType, 'unavailable');
  assert.equal(
    resolveNemoSportsLink({ ...base, cairoDate: '2026-10-11', homeTeamId: 'team-al-ahly', awayTeamId: 'team-zamalek' })
      .linkType,
    'unavailable'
  );
  assert.equal(
    resolveNemoSportsLink({ ...base, cairoDate: '2026-10-11', competitionCode: 'CAF_CL' }).linkType,
    'unavailable'
  );
  assert.equal(resolveNemoSportsLink({ competitionCode: 'EGY', homeTeamId: 'x', awayTeamId: 'y', cairoDate: '2026-10-11' }).url, null);
});

test('a descriptive slug alone is never enough to create a link', () => {
  const mapping = findVerifiedMatchMapping({
    sportscoreSlug: 'zamalek-sc-vs-al-ahly-fc',
    competitionCode: 'EGY',
    homeTeamId: 'team-zamalek',
    awayTeamId: 'team-al-ahly',
  });
  assert.equal(mapping, undefined, 'no trusted source id was supplied');
});

test('the mapping table itself is internally consistent and every slug is a legal path', () => {
  const ids = VERIFIED_NEMO_MAPPING_TABLE.map((entry) => entry.canonicalMatchId);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of VERIFIED_NEMO_MAPPING_TABLE) {
    assert.match(entry.canonicalMatchId, /^match-[a-z-]+-\d+$/);
    assert.equal(/^\d{4}-\d{2}-\d{2}$/.test(entry.cairoDate), true);
    if (entry.verifiedNemoMatchSlug) {
      const url = getVerifiedNemoMatchPageUrl(entry);
      assert.ok(url);
      assert.match(url!, /^https:\/\/nemo-sports\.vercel\.app\/matches\/[a-z0-9-]+#live-stream$/);
    } else {
      assert.equal(getVerifiedNemoMatchPageUrl(entry), null);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// 3. Cross-source identity: one fixture reported by two providers is stored once.
// ---------------------------------------------------------------------------------------------
test('the same fixture from SportScore and TheSportsDB shares one dedup key', () => {
  const tsdb = mapTheSportsDBEventToRecord(byId.get('2561124') as TheSportsDBRawEvent);
  const sportscore = mapSportScoreMatchToRecord({
    home: 'Pyramids',
    away: 'Ceramica Cleopatra',
    status: 'notstarted',
    time: '2026-10-12T17:00:00Z',
    competition: 'Egyptian Premier League',
    url: '/football/match/pyramids-vs-ceramica-cleopatra/abcdef123456/',
  });
  assert.notEqual(tsdb.id, sportscore.id, 'provider ids differ');
  assert.equal(buildMatchDedupKey(tsdb), buildMatchDedupKey(sportscore));
});

test('an unconfirmed kick-off never merges across sources on a guess', () => {
  const unconfirmed = mapTheSportsDBEventToRecord({
    ...(byId.get('2561124') as TheSportsDBRawEvent),
    strTimestamp: null,
  });
  assert.equal(unconfirmed.kickoffConfirmed, false);
  const confirmed = mapTheSportsDBEventToRecord(byId.get('2561124') as TheSportsDBRawEvent);
  assert.notEqual(buildMatchDedupKey(unconfirmed), buildMatchDedupKey(confirmed));
});

test('last season’s fixture and this season’s fixture never share an identity', () => {
  const thisSeason = mapTheSportsDBEventToRecord(byId.get('2561124') as TheSportsDBRawEvent);
  const lastSeason = mapTheSportsDBEventToRecord({
    ...(byId.get('2561124') as TheSportsDBRawEvent),
    idEvent: '2500001',
    idAPIfootball: '1600001',
    strSeason: '2025-2026',
    dateEvent: '2025-10-12',
    strTimestamp: '2025-10-12T17:00:00',
  });
  assert.notEqual(buildMatchDedupKey(thisSeason), buildMatchDedupKey(lastSeason));
});

test('getStableMatchId prefers a real provider id and falls back to an obviously synthetic key', () => {
  // A fixture that is not in the bridge table keeps its own provider id.
  assert.equal(
    getStableMatchId({
      externalIds: { thesportsdbEventId: '2561125' },
      competitionCode: 'EGY',
      homeTeamId: 'team-smouha',
      awayTeamId: 'team-ghazl-el-mahalla',
      cairoDate: '2026-10-12',
    }),
    'match-thesportsdb-2561125'
  );
  assert.equal(
    getStableMatchId({
      externalIds: { footballDataMatchId: '550001' },
      competitionCode: 'PL',
      homeTeamId: 'team-x',
      awayTeamId: 'team-y',
      cairoDate: '2026-10-12',
    }),
    'match-football-data-550001'
  );
  // The bridge table is stronger than a single provider id: a TheSportsDB event that is the same
  // fixture as a verified API-Football match adopts that identity.
  assert.equal(
    getStableMatchId({
      externalIds: { thesportsdbEventId: '2561121' },
      competitionCode: 'EGY',
      homeTeamId: 'team-zamalek',
      awayTeamId: 'team-al-ahly',
      cairoDate: '2026-10-11',
    }),
    'match-api-football-1612250'
  );
  assert.equal(
    getStableMatchId({
      externalIds: {},
      competitionCode: 'EGY',
      homeTeamId: 'team-a',
      awayTeamId: 'team-b',
      cairoDate: '2026-10-11',
      fallbackId: 'match-egy-2026-10-11-a-b',
    }),
    'match-egy-2026-10-11-a-b'
  );
});

// ---------------------------------------------------------------------------------------------
// 4. The integrity audit that guards the release.
// ---------------------------------------------------------------------------------------------
test('the audit passes on real round-6 records and flags a mismatched link', () => {
  const records = ROUND6.events.map((event) => mapTheSportsDBEventToRecord(event));
  const report = auditMatchLinkIntegrity(records, new Date('2026-10-13T00:00:00Z'));
  assert.equal(report.checked, records.length);
  assert.equal(report.linked, 2);
  assert.deepEqual(blockingLinkIssues(report), []);

  // The real-world failure: a stored record kept a page verified for an earlier fixture between
  // the same two clubs, so a visitor on 12 October opened the 11 October derby page.
  const hijacked: MatchRecord = {
    ...records[2],
    id: 'match-api-football-1612250',
    externalIds: { ...records[2].externalIds, apiFootballFixtureId: '1612250' },
    homeTeam: { ...records[2].homeTeam, id: 'team-zamalek' },
    awayTeam: { ...records[2].awayTeam, id: 'team-al-ahly' },
    cairoDate: '2026-10-12',
    nemoLink: {
      ...records[2].nemoLink,
      url: 'https://nemo-sports.vercel.app/matches/zamalek-sc-vs-al-ahly-fc#live-stream',
      linkType: 'direct_match',
      verified: true,
    },
  };
  const badReport = auditMatchLinkIntegrity([hijacked], new Date('2026-10-13T00:00:00Z'));
  const errors = blockingLinkIssues(badReport);
  assert.ok(errors.some((issue) => issue.code === 'link_date_mismatch'));
});

test('the audit flags stale “not started” records and impossible live states', () => {
  const base = mapTheSportsDBEventToRecord(byId.get('2561124') as TheSportsDBRawEvent);
  const stale: MatchRecord = { ...base, status: 'not_started' };
  const report = auditMatchLinkIntegrity([stale], new Date('2027-06-01T00:00:00Z'));
  assert.ok(report.issues.some((issue) => issue.code === 'stale_upcoming'));

  const impossibleLive: MatchRecord = { ...base, status: 'live' };
  const liveReport = auditMatchLinkIntegrity([impossibleLive], new Date('2027-06-01T00:00:00Z'));
  assert.ok(liveReport.issues.some((issue) => issue.code === 'live_outside_window'));
});

test('the audit flags duplicate identities and records with no provider id', () => {
  const record = mapTheSportsDBEventToRecord(byId.get('2561124') as TheSportsDBRawEvent);
  const duplicate: MatchRecord = { ...record, id: 'match-duplicate-copy' };
  const report = auditMatchLinkIntegrity([record, duplicate]);
  assert.ok(report.issues.some((issue) => issue.code === 'duplicate_identity'));

  const noProviderId: MatchRecord = { ...record, id: 'match-synthetic', externalIds: {} };
  const noIdReport = auditMatchLinkIntegrity([noProviderId]);
  assert.ok(noIdReport.issues.some((issue) => issue.code === 'missing_provider_id'));
});

test('the committed store passes the blocking integrity checks', () => {
  const store = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data/gateway-store.json'), 'utf-8')
  ) as { matches: MatchRecord[] };
  const report = auditMatchLinkIntegrity(store.matches, new Date('2026-10-13T00:00:00Z'));
  assert.equal(report.checked, store.matches.length);
  const errors = blockingLinkIssues(report).filter(
    // A snapshot can legitimately hold records whose status has not been refreshed yet.
    (issue) => issue.code !== 'live_outside_window'
  );
  assert.deepEqual(
    errors,
    [],
    `no duplicate or mis-linked fixtures in the committed store (found ${errors.length})`
  );
});
