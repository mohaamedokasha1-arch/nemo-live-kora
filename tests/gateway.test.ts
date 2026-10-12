import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatScoreDisplay,
  normalizeMatchStatus,
  isValidDateParam,
  shiftDateString,
  parseNullableScore,
  toCairoDateString,
  toCairoTime24,
} from '../lib/cairo-time';
import {
  extractSportscoreMatchSlug,
  extractSportscoreTrackerId,
  resolveNemoSportsLink,
} from '../lib/nemo-resolver';
import { mapSportScoreMatchToRecord } from '../lib/sources/sportscore';
import { mapTheSportsDBEventToRecord } from '../lib/sources/thesportsdb';
import { parseGoogleNewsRssXml } from '../lib/sources/google-news-rss';
import {
  getGatewayDatabase,
  queryGatewayMatches,
  upsertMatchesInStore,
} from '../lib/db/store';
import { mergeMatchRecords } from '../lib/db/seed-data';

test('1. Root Repository Structure: core files exist directly at repository root', () => {
  const rootDir = process.cwd();
  const requiredRootFiles = [
    'package.json',
    'README.md',
    'next.config.mjs',
    'tsconfig.json',
    '.env.example',
    'app/page.tsx',
    'app/layout.tsx',
    'app/matches/[date]/page.tsx',
    'components/MatchCard.tsx',
    'lib/nemo-resolver.ts',
  ];

  for (const rel of requiredRootFiles) {
    assert.equal(
      fs.existsSync(path.join(rootDir, rel)),
      true,
      `Expected ${rel} to exist at repository root`
    );
  }
});

