import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_FOOTBALL_LEAGUES,
  SOURCE_ENDPOINTS,
  THESPORTSDB_LEAGUES,
  apiFootballKey,
  describeSourceConfiguration,
  footballDataKey,
  hasUsableKey,
  keyState,
  maskSecret,
  readEnv,
  thesportsdbKeyCandidates,
} from '../lib/config/env';
import {
  buildSportscoreFixturesEndpoint,
  buildSportscoreMatchEndpoints,
  buildSportscoreStandingsEndpoint,
  extractSportscoreMatchList,
  fetchSportScoreMatches,
} from '../lib/sources/sportscore';
import {
  buildTheSportsDBEndpoints,
  fetchTheSportsDBMatches,
  resetTheSportsDBKeyState,
  thesportsdbKeyProbeLog,
} from '../lib/sources/thesportsdb';
import {
  apiFootballAuthHeaders,
  fetchApiFootballStandings,
  fetchApiFootballSync,
  mapApiFootballFixtureItem,
} from '../lib/sources/api-football';
import { fetchFootballDataSync } from '../lib/sources/football-data';
import { apiFootballSeasonFor } from '../lib/sync/engine';

const ENV_KEYS = [
  'THESPORTSDB_API_KEY',
  'API_FOOTBALL_KEY',
  'API_FOOTBALL_HOST',
  'FOOTBALL_DATA_API_KEY',
  'SPORTSCORE_API_KEY',
  'API_FOOTBALL_EGYPT_LEAGUE_ID',
] as const;
const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  mock.restoreAll();
  resetTheSportsDBKeyState();
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ---------------------------------------------------------------------------------------------
// 1. Environment / key handling.
// ---------------------------------------------------------------------------------------------
test('a key that is only whitespace or a placeholder is reported as not configured', () => {
  process.env.API_FOOTBALL_KEY = '   ';
  assert.equal(keyState('API_FOOTBALL_KEY'), 'missing');
  process.env.API_FOOTBALL_KEY = '"abcdef123456"';
  assert.equal(readEnv('API_FOOTBALL_KEY'), 'abcdef123456', 'surrounding quotes are stripped');
  assert.equal(keyState('API_FOOTBALL_KEY'), 'configured');
  process.env.API_FOOTBALL_KEY = 'your_api_key';
  assert.equal(keyState('API_FOOTBALL_KEY'), 'placeholder');
  assert.equal(hasUsableKey('API_FOOTBALL_KEY'), false);
  assert.equal(apiFootballKey(), null);
});

test('the key matrix shown in the dashboard never contains a secret', () => {
  process.env.API_FOOTBALL_KEY = 'abcdef123456789';
  const rows = describeSourceConfiguration();
  const row = rows.find((entry) => entry.sourceId === 'api-football');
  assert.ok(row);
  assert.equal(row.state, 'configured');
  assert.equal(JSON.stringify(rows).includes('abcdef123456789'), false);
  assert.equal(row.fingerprint.startsWith('abc'), true);
  assert.match(maskSecret('abcdef123456789'), /^abc\*+789$/);
  assert.equal(maskSecret('ab'), '**');
});

test('TheSportsDB tries the operator key first and then the documented free keys', () => {
  delete process.env.THESPORTSDB_API_KEY;
  assert.deepEqual(thesportsdbKeyCandidates(), ['123', '3']);
  process.env.THESPORTSDB_API_KEY = 'premium-9';
  assert.deepEqual(thesportsdbKeyCandidates(), ['premium-9', '123', '3']);
});

