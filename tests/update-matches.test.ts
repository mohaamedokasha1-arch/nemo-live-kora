import test, { after, afterEach, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { clearHttpCache } from '../lib/sources/http-client';
import type { GatewayDatabase } from '../lib/types';

const projectRoot = process.cwd();
const environmentKeys = [
  'NEMO_GATEWAY_STORE_PERSIST',
  'CRON_SECRET',
  'FOOTBALL_DATA_API_KEY',
  'API_FOOTBALL_KEY',
  'VERCEL',
  'VERCEL_ENV',
] as const;
const originalEnvironment = new Map(
  environmentKeys.map((key) => [key, process.env[key]])
);
const sourceMatch = {
  home: 'Scheduler Test Home',
  away: 'Scheduler Test Away',
  home_score: 1,
  away_score: 0,
  status: 'finished',
  time: '2026-10-12T17:00:00Z',
  competition: 'Egyptian Premier League',
};

let workspace: string;
let route: typeof import('../app/api/cron/update-matches/route');
let store: typeof import('../lib/db/store');
let initialDatabase: GatewayDatabase;

before(async () => {
  // Import the store after changing cwd so real pipeline writes stay in a disposable copy.
  const cacheDirectory = path.join(projectRoot, '.cache');
  fs.mkdirSync(cacheDirectory, { recursive: true });
  workspace = fs.mkdtempSync(path.join(cacheDirectory, 'update-matches-test-'));
  fs.mkdirSync(path.join(workspace, 'data'));
  fs.copyFileSync(
    path.join(projectRoot, 'data/gateway-store.json'),
    path.join(workspace, 'data/gateway-store.json')
  );
  process.chdir(workspace);
  route = await import('../app/api/cron/update-matches/route');
  store = await import('../lib/db/store');
  initialDatabase = structuredClone(store.getGatewayDatabase());
});

beforeEach(async () => {
  for (const key of environmentKeys) delete process.env[key];
  // These tests assert the real write to the disposable workspace copy, so persistence is on here
  // (npm test turns it off for every other file). The route is public by design and must work with
  // no cron secret at all.
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  assert.equal(process.env.CRON_SECRET, undefined);
  await store.persistGatewayDatabase(structuredClone(initialDatabase));

  // Exercise the real sync pipeline without contacting third-party services.
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.searchParams.has('ceid')) {
      return new Response('<rss><channel></channel></rss>');
    }
    // Simulate SportScore by endpoint path: the gateway tries several documented routes and
    // self-identifies with ?src=, which is not part of the provider's contract.
    const isMatchesEndpoint =
      url.pathname.includes('/api/widget/matches') || url.pathname.includes('/api/v1/matches');
    return Response.json({
      matches: isMatchesEndpoint ? [sourceMatch] : [],
      events: [],
      competitions: [],
      tables: [],
      errors: { token: 'Missing application key' },
    });
  });
});

afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

after(() => {
  process.chdir(projectRoot);
  if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
});

async function assertVisitingUpdatesMatches(response: NextResponse) {
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.ok, true);
  assert.equal(body.result.matchesFetched > 0, true);
  assert.equal(body.persistence.ok, true);
  // The write is verified by reading it back from the backend, not just asserted.
  assert.equal(body.storageRoundTrip.ok, true);
  assert.equal(body.storageRoundTrip.matchesReadBack > 0, true);

  const db = store.getGatewayDatabase();
  const match = db.matches.find((entry) => entry.homeTeam.nameEn === sourceMatch.home);
  assert.ok(match);
  assert.equal(match.score.home, 1);
  assert.equal(match.score.away, 0);
  assert.equal(db.syncLogs[0].trigger, 'API /api/cron/update-matches (live)');

  const persisted = JSON.parse(
    fs.readFileSync(path.join(workspace, 'data/gateway-store.json'), 'utf-8')
  ) as GatewayDatabase;
  assert.ok(persisted.matches.some((entry) => entry.id === match.id));
}

test('Daily Vercel cron is configured for the update-matches route', () => {
  const configPath = path.join(projectRoot, 'vercel.json');
  assert.equal(fs.existsSync(configPath), true);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  assert.equal(config.crons.length, 1);
  assert.equal(config.crons[0].path, '/api/cron/update-matches');
  assert.equal(config.crons[0].schedule, '0 5 * * *');
  assert.equal(
    fs.existsSync(path.join(projectRoot, 'app/api/cron/update-matches/route.ts')),
    true
  );
  assert.equal(route.dynamic, 'force-dynamic');
  assert.equal(route.runtime, 'nodejs');
});

test('Unauthenticated GET persists fetched matches and reports counts', async () => {
  await assertVisitingUpdatesMatches(await route.GET());
});

test('Unauthenticated POST also updates matches and replies {"status":"ok"}', async () => {
  await assertVisitingUpdatesMatches(await route.POST());
});

test('a degraded sync is a 503, never a green cron log', async () => {
  // No source returns matches: the route must not claim success. The cache must be emptied first,
  // because the tests above cached a successful SportScore response and the HTTP client would
  // serve it from memory inside its TTL without ever calling the mock.
  clearHttpCache();
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.searchParams.has('ceid')) return new Response('<rss><channel></channel></rss>');
    return Response.json({ matches: [], events: [], competitions: [], tables: [] });
  });

  const response = await route.GET();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, 'degraded');
  assert.equal(body.result.matchesFetched, 0);
  // Previous data is preserved rather than wiped by a failed fetch.
  const db = store.getGatewayDatabase();
  assert.equal(db.matches.length >= initialDatabase.matches.length, true);
});

test('an undurable backend is a 503 even when sources returned matches', async () => {
  // A lambda-local disk is not shared, durable storage; success must not be reported.
  process.env.VERCEL = '1';
  const response = await route.GET();
  const body = await response.json();
  assert.equal(body.storageRoundTrip.durable, false);
  assert.equal(body.ok, false);
  assert.equal(response.status, 503);
});
