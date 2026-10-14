import test, { after, afterEach, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { clearHttpCache } from '../lib/sources/http-client';
import type { GatewayDatabase } from '../lib/types';

const projectRoot = process.cwd();
const environmentKeys = [
  'NEMO_GATEWAY_STORE_PERSIST',
  'NEMO_DURABLE_STORE',
  'NEMO_DURABLE_STORE_URL',
  'NEMO_DURABLE_STORE_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'CRON_SECRET',
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

/** Captured before any mock is installed: the snapshot server must be reachable for real. */
const realFetch = globalThis.fetch;

let workspace: string;
let route: typeof import('../app/api/cron/update-matches/route');
let store: typeof import('../lib/db/store');
let initialDatabase: GatewayDatabase;

/** A real snapshot endpoint (GET returns, PUT overwrites) standing in for shared storage. */
let snapshot: { stored: string | null };
let snapshotServer: http.Server;
let snapshotUrl: string;

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

  snapshot = { stored: null };
  snapshotServer = http.createServer((req, res) => {
    if (req.method === 'GET') {
      if (snapshot.stored === null) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(snapshot.stored);
      return;
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        snapshot.stored = Buffer.concat(chunks).toString('utf-8');
        res.writeHead(204).end();
      });
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise<void>((resolve) => snapshotServer.listen(0, '127.0.0.1', resolve));
  const address = snapshotServer.address();
  snapshotUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/snapshot`;

  route = await import('../app/api/cron/update-matches/route');
  store = await import('../lib/db/store');
  initialDatabase = structuredClone(store.getGatewayDatabase());
});

beforeEach(async () => {
  for (const key of environmentKeys) delete process.env[key];
  // The route only reports success once the snapshot reached shared storage, so every case here
  // runs against the local snapshot endpoint. NEMO_GATEWAY_STORE_PERSIST stays at its npm test
  // default (off) for the local file; the durable backend is what is under test.
  process.env.NEMO_DURABLE_STORE = 'http';
  process.env.NEMO_DURABLE_STORE_URL = snapshotUrl;
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  assert.equal(process.env.CRON_SECRET, undefined, 'the route is public and needs no cron secret');
  snapshot.stored = null;
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

after(async () => {
  process.chdir(projectRoot);
  if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
  await new Promise<void>((resolve) => snapshotServer.close(() => resolve()));
});

async function assertVisitingUpdatesMatches(response: NextResponse) {
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.ok, true);
  assert.equal(body.result.matchesFetched > 0, true);
  assert.equal(body.persistence.ok, true);
  assert.equal(body.persistence.durable, true);
  assert.equal(body.persistence.mode, 'http');
  // The snapshot is in shared storage, so a cold instance can serve what this run wrote.
  assert.ok(snapshot.stored, 'the sync reached shared storage');

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
  // because an earlier test cached a successful SportScore response and the HTTP client would
  // serve it from memory inside its TTL without ever calling the mock.
  clearHttpCache();
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.includes('127.0.0.1')) return realFetch(input, init);
    if (url.includes('ceid=')) return new Response('<rss><channel></channel></rss>');
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

test('a successful sync without shared storage is still a 503', async () => {
  // Sources return matches, but nothing durable is configured: reporting success here would mean
  // the data dies with this instance.
  delete process.env.NEMO_DURABLE_STORE;
  delete process.env.NEMO_DURABLE_STORE_URL;
  process.env.VERCEL = '1';
  store.resetStoreStateForTests();
  clearHttpCache();

  const response = await route.GET();
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.persistence.durableConfigured, false);
  assert.ok(body.storageReason, 'the response explains what to configure');
});