// ---------------------------------------------------------------------------------------------
// 2. TheSportsDB: endpoints, key fallback, and the excluded non-soccer league.
// ---------------------------------------------------------------------------------------------
test('TheSportsDB endpoints cover rounds, the full season, next/past and day listings', () => {
  const endpoints = buildTheSportsDBEndpoints(
    ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'],
    { season: '2026-2027', rounds: [5, 6, 7] },
    '123'
  );
  const urls = endpoints.map((e) => e.url);

  assert.ok(urls.some((url) => url.includes('/eventsround.php?id=4829&r=6&s=2026-2027')));
  assert.ok(urls.some((url) => url.includes('/eventsseason.php?id=4829&s=2026-2027')));
  assert.ok(urls.some((url) => url.includes('/eventsnextleague.php?id=4829')));
  assert.ok(urls.some((url) => url.includes('/eventspastleague.php?id=4829')));
  assert.ok(urls.some((url) => url.includes('/eventsday.php?d=2026-10-12&s=Soccer')));
  assert.equal(urls.length, 4 + 6 + 3, 'three rounds + one season + 3 leagues x2 + 3 days');
  assert.ok(urls.every((url) => url.includes('/api/v1/json/123/')), 'the resolved key is in the path');
  assert.ok(urls.every((url) => !url.includes('id=4830')), 'the baseball league id is never requested');
  assert.ok(endpoints.every((e) => ['round', 'season', 'league', 'day'].includes(e.kind)));
});

test('a rejected premium key falls back to the documented free key instead of failing the sync', async () => {
  process.env.THESPORTSDB_API_KEY = 'broken-premium-key';
  const seenKeys: string[] = [];

  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    const key = url.pathname.split('/')[4];
    seenKeys.push(key);
    if (url.pathname.includes('lookupleague.php')) {
      // The provider rejects the premium key with 400 and accepts the free key.
      return key === 'broken-premium-key'
        ? new Response('{"leagues":null}', { status: 400 })
        : Response.json({ leagues: [{ idLeague: THESPORTSDB_LEAGUES.egyptianPremierLeague }] });
    }
    return Response.json({ events: [] });
  });

  const result = await fetchTheSportsDBMatches(['2026-10-12'], { timeoutMs: 1000, retries: 0 });
  assert.ok(seenKeys.includes('broken-premium-key'), 'the operator key is tried first');
  assert.ok(seenKeys.includes('123'), 'and the documented free key is used after rejection');

  const probes = thesportsdbKeyProbeLog();
  assert.equal(probes.length, 2);
  assert.equal(probes[0].ok, false);
  assert.equal(probes[0].error, 'key_rejected');
  assert.equal(probes[1].ok, true);
  assert.equal(probes[1].key.includes('broken-premium-key'), false, 'probe log masks the key');
  assert.ok(result.apiKeyProbes.length >= 1);
});

test('a network failure while probing a key is reported, not silently retried across keys', async () => {
  process.env.THESPORTSDB_API_KEY = 'premium-1';
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    throw new Error('socket hang up');
  });
  await fetchTheSportsDBMatches(['2026-10-12'], { timeoutMs: 500, retries: 0 });
  const probes = thesportsdbKeyProbeLog();
  assert.equal(probes.length, 1);
  assert.equal(probes[0].ok, false);
  assert.ok(calls >= 1);
});

// ---------------------------------------------------------------------------------------------
// 3. SportScore: documented endpoints, legacy base URL, and payload-shape tolerance.
// ---------------------------------------------------------------------------------------------
test('SportScore endpoints are built from the site origin per the published API docs', () => {
  const matches = buildSportscoreMatchEndpoints(50);
  assert.equal(matches[0], 'https://sportscore.com/api/widget/matches/?sport=football&limit=50&src=nemo-live-kora');
  assert.ok(matches.some((url) => url.includes('/api/v1/matches/')), 'the v1 alias is a fallback');
  assert.ok(matches.every((url) => url.startsWith('https://sportscore.com/')));

  assert.equal(
    buildSportscoreFixturesEndpoint('2026-10-12'),
    'https://sportscore.com/api/v1/fixtures/?sport=football&date=2026-10-12&src=nemo-live-kora'
  );
  assert.equal(
    buildSportscoreStandingsEndpoint('egyptian-premier-league'),
    'https://sportscore.com/api/widget/standings/?sport=football&slug=egyptian-premier-league&src=nemo-live-kora'
  );
});

test('the configured base URL never produces a doubled API path', () => {
  // Legacy deployments set SPORTSCORE_BASE_URL to the widget path; the origin is derived from it.
  const configured = SOURCE_ENDPOINTS.sportscoreBase;
  assert.equal(configured.replace(/\/api\/(widget|v1)$/, ''), configured);
  assert.equal(buildSportscoreMatchEndpoints(5)[0].includes('/api/widget/api/widget/'), false);
});

