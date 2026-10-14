import test, { after, afterEach, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  SNAPSHOT_ENVELOPE_VERSION,
  decodeSnapshot,
  describeDurableBackend,
  encodeSnapshot,
  resolveDurableBackend,
} from '../lib/db/durable-store';

const projectRoot = process.cwd();
const environmentKeys = [
  'NEMO_GATEWAY_STORE_PERSIST',
  'NEMO_DURABLE_STORE',
  'NEMO_DURABLE_STORE_URL',
  'NEMO_DURABLE_STORE_TOKEN',
  'NEMO_DURABLE_STORE_KEY',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'VERCEL',
  'VERCEL_ENV',
  'AWS_LAMBDA_FUNCTION_NAME',
  'CRON_SECRET',
  'FOOTBALL_DATA_API_KEY',
  'API_FOOTBALL_KEY',
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

function clearEnvironment() {
  for (const key of environmentKeys) delete process.env[key];
}

afterEach(() => {
  mock.restoreAll();
  clearEnvironment();
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/* -------------------------------------------------------------------------- */
/* Fake durable backends (real HTTP servers, no network stubs)                */
/* -------------------------------------------------------------------------- */

interface FakeRedisOptions {
  /** Simulate a REST proxy that only implements the legacy `GET /get/<key>` path form. */
  pathFormOnly?: boolean;
  /** Every command answers 401 with an error payload. */
  unauthorized?: boolean;
  /** Only `SET` fails, with a 500. */
  failWrites?: boolean;
}

interface FakeServer {
  url: string;
  data: Map<string, string>;
  commands: Array<{ command: string; authorization: string | null }>;
  close: () => Promise<void>;
}

async function listen(server: http.Server): Promise<{ url: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function readRequestBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

/** Minimal Upstash Redis REST emulator: POST command arrays plus the legacy `/get/<key>` form. */
async function startFakeRedis(options: FakeRedisOptions = {}): Promise<FakeServer> {
  const data = new Map<string, string>();
  const commands: FakeServer['commands'] = [];

  function send(response: http.ServerResponse, status: number, payload: unknown) {
    const body = JSON.stringify(payload);
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(body);
  }

  function runCommand(command: string[]): { status: number; payload: unknown } {
    const [name] = command;
    if (name === 'GET') {
      return { status: 200, payload: { result: data.get(command[1]) ?? null } };
    }
    if (name === 'SET') {
      if (options.failWrites) return { status: 500, payload: { error: 'store is read-only' } };
      data.set(command[1], command[2]);
      return { status: 200, payload: { result: 'OK' } };
    }
    return { status: 400, payload: { error: `unknown command ${name}` } };
  }

  const server = http.createServer((request, response) => {
    void (async () => {
      if (options.unauthorized) {
        send(response, 401, { error: 'Unauthorized' });
        return;
      }
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname.startsWith('/get/')) {
        const key = decodeURIComponent(url.pathname.slice('/get/'.length));
        commands.push({ command: 'GET', authorization: request.headers.authorization ?? null });
        send(response, 200, { result: data.get(key) ?? null });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/') {
        if (options.pathFormOnly) {
          send(response, 405, { error: 'method not allowed' });
          return;
        }
        const body = await readRequestBody(request);
        const command = JSON.parse(body) as string[];
        commands.push({ command: command[0], authorization: request.headers.authorization ?? null });
        const { status, payload } = runCommand(command);
        send(response, status, payload);
        return;
      }
      send(response, 404, { error: 'not found' });
    })();
  });

  const { url, close } = await listen(server);
  return { url, data, commands, close };
}

/** Minimal generic HTTP snapshot endpoint: GET when empty → 404, PUT overwrites. */
async function startFakeHttpStore(options: { failWrites?: boolean } = {}): Promise<FakeServer> {
  const data = new Map<string, string>();
  const commands: FakeServer['commands'] = [];
  const server = http.createServer((request, response) => {
    void (async () => {
      commands.push({ command: request.method || '', authorization: request.headers.authorization ?? null });
      if (request.method === 'GET') {
        const value = data.get('snapshot');
        if (!value) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(value);
        return;
      }
      if (request.method === 'PUT') {
        if (options.failWrites) {
          response.writeHead(500);
          response.end('snapshot endpoint unavailable');
          return;
        }
        data.set('snapshot', await readRequestBody(request));
        response.writeHead(201);
        response.end('{"ok":true}');
        return;
      }
      response.writeHead(405);
      response.end();
    })();
  });
  const { url, close } = await listen(server);
  return { url, data, commands, close };
}

/* -------------------------------------------------------------------------- */
/* Snapshot envelope                                                          */
/* -------------------------------------------------------------------------- */

test('snapshot envelope round-trips the database and shrinks the payload', () => {
  const database = {
    meta: { version: 1, siteName: 'NEMO Sports' },
    matches: Array.from({ length: 200 }, (_, index) => ({
      id: `match-${index}`,
      homeTeam: { nameAr: 'الأهلي', nameEn: 'Al Ahly' },
      awayTeam: { nameAr: 'الزمالك', nameEn: 'Zamalek' },
      status: 'finished',
    })),
  };
  const encoded = encodeSnapshot(database, '2026-10-14T00:00:00.000Z');
  const envelope = JSON.parse(encoded) as { v: number; alg: string; bytes: number };
  assert.equal(envelope.v, SNAPSHOT_ENVELOPE_VERSION);
  assert.equal(envelope.alg, 'gzip+base64');
  assert.equal(envelope.bytes, Buffer.byteLength(JSON.stringify(database), 'utf-8'));
  assert.ok(encoded.length < JSON.stringify(database).length, 'compressed envelope must be smaller');

  const decoded = decodeSnapshot(encoded);
  assert.equal(decoded.savedAt, '2026-10-14T00:00:00.000Z');
  assert.deepEqual(decoded.snapshot, database);
});

test('a foreign or corrupted stored value is rejected instead of loaded as the database', () => {
  const invalid = [
    'not json at all',
    '{"v":1}',
    JSON.stringify({ v: 99, alg: 'gzip+base64', data: 'AAAA' }),
    JSON.stringify({ v: SNAPSHOT_ENVELOPE_VERSION, alg: 'gzip+base64', data: 'bm90LWd6aXA=' }),
    JSON.stringify({ meta: {}, matches: [] }),
  ];
  for (const raw of invalid) {
    assert.throws(
      () => decodeSnapshot(raw),
      (error: Error & { code?: string }) => error.code === 'store_snapshot_invalid',
      `expected rejection for ${raw.slice(0, 40)}`
    );
  }
});

/* -------------------------------------------------------------------------- */
/* Backend resolution                                                         */
/* -------------------------------------------------------------------------- */

test('backend detection prefers explicit configuration and never leaks tokens', () => {
  clearEnvironment();
  assert.equal(resolveDurableBackend(), null);

  process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
  process.env.KV_REST_API_TOKEN = 'super-secret-token';
  const redis = resolveDurableBackend();
  assert.equal(redis?.id, 'redis');
  const described = describeDurableBackend();
  assert.equal(described.configured, true);
  assert.equal(described.backendId, 'redis');
  assert.doesNotMatch(JSON.stringify(described), /super-secret-token/);

  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  process.env.NEMO_DURABLE_STORE_URL = 'https://example.test/snapshot';
  assert.equal(resolveDurableBackend()?.id, 'http');

  process.env.NEMO_DURABLE_STORE = 'redis';
  assert.equal(resolveDurableBackend(), null, 'explicit redis selection ignores the HTTP URL');

  process.env.NEMO_DURABLE_STORE = 'off';
  delete process.env.NEMO_DURABLE_STORE_URL;
  process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
  process.env.KV_REST_API_TOKEN = 'token';
  assert.equal(resolveDurableBackend(), null, 'NEMO_DURABLE_STORE=off disables durable storage');
});

/* -------------------------------------------------------------------------- */
/* Adapters against real HTTP servers                                         */
/* -------------------------------------------------------------------------- */

test('redis adapter writes and reads the snapshot through the command form', async () => {
  const server = await startFakeRedis();
  process.env.KV_REST_API_URL = server.url;
  process.env.KV_REST_API_TOKEN = 'test-token';
  const backend = resolveDurableBackend();
  assert.ok(backend);
  try {
    assert.equal(await backend.read(), null, 'an empty store reads as null');
    const payload = encodeSnapshot({ meta: { version: 1 }, matches: [{ id: 'a' }] });
    await backend.write(payload);
    assert.equal(await backend.read(), payload);
    assert.ok(server.commands.some((entry) => entry.command === 'SET'));
    assert.equal(server.commands[0].authorization, 'Bearer test-token');
  } finally {
    await server.close();
  }
});

test('redis adapter falls back to the legacy path form', async () => {
  const server = await startFakeRedis({ pathFormOnly: true });
  process.env.KV_REST_API_URL = server.url;
  process.env.KV_REST_API_TOKEN = 'test-token';
  const backend = resolveDurableBackend();
  assert.ok(backend);
  try {
    server.data.set('nemo-live-kora:gateway-store', 'stored-value');
    assert.equal(await backend.read(), 'stored-value');
  } finally {
    await server.close();
  }
});

test('redis adapter reports failures as store codes instead of throwing raw errors', async () => {
  const unauthorized = await startFakeRedis({ unauthorized: true });
  process.env.KV_REST_API_URL = unauthorized.url;
  process.env.KV_REST_API_TOKEN = 'wrong-token';
  const unauthorizedBackend = resolveDurableBackend();
  assert.ok(unauthorizedBackend);
  await assert.rejects(
    () => unauthorizedBackend.read(),
    (error: Error & { code?: string }) => error.code === 'store_read_failed'
  );
  await unauthorized.close();

  const readOnly = await startFakeRedis({ failWrites: true });
  process.env.KV_REST_API_URL = readOnly.url;
  const readOnlyBackend = resolveDurableBackend();
  assert.ok(readOnlyBackend);
  await assert.rejects(
    () => readOnlyBackend.write('payload'),
    (error: Error & { code?: string }) => error.code === 'store_write_failed'
  );
  await readOnly.close();
});

test('generic HTTP adapter reads 404 as an empty store and writes with the bearer token', async () => {
  const server = await startFakeHttpStore();
  process.env.NEMO_DURABLE_STORE_URL = server.url;
  process.env.NEMO_DURABLE_STORE_TOKEN = 'http-token';
  const backend = resolveDurableBackend();
  assert.ok(backend);
  try {
    assert.equal(await backend.read(), null);
    await backend.write('{"hello":"world"}');
    assert.equal(await backend.read(), '{"hello":"world"}');
    assert.equal(server.commands.at(-1)?.authorization, 'Bearer http-token');
  } finally {
    await server.close();
  }
});

test('generic HTTP adapter surfaces a failed write', async () => {
  const server = await startFakeHttpStore({ failWrites: true });
  process.env.NEMO_DURABLE_STORE_URL = server.url;
  const backend = resolveDurableBackend();
  assert.ok(backend);
  try {
    await assert.rejects(
      () => backend.write('{"hello":"world"}'),
      (error: Error & { code?: string }) => error.code === 'store_write_failed'
    );
  } finally {
    await server.close();
  }
});

/* -------------------------------------------------------------------------- */
/* Store integration: hydration, durable flush, clobber protection           */
/* -------------------------------------------------------------------------- */

let store: typeof import('../lib/db/store');
let workspace: string;

before(async () => {
  // Import the store after changing cwd so an accidental file write stays in a disposable copy.
  const cacheDirectory = path.join(projectRoot, '.cache');
  fs.mkdirSync(cacheDirectory, { recursive: true });
  workspace = fs.mkdtempSync(path.join(cacheDirectory, 'durable-store-test-'));
  process.chdir(workspace);
  store = await import('../lib/db/store');
});

after(() => {
  process.chdir(projectRoot);
  if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  clearEnvironment();
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'off';
  store.resetStoreStateForTests();
});

test('a serverless process without a backend never claims durability', () => {
  process.env.VERCEL = '1';
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  // The write itself can locally succeed inside the lambda and still not be shared storage.
  store.persistGatewayDatabase(store.getGatewayDatabase());
  const persistence = store.getPersistenceState();
  assert.equal(persistence.mode, 'file');
  assert.equal(persistence.ok, true);
  assert.equal(persistence.durable, false, 'a lambda-local file is not shared storage');
  assert.equal(persistence.durableConfigured, false);
  assert.equal(store.isServerlessRuntime(), true);
  assert.equal(store.getDurableStoreStatus().configured, false);
});

test('a persistent host reports the local file as durable', () => {
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  store.persistGatewayDatabase(store.getGatewayDatabase());
  const persistence = store.getPersistenceState();
  assert.equal(persistence.mode, 'file');
  assert.equal(persistence.ok, true);
  assert.equal(persistence.durable, true);
  assert.equal(store.getDurableStoreStatus().serverless, false);
});

test('hydrate → mutate → flush → hydrate again keeps the data across instances', async () => {
  const server = await startFakeRedis();
  process.env.KV_REST_API_URL = server.url;
  process.env.KV_REST_API_TOKEN = 'test-token';
  try {
    assert.equal(store.getPersistenceState().durable, true);
    assert.equal(store.getPersistenceState().ok, false, 'nothing confirmed yet');

    // Writing before the remote snapshot was read is refused: it could clobber newer production data.
    const refused = await store.flushDurableStore({ force: true });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, 'store_not_hydrated');
    assert.equal(server.data.size, 0);

    const hydrated = await store.hydrateGatewayDatabase();
    assert.equal(hydrated.ok, true);

    const database = store.getGatewayDatabase();
    // A distinct fixture: migration dedupes by stable id *and* by team/date key, so the marker has
    // to be its own match to survive the round trip.
    const markerId = 'match-durable-round-trip';
    const template = database.matches[0];
    database.matches = [
      ...database.matches,
      {
        ...template,
        id: markerId,
        externalIds: {},
        competitionCode: 'durable-store-check',
        utcKickoff: '2026-10-14T18:00:00.000Z',
        cairoDate: '2026-10-14',
        homeTeam: { ...template.homeTeam, id: 'durable-home', nameEn: 'Durable Home', nameAr: 'ديورابل هوم' },
        awayTeam: { ...template.awayTeam, id: 'durable-away', nameEn: 'Durable Away', nameAr: 'ديورابل أواي' },
      },
    ];
    store.persistGatewayDatabase(database);

    const flushed = await store.flushDurableStore({ force: true });
    assert.equal(flushed.ok, true);
    assert.equal(flushed.mode, 'redis');
    assert.equal(flushed.durable, true);
    assert.ok(flushed.at, 'a confirmed write records a timestamp');

    const stored = server.data.get('nemo-live-kora:gateway-store');
    assert.ok(stored, 'the snapshot reached the backend');
    const { snapshot } = decodeSnapshot(stored);
    assert.ok(
      (snapshot as { matches: Array<{ id: string }> }).matches.some((match) => match.id === markerId)
    );

    // A brand new instance (cold start) adopts the shared snapshot instead of its bundled copy.
    store.resetStoreStateForTests();
    const secondInstance = await store.hydrateGatewayDatabase();
    assert.equal(secondInstance.ok, true);
    assert.ok(
      store.getGatewayDatabase().matches.some((match) => match.id === markerId),
      'the next instance reads the data written by the first one'
    );
  } finally {
    await server.close();
  }
});

test('a corrupt stored snapshot is rejected and production data stays untouched', async () => {
  const server = await startFakeRedis();
  process.env.KV_REST_API_URL = server.url;
  process.env.KV_REST_API_TOKEN = 'test-token';
  try {
    server.data.set('nemo-live-kora:gateway-store', '{"meta":{},"matches":[]}');
    const before = store.getGatewayDatabase().matches.length;
    const hydrated = await store.hydrateGatewayDatabase();
    assert.equal(hydrated.ok, false);
    assert.equal(hydrated.error, 'store_snapshot_invalid');
    assert.equal(store.getGatewayDatabase().matches.length, before, 'the local snapshot is kept');

    // Not hydrated ⇒ the corrupted remote value must never be overwritten blindly.
    const flushed = await store.flushDurableStore({ force: true });
    assert.equal(flushed.ok, false);
    assert.equal(flushed.error, 'store_not_hydrated');
    assert.equal(server.data.get('nemo-live-kora:gateway-store'), '{"meta":{},"matches":[]}');
  } finally {
    await server.close();
  }
});

test('an unreachable backend is reported as a failed write, not as success', async () => {
  const server = await startFakeRedis();
  process.env.KV_REST_API_URL = server.url;
  process.env.KV_REST_API_TOKEN = 'test-token';
  const backend = resolveDurableBackend();
  assert.ok(backend);
  await store.hydrateGatewayDatabase();
  await server.close();

  store.persistGatewayDatabase(store.getGatewayDatabase());
  const flushed = await store.flushDurableStore({ force: true });
  assert.equal(flushed.ok, false);
  assert.equal(flushed.durable, true);
  assert.equal(flushed.error, 'store_write_failed');
});

/* -------------------------------------------------------------------------- */
/* Endpoint contract                                                          */
/* -------------------------------------------------------------------------- */

const sourceMatch = {
  home: 'Durable Store Test Home',
  away: 'Durable Store Test Away',
  home_score: 2,
  away_score: 2,
  status: 'finished',
  time: '2026-10-12T17:00:00Z',
  competition: 'Egyptian Premier League',
};

/** Provider stubs only; anything aimed at the fake durable backend reaches the real server. */
function stubProviders(realFetch: typeof fetch) {
  return mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.includes('127.0.0.1')) return realFetch(input, init);
    if (url.includes('ceid=')) return new Response('<rss><channel></channel></rss>');
    // Match SportScore by endpoint path: the gateway self-identifies with ?src=, which is not part
    // of the provider's contract and has changed value over time.
    const isMatchesEndpoint = url.includes('/api/widget/matches') || url.includes('/api/v1/matches');
    return Response.json({
      matches: isMatchesEndpoint ? [sourceMatch] : [],
      events: [],
      competitions: [],
      tables: [],
      errors: { token: 'Missing application key' },
    });
  });
}

