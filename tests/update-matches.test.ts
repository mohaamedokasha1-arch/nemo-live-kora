import test, { after, afterEach, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { clearHttpCache } from '../lib/sources/http-client';
import type { GatewayDatabase } from '../lib/types';

const projectRoot = process.cwd();
const environmentKeys = [
  'NEMO_GATEWAY_STORE_PERSIST',
  'NEMO_DATA_DIR',
  'CRON_SECRET',
  'NEMO_INGEST_TOKEN',
  'FOOTBALL_DATA_API_KEY',
  'API_FOOTBALL_KEY',
  'VERCEL',
  'VERCEL_ENV',
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const sourceMatch = {
  home: 'Scheduler Test Home',
  away: 'Scheduler Test Away',
  home_score: 1,
  away_score: 0,
  status: 'finished',
  time: '2026-10-12T17:00:00Z',
  competition: 'Egyptian Premier League',
};

/** Captured before any mock is installed. */
const realFetch = globalThis.fetch;

let dataDir: string;
let route: typeof import('../app/api/cron/update-matches/route');
let store: typeof import('../lib/db/store');
let initialDatabase: GatewayDatabase;

before(async () => {
  // The local store writes to NEMO_DATA_DIR, so the committed data/ snapshot is never touched.
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nemo-update-matches-'));
  route = await import('../app/api/cron/update-matches/route');
  store = await import('../lib/db/store');
  initialDatabase = structuredClone(store.getGatewayDatabase());
});

beforeEach(async () => {
  for (const key of environmentKeys) delete process.env[key];
  process.env.NEMO_DATA_DIR = dataDir;
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  assert.equal(process.env.CRON_SECRET, undefined, 'the route is public and needs no cron secret');
  store.resetStoreStateForTests();
  await store.hydrateGatewayDatabase();
  store.persistGatewayDatabase(structuredClone(initialDatabase));

  // Exercise the real sync pipeline without contacting third-party services.
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.includes('127.0.0.1')) return realFetch(input, init);
    if (url.includes('ceid=')) return new Response('<rss><channel></channel></rss>');
    // Match SportScore by endpoint path: the gateway self-identifies with ?src=, which is not part
    // of the provider's contract.
    const isMatchesEndpoint = url.includes('/api/widget/matches') || url.includes('/api/v1/matches');
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
  clearHttpCache();
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(path.join(os.tmpdir(), 'nemo-gateway'), { recursive: true, force: true });
});

async function assertVisitingUpdatesMatches(response: NextResponse) {
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.ok, true);
  assert.equal(body.syncOk, true);
  assert.equal(body.result.matchesFetched > 0, true);
  assert.equal(body.persistence.ok, true);
  assert.equal(body.persistence.durable, true);
  assert.equal(body.persistence.mode, 'file');
  assert.deepEqual(body.warnings, []);
  // The snapshot reached the local document, so a cold instance can serve what this run wrote.
  assert.ok(fs.existsSync(path.join(dataDir, 'gateway-store.json')), 'the sync reached the store file');

  const db = store.getGatewayDatabase();
  const match = db.matches.find((entry) => entry.homeTeam.nameEn === sourceMatch.home);
  assert.ok(match);
  assert.equal(match.score.home, 1);
  assert.equal(match.score.away, 0);
  assert.equal(db.syncLogs[0].trigger, 'API /api/cron/update-matches (live)');
}

test('Daily Vercel cron is configured for the update-matches route', () => {
  const configPath = path.join(projectRoot, 'vercel.json');
  assert.equal(fs.existsSync(configPath), true);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  // جدولان يوميان (خطة Vercel المجانية تسمح بمهمتين يوميًا لكلٍّ موعد واحد):
  // مزامنة كاملة صباحًا (مباريات + كل مجموعات الأخبار المجانية)، وتحديث مباشر مساءً.
  assert.equal(config.crons.length, 2);
  assert.equal(config.crons[0].path, '/api/cron/sync');
  assert.equal(config.crons[0].schedule, '0 5 * * *');
  assert.equal(config.crons[1].path, '/api/cron/update-matches');
  assert.equal(config.crons[1].schedule, '0 16 * * *');
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

test('a degraded sync is HTTP 200 with ok:true and an explicit degraded status', async () => {
  // No source returns matches: the status must not claim success. The cache must be emptied first,
  // because an earlier test cached a successful SportScore response.
  clearHttpCache();
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.includes('127.0.0.1')) return realFetch(input, init);
    if (url.includes('ceid=')) return new Response('<rss><channel></channel></rss>');
    return Response.json({ matches: [], events: [], competitions: [], tables: [] });
  });

  const response = await route.GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'degraded');
  assert.equal(body.syncOk, false);
  assert.equal(body.result.matchesFetched, 0);
  assert.ok(body.warnings.length > 0);
  // Previous data is preserved rather than wiped by a failed fetch.
  const db = store.getGatewayDatabase();
  assert.equal(db.matches.length >= initialDatabase.matches.length, true);
});

test('a successful sync on serverless is ok:true but says the storage is warm-instance only', async () => {
  process.env.VERCEL = '1';
  store.resetStoreStateForTests();
  clearHttpCache();

  const response = await route.GET();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.syncOk, true);
  assert.equal(body.durable, false);
  assert.ok(
    body.warnings.some((warning: string) => warning.includes('/tmp')),
    'the non-durable state is disclosed, not hidden'
  );
});