test('all three known SportScore payload shapes are accepted', () => {
  const raw = { home: 'Al Ahly', away: 'Zamalek', time: '2026-10-12T17:00:00Z', competition: 'Egyptian Premier League' };
  assert.equal(extractSportscoreMatchList({ matches: [raw] })?.length, 1);
  assert.equal(extractSportscoreMatchList({ data: { matches: [raw] } })?.length, 1);
  assert.equal(extractSportscoreMatchList([raw])?.length, 1);
  assert.equal(extractSportscoreMatchList({ events: [raw] })?.length, 1);
  assert.equal(extractSportscoreMatchList({ nope: true }), null);
  assert.equal(extractSportscoreMatchList(null), null);
});

test('SportScore falls through to the next documented endpoint when the first one fails', async () => {
  const attempted: string[] = [];
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    attempted.push(url.pathname);
    if (url.pathname === '/api/widget/matches/') {
      return new Response('gateway error', { status: 502 });
    }
    return Response.json({ matches: [{ home: 'Al Ahly', away: 'Zamalek', time: '2026-10-12T17:00:00Z', competition: 'Egyptian Premier League' }] });
  });

  const result = await fetchSportScoreMatches({ timeoutMs: 1000, retries: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.matches.length, 1);
  assert.match(result.endpoint || '', /\/api\/v1\/matches\//);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].ok, false);
  assert.equal(attempted[0], '/api/widget/matches/');
});

// ---------------------------------------------------------------------------------------------
// 4. API-Football: both transports, fixture identity, standings, season maths.
// ---------------------------------------------------------------------------------------------
test('API-Football sends the direct key header, or the RapidAPI pair when configured', () => {
  process.env.API_FOOTBALL_KEY = 'apif-key-123';
  delete process.env.API_FOOTBALL_HOST;
  assert.deepEqual(apiFootballAuthHeaders(), { 'x-apisports-key': 'apif-key-123' });

  process.env.API_FOOTBALL_HOST = 'api-football-v1.p.rapidapi.com';
  assert.deepEqual(apiFootballAuthHeaders(), {
    'x-rapidapi-key': 'apif-key-123',
    'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
  });
});

test('the Egyptian season is the starting year of a July–June season', () => {
  assert.equal(apiFootballSeasonFor('2026-10-12'), 2026);
  assert.equal(apiFootballSeasonFor('2026-07-01'), 2026);
  assert.equal(apiFootballSeasonFor('2026-06-30'), 2025);
});

test('an API-Football fixture maps to the canonical id used by the other sources', () => {
  const record = mapApiFootballFixtureItem({
    fixture: {
      id: 1612250,
      date: '2026-10-11T17:00:00+00:00',
      venue: { name: 'Cairo International Stadium' },
      status: { long: 'Match Finished', short: 'FT', elapsed: 90 },
    },
    league: { id: 302, name: 'Premier League', country: 'Egypt', season: 2026, round: 'Regular Season - 6' },
    teams: {
      home: { id: 758, name: 'Zamalek' },
      away: { id: 757, name: 'al Ahly' },
    },
    goals: { home: 0, away: 2 },
    score: { halftime: { home: 0, away: 1 } },
  });
  assert.ok(record);
  assert.equal(record.id, 'match-api-football-1612250');
  assert.equal(record.externalIds.apiFootballFixtureId, '1612250');
  assert.equal(record.score.home, 0);
  assert.equal(record.score.away, 2);
  assert.equal(record.score.halfTimeAway, 1);
  assert.equal(record.cairoDate, '2026-10-11');
  assert.equal(record.isEgyptianInterest, true);
});

test('an unusable API-Football fixture is dropped alone, not with the whole batch', () => {
  assert.equal(
    mapApiFootballFixtureItem({
      fixture: { id: 1, date: 'not-a-date', status: { long: '', short: 'NS', elapsed: null } },
      league: { id: 1, name: 'x', country: 'y', season: 2026 },
      teams: { home: { id: 1, name: 'a' }, away: { id: 2, name: 'b' } },
      goals: { home: null, away: null },
    }),
    null
  );
});