test('public GET returns 200 only after the snapshot reached the durable backend', async () => {
  const server = await startFakeRedis();
  process.env.KV_REST_API_URL = server.url;
  process.env.KV_REST_API_TOKEN = 'test-token';
  process.env.VERCEL = '1';
  store.resetStoreStateForTests();
  const realFetch = globalThis.fetch;
  const stub = stubProviders(realFetch);
  try {
    const route = await import('../app/api/cron/update-matches/route');
    const response = await route.GET();
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.ok, true);
    assert.equal(body.persistence.mode, 'redis');
    assert.equal(body.persistence.durable, true);
    assert.equal(body.durableStorageRequired, true);
    assert.equal(body.storageReason, undefined);
    assert.ok(server.data.get('nemo-live-kora:gateway-store'), 'the sync landed in shared storage');
  } finally {
    stub.mock.restore();
    await server.close();
  }
});

test('public GET answers 503 with a self-diagnosing reason when no durable store exists', async () => {
  process.env.VERCEL = '1';
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'off';
  store.resetStoreStateForTests();
  const realFetch = globalThis.fetch;
  const stub = stubProviders(realFetch);
  try {
    const route = await import('../app/api/cron/update-matches/route');
    const response = await route.GET();
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.persistence.durable, false);
    assert.equal(body.persistence.durableConfigured, false);
    assert.match(body.storageReason, /KV_REST_API_URL/);
  } finally {
    stub.mock.restore();
  }
});