test('2. Cairo Timezone Conversion: accurately converts UTC timestamps to Africa/Cairo date and time', () => {
  // 2026-10-11T21:30:00Z is 2026-10-12 00:30 in Africa/Cairo (UTC+3 DST in October 2026)
  const utcLateNight = '2026-10-11T21:30:00Z';
  assert.equal(toCairoDateString(utcLateNight), '2026-10-12');
  assert.equal(toCairoTime24(utcLateNight), '00:30');

  // 2026-10-12T17:00:00Z (Pyramids vs Ceramica Cleopatra) is 20:00 Cairo time on 2026-10-12
  const pyramidsUtc = '2026-10-12T17:00:00Z';
  assert.equal(toCairoDateString(pyramidsUtc), '2026-10-12');
  assert.equal(toCairoTime24(pyramidsUtc), '20:00');
  assert.equal(toCairoDateString('not-a-real-timestamp'), '');
  assert.equal(isValidDateParam('2024-02-29'), true);
  assert.equal(isValidDateParam('2026-02-29'), false);
  assert.equal(isValidDateParam('2026-02-31'), false);
  assert.equal(isValidDateParam('2026-13-01'), false);
  assert.equal(shiftDateString('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDateString('2026-12-31', 1), '2027-01-01');
});

test('3. Score & Status Integrity: NEVER converts null/missing score to 0-0 and NEVER infers finished from elapsed time alone', () => {
  assert.equal(parseNullableScore(null), null);
  assert.equal(parseNullableScore(undefined), null);
  assert.equal(parseNullableScore(''), null);
  assert.equal(parseNullableScore('-'), null);
  assert.equal(parseNullableScore('0'), 0);
  assert.equal(parseNullableScore(2), 2);

  const missingScoreDisplay = formatScoreDisplay(
    { home: null, away: null },
    'not_started'
  );
  assert.equal(missingScoreDisplay.hasScore, false);
  assert.notEqual(missingScoreDisplay.summaryText, '0 - 0');

  // Past kickoff with rawStatus="NS" must NOT be marked as "finished" ("انتهت")
  const pastKickoff = '2026-10-10T12:00:00Z';
  const now = new Date('2026-10-12T12:00:00Z');
  const norm = normalizeMatchStatus('NS', 'Not Started', pastKickoff, now);
  assert.notEqual(norm.status, 'finished');
  assert.equal(norm.status, 'unconfirmed');
  assert.equal(norm.statusLabelAr, 'غير مؤكدة أو غير متاحة من المصدر');

  assert.equal(normalizeMatchStatus('LIVE', 'In Play', '2026-10-12T11:30:00Z', now).status, 'live');
  assert.equal(normalizeMatchStatus('LIVE', 'In Play', '2026-10-12T18:00:00Z', now).status, 'unconfirmed');
  assert.equal(normalizeMatchStatus('LIVE', 'In Play', '2026-10-12T00:00:00Z', now).status, 'unconfirmed');
  assert.equal(normalizeMatchStatus('LIVE', 'In Play', undefined, now).status, 'unconfirmed');
});

test('4. NEMO Sports Match Resolver: links verified matches directly and falls back safely when date does not match', () => {
  assert.equal(
    extractSportscoreMatchSlug('/football/match/zamalek-sc-vs-al-ahly-fc/l5ergph49xdlr8k/'),
    'zamalek-sc-vs-al-ahly-fc'
  );
  assert.equal(
    extractSportscoreTrackerId('/football/match/zamalek-sc-vs-al-ahly-fc/l5ergph49xdlr8k/'),
    'l5ergph49xdlr8k'
  );

  // Verified 2026-10-11 Zamalek vs Al Ahly match -> direct match link
  const zamalekAhlyLink = resolveNemoSportsLink({
    thesportsdbEventId: '2561121',
    apiFootballFixtureId: '1612250',
    competitionCode: 'EGY',
    homeTeamId: 'team-zamalek',
    awayTeamId: 'team-al-ahly',
    cairoDate: '2026-10-11',
  });
  assert.equal(zamalekAhlyLink.linkType, 'direct_match');
  assert.equal(
    zamalekAhlyLink.url,
    'https://nemo-sports.vercel.app/matches/zamalek-sc-vs-al-ahly-fc'
  );

  // The real fixture id keeps the same verified destination if a source corrects the date.
  const rescheduledSameFixture = resolveNemoSportsLink({
    thesportsdbEventId: '2561121',
    competitionCode: 'EGY',
    homeTeamId: 'team-zamalek',
    awayTeamId: 'team-al-ahly',
    cairoDate: '2026-10-12',
  });
  assert.equal(rescheduledSameFixture.url, zamalekAhlyLink.url);

  const wrongTeamsWithReusedId = resolveNemoSportsLink({
    thesportsdbEventId: '2561121',
    competitionCode: 'EGY',
    homeTeamId: 'team-zamalek',
    awayTeamId: 'team-pyramids',
    cairoDate: '2026-10-11',
  });
  assert.equal(wrongTeamsWithReusedId.url, null);

  // Upcoming 2026-10-12 Pyramids vs Ceramica Cleopatra has no verified match page;
  // never substitute a generic competition or date URL.
  const pyramidsCeramicaLink = resolveNemoSportsLink({
    thesportsdbEventId: '2561124',
    apiFootballFixtureId: '1612253',
    competitionCode: 'EGY',
    homeTeamId: 'team-pyramids',
    awayTeamId: 'team-ceramica',
    cairoDate: '2026-10-12',
  });
  assert.equal(pyramidsCeramicaLink.linkType, 'unavailable');
  assert.equal(pyramidsCeramicaLink.url, null);
  assert.equal(pyramidsCeramicaLink.verified, false);

  // Unmapped global competition -> no invented date schedule or competition fallback
  const scheduleFallbackLink = resolveNemoSportsLink({
    competitionCode: 'CHILE_B',
    homeTeamId: 'team-recoleta',
    awayTeamId: 'team-curico',
    cairoDate: '2026-10-13',
  });
  assert.equal(scheduleFallbackLink.linkType, 'unavailable');
  assert.equal(scheduleFallbackLink.url, null);
});

test('5. Five Approved Sources Adapters & Deduplication: normalizes and merges without losing scores', () => {
  const ssMatch = mapSportScoreMatchToRecord(
    {
      home: 'Zamalek SC',
      away: 'Al Ahly FC',
      home_score: '0',
      away_score: '2',
      status: 'finished',
      time: '2026-10-11T17:00:00+00:00',
      competition: 'Egyptian Premier League',
      url: '/football/match/zamalek-sc-vs-al-ahly-fc/l5ergph49xdlr8k/',
      tracker: { id: 'l5ergph49xdlr8k' },
    },
    'zamalek-sc-vs-al-ahly-fc'
  );

  const tsdbMatch = mapTheSportsDBEventToRecord({
    idEvent: '2561121',
    idAPIfootball: '1612250',
    strEvent: 'Zamalek vs Al Ahly',
    idLeague: '4829',
    strLeague: 'Egyptian Premier League',
    strHomeTeam: 'Zamalek',
    strAwayTeam: 'Al Ahly',
    idHomeTeam: '138997',
    idAwayTeam: '138995',
    intRound: '6',
    intHomeScore: null, // Simulate a lagging secondary source with null score
    intAwayScore: null,
    strTimestamp: '2026-10-11T17:00:00Z',
    dateEvent: '2026-10-11',
    strStatus: 'NS',
  });

  assert.equal(ssMatch.id, 'match-api-football-1612250');
  assert.equal(ssMatch.id, tsdbMatch.id);
  const rescheduledTsdbMatch = mapTheSportsDBEventToRecord({
    idEvent: '2561121',
    idAPIfootball: '1612250',
    strEvent: 'Zamalek vs Al Ahly',
    idLeague: '4829',
    strLeague: 'Egyptian Premier League',
    strHomeTeam: 'Zamalek',
    strAwayTeam: 'Al Ahly',
    idHomeTeam: '138997',
    idAwayTeam: '138995',
    strTimestamp: '2026-10-12T17:00:00Z',
    dateEvent: '2026-10-12',
    strStatus: 'NS',
  });
  assert.equal(rescheduledTsdbMatch.id, tsdbMatch.id);
  const mergedRescheduled = mergeMatchRecords(ssMatch, rescheduledTsdbMatch);
  assert.equal(mergedRescheduled.id, ssMatch.id);
  assert.equal(mergedRescheduled.cairoDate, '2026-10-12');
  assert.equal(mergedRescheduled.utcKickoff, '2026-10-12T17:00:00.000Z');

  const merged = mergeMatchRecords(ssMatch, tsdbMatch);
  // Must preserve finished status and 0-2 score from SportScore AND combine contributing sources
  assert.equal(merged.status, 'finished');
  assert.equal(merged.score.home, 0);
  assert.equal(merged.score.away, 2);
  assert.equal(merged.nemoLink.linkType, 'direct_match');
  assert.ok(merged.contributingSources.includes('sportscore'));
  assert.ok(merged.contributingSources.includes('thesportsdb'));

  // Test Google News RSS XML parser
  const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel><item>
      <title>موعد مباراة بيراميدز وسيراميكا في الدوري المصري - يلا كورة</title>
      <link>https://news.google.com/rss/articles/test1</link>
      <pubDate>Sun, 11 Oct 2026 22:15:00 GMT</pubDate>
      <source url="https://www.yallakora.com">يلا كورة</source>
    </item></channel></rss>`;
  const parsedNews = parseGoogleNewsRssXml(sampleRss, 'ar', 'الدوري المصري');
  assert.equal(parsedNews.length, 1);
  assert.equal(parsedNews[0].publisherName, 'يلا كورة');
  assert.equal(
    parsedNews[0].title,
    'موعد مباراة بيراميدز وسيراميكا في الدوري المصري'
  );
  assert.equal(parsedNews[0].publishedAtKnown, true);
  assert.equal(parsedNews[0].publishedAt, '2026-10-11T22:15:00.000Z');
});

test('6. Egyptian Priority & Filter Integrity: Egyptian Premier League appears first on 2026-10-12 and filters only expose real data', () => {
  const db = getGatewayDatabase();
  assert.equal(Object.keys(db.sources).length, 5);

  const todayQuery = queryGatewayMatches({ cairoDate: '2026-10-12' });
  assert.ok(todayQuery.totalOnDate > 0);
  // First competition group on 2026-10-12 must be Egyptian Premier League (EGY)
  assert.equal(todayQuery.groups[0].competitionCode, 'EGY');
  assert.equal(todayQuery.groups[0].isEgyptianInterest, true);

  // Every availableCompetition option must have count > 0
  for (const compOpt of todayQuery.availableCompetitions) {
    assert.ok(compOpt.count > 0);
  }

  // Upserting an empty array must never delete existing matches
  const beforeCount = db.matches.length;
  upsertMatchesInStore([]);
  assert.equal(getGatewayDatabase().matches.length, beforeCount);

  const migrated = getGatewayDatabase();
  const zamalekAhly = migrated.matches.filter(
    (match) =>
      match.externalIds.apiFootballFixtureId === '1612250' ||
      match.externalIds.thesportsdbEventId === '2561121'
  );
  assert.equal(zamalekAhly.length, 1);
  assert.equal(zamalekAhly[0].id, 'match-api-football-1612250');
  assert.equal(zamalekAhly[0].nemoLink.linkType, 'direct_match');

  for (const match of migrated.matches) {
    if (match.nemoLink.linkType === 'direct_match') {
      assert.equal(match.nemoLink.verified, true);
      assert.match(match.nemoLink.url || '', /^https:\/\/nemo-sports\.vercel\.app\/matches\//);
    } else {
      assert.equal(match.nemoLink.url, null);
      assert.equal(match.nemoLink.competitionUrl, null);
      assert.equal(match.nemoLink.scheduleUrl, null);
    }
  }
});