test('API-Football standings become a canonical table for the Egyptian league', async () => {
  process.env.API_FOOTBALL_KEY = 'apif-key-123';
  mock.method(globalThis, 'fetch', async () =>
    Response.json({
      get: 'standings',
      errors: [],
      results: 1,
      response: [
        {
          league: {
            id: API_FOOTBALL_LEAGUES.egyptPremierLeague,
            name: 'Premier League',
            logo: 'https://media.api-sports.io/football/leagues/302.png',
            season: 2026,
            standings: [
              [
                {
                  rank: 1,
                  team: { id: 757, name: 'al Ahly', logo: 'https://media.api-sports.io/al-ahly.png' },
                  points: 15,
                  goalsDiff: 8,
                  group: 'Regular Season',
                  all: { played: 6, win: 5, draw: 0, lose: 1, goals: { for: 12, against: 4 } },
                  description: 'Promotion - Championship Group',
                },
                {
                  rank: 2,
                  team: { id: 758, name: 'Zamalek', logo: null },
                  points: 13,
                  goalsDiff: 5,
                  group: 'Regular Season',
                  all: { played: 6, win: 4, draw: 1, lose: 1, goals: { for: 10, against: 5 } },
                },
              ],
            ],
          },
        },
      ],
    })
  );

  const table = await fetchApiFootballStandings(API_FOOTBALL_LEAGUES.egyptPremierLeague, 2026);
  assert.ok(table);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0].teamNameAr, 'الأهلي');
  assert.equal(table.rows[0].points, 15);
  assert.equal(table.rows[1].teamNameAr, 'الزمالك');
  assert.equal(table.sourceId, 'api-football');
});

test('API-Football without a key reports the missing key instead of faking a success', async () => {
  delete process.env.API_FOOTBALL_KEY;
  mock.method(globalThis, 'fetch', async () => Response.json({ errors: { token: 'Missing application key' } }));
  const result = await fetchApiFootballSync('2026-10-12');
  assert.equal(result.ok, false);
  assert.equal(result.hasApiKey, false);
  assert.equal(result.errorCode, 'MISSING_API_FOOTBALL_KEY');
  assert.equal(result.status, 'requires_api_key');
  assert.equal(result.matches.length, 0);
  assert.equal(result.standings.length, 0);
});

// ---------------------------------------------------------------------------------------------
// 5. Football-Data.org: competitions without a key, matches and standings with one.
// ---------------------------------------------------------------------------------------------
test('Football-Data reports a keyless run honestly and a match failure as a failure', async () => {
  delete process.env.FOOTBALL_DATA_API_KEY;
  let requested = 0;
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    requested += 1;
    const url = new URL(String(input));
    if (url.pathname.endsWith('/competitions')) {
      return Response.json({
        count: 1,
        competitions: [
          {
            id: 2021,
            name: 'Premier League',
            code: 'PL',
            type: 'LEAGUE',
            emblem: 'https://crests.football-data.org/pl.png',
            area: { name: 'England' },
            currentSeason: { id: 1, startDate: '2026-08-01', endDate: '2027-05-30', currentMatchday: 8 },
          },
        ],
      });
    }
    return new Response('', { status: 403 });
  });

  const result = await fetchFootballDataSync('2026-10-11', '2026-10-13');
  assert.equal(result.hasApiKey, false);
  assert.equal(footballDataKey(), null);
  assert.ok(requested >= 1);
  assert.equal(result.competitions.length, 1);
  assert.equal(result.seasons[0].label, '2026/2027');
  assert.equal(result.status, 'partial_keyless');
  assert.match(result.messageAr, /FOOTBALL_DATA_API_KEY/);
});

test('Football-Data with a key maps matches and does not hide a match-endpoint failure', async () => {
  process.env.FOOTBALL_DATA_API_KEY = 'fd-key-999';
  const headers: Record<string, string> = {};
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    Object.assign(headers, (init?.headers || {}) as Record<string, string>);
    const url = new URL(String(input));
    if (url.pathname.endsWith('/competitions')) return Response.json({ count: 0, competitions: [] });
    return new Response('{"message":"free tier"}', { status: 403 });
  });

  const result = await fetchFootballDataSync('2026-10-11', '2026-10-13');
  assert.equal(headers['X-Auth-Token'], 'fd-key-999');
  assert.equal(result.ok, false);
  assert.equal(result.status, 'degraded');
  assert.match(result.messageAr, /فشل مسار مباريات/);
});
