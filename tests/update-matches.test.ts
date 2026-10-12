import test, { after, afterEach, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import type { GatewayDatabase } from '../lib/types';

const projectRoot = process.cwd();
const apiUrl = 'https://gateway.example/api/cron/update-matches';
const testSecret = 'update-matches-test-secret';
const environmentKeys = [
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

beforeEach(() => {
  for (const key of environmentKeys) delete process.env[key];
  process.env.CRON_SECRET = testSecret;
  store.persistGatewayDatabase(structuredClone(initialDatabase));

  // Exercise the real sync pipeline without contacting third-party services.
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.searchParams.has('ceid')) {
      return new Response('<rss><channel></channel></rss>');
    }
    return Response.json({
      matches: url.searchParams.get('src') === 'nemo-sports' ? [sourceMatch] : [],
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

function authorizedRequest(method: 'GET' | 'POST', query = '', body?: string) {
  return new NextRequest(`${apiUrl}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${testSecret}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

async function assertSuccessfulUpdate(response: NextResponse, mode: string) {
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.success, true);
  assert.equal(body.mode, mode);
  assert.equal(body.matchesAdded, 1);
  assert.equal(body.matchesChanged, 0);
  assert.equal(body.matchesUpdated, 1);
  assert.equal(body.updatedMatches, 1);
  assert.equal(body.matchesProcessed, 1);
  assert.equal(body.totalMatches, initialDatabase.matches.length + 1);
  assert.equal(body.sources.length, 5);

  const db = store.getGatewayDatabase();
  const match = db.matches.find((entry) => entry.homeTeam.nameEn === sourceMatch.home);
  assert.ok(match);
  assert.equal(match.score.home, 1);
  assert.equal(match.score.away, 0);
  assert.equal(db.syncLogs[0].trigger, `API /api/cron/update-matches (${mode})`);
  assert.equal(db.syncLogs[0].mode, mode);

  const persisted = JSON.parse(
    fs.readFileSync(path.join(workspace, 'data/gateway-store.json'), 'utf-8')
  ) as GatewayDatabase;
  assert.ok(persisted.matches.some((entry) => entry.id === match.id));
}

test('Vercel cron configuration is removed while the update route remains', () => {
  assert.equal(fs.existsSync(path.join(projectRoot, 'vercel.json')), false);
  assert.equal(
    fs.existsSync(path.join(projectRoot, 'app/api/cron/update-matches/route.ts')),
    true
  );
  assert.equal(route.dynamic, 'force-dynamic');
  assert.equal(route.runtime, 'nodejs');
});

const unauthorizedCases: Array<{ name: string; headers: Record<string, string> }> = [
  { name: 'missing authorization', headers: {} },
  { name: 'incorrect secret', headers: { Authorization: 'Bearer incorrect-secret' } },
  { name: 'non-Bearer authorization', headers: { Authorization: `Basic ${testSecret}` } },
  {
    name: 'Vercel cron headers without a secret',
    headers: { 'x-vercel-cron': '1', 'User-Agent': 'vercel-cron/1.0' },
  },
];

for (const method of ['GET', 'POST'] as const) {
  for (const { name, headers } of unauthorizedCases) {
    test(`${method} rejects ${name} without starting the pipeline`, async () => {
      const fetchCalls = mock.method(globalThis, 'fetch');
      const response = await route[method](new NextRequest(apiUrl, { method, headers }));
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer realm="cron"');
      const body = await response.json();
      assert.equal(body.success, false);
      assert.equal(body.error, 'Unauthorized');
      assert.equal(fetchCalls.mock.callCount(), 0);
      assert.deepEqual(store.getGatewayDatabase().syncLogs, initialDatabase.syncLogs);
    });
  }
}

for (const secret of [undefined, '   ']) {
  test(`Missing or blank server secret (${String(secret)}) keeps the endpoint closed`, async () => {
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
    const response = await route.GET(authorizedRequest('GET'));
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error, 'CRON_SECRET is not configured on the server');
    assert.deepEqual(store.getGatewayDatabase().syncLogs, initialDatabase.syncLogs);
  });
}

test('Authenticated GET updates and persists matches without any Vercel environment or cron headers', async () => {
  assert.equal(process.env.VERCEL, undefined);
  assert.equal(process.env.VERCEL_ENV, undefined);
  await assertSuccessfulUpdate(await route.GET(authorizedRequest('GET')), 'live');
});

test('GET accepts the update mode from the query string', async () => {
  await assertSuccessfulUpdate(
    await route.GET(authorizedRequest('GET', '?mode=standings')),
    'standings'
  );
});

test('POST with an empty body accepts the update mode from the query string', async () => {
  await assertSuccessfulUpdate(
    await route.POST(authorizedRequest('POST', '?mode=daily')),
    'daily'
  );
});

test('POST JSON mode takes precedence over the query string', async () => {
  await assertSuccessfulUpdate(
    await route.POST(authorizedRequest('POST', '?mode=daily', '{"mode":"manual"}')),
    'manual'
  );
});

test('POST with invalid JSON falls back to the query string', async () => {
  await assertSuccessfulUpdate(
    await route.POST(authorizedRequest('POST', '?mode=daily', 'not-json')),
    'daily'
  );
});

test('Unsupported update mode falls back to live', async () => {
  await assertSuccessfulUpdate(
    await route.GET(authorizedRequest('GET', '?mode=unsupported')),
    'live'
  );
});
