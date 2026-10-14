import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorageDriver, MemoryStorageDriver } from '../lib/storage/file-driver';
import { TursoStorageDriver } from '../lib/storage/turso-driver';
import { UpstashStorageDriver } from '../lib/storage/upstash-driver';
import { VercelBlobStorageDriver } from '../lib/storage/vercel-blob-driver';
import { describeStorage, selectStorageDriver, setStorageDriverForTesting } from '../lib/storage';
import type { FetchLike } from '../lib/storage/types';
import type { GatewayDatabase } from '../lib/types';

const PROJECT_ROOT = process.cwd();

/** Builds a minimal but shape-valid GatewayDatabase for driver tests. */
function makeDatabase(overrides: Partial<GatewayDatabase> = {}): GatewayDatabase {
  const base = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'data/gateway-store.json'), 'utf-8')
  ) as GatewayDatabase;
  return { ...base, ...overrides };
}

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

afterEach(() => {
  setStorageDriverForTesting(null);
  for (const key of [
    'NEMO_STORAGE_DRIVER',
    'TURSO_DATABASE_URL',
    'TURSO_AUTH_TOKEN',
    'LIBSQL_URL',
    'LIBSQL_AUTH_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
    'BLOB_READ_WRITE_TOKEN',
    'VERCEL',
    'NEMO_STORAGE_FILE_DURABLE',
    'NEMO_DATA_DIR',
  ]) {
    delete process.env[key];
  }
});

// ---------------------------------------------------------------------------------------------
// 1. File driver: atomic writes, real read-back, and an honest durability flag.
// ---------------------------------------------------------------------------------------------
test('file driver writes atomically and reads the same document back', async () => {
  const dir = tempDir('nemo-file-driver-');
  const driver = new FileStorageDriver({ dir });
  const database = makeDatabase();

  const write = await driver.write(database);
  assert.equal(write.ok, true);
  assert.ok(write.bytes > 1000, 'a real document was serialised');

  const read = await driver.read();
  assert.equal(read.ok, true);
  assert.equal(read.database?.matches.length, database.matches.length);
  assert.equal(read.database?.meta.schemaVersion, database.meta.schemaVersion);

  // No temp files left behind, and the payload is pretty-printed JSON.
  const leftovers = fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
  const raw = fs.readFileSync(path.join(dir, 'gateway-store.json'), 'utf-8');
  assert.deepEqual(JSON.parse(raw).meta.gatewayName, database.meta.gatewayName);
});

test('file driver reports durable=false on a serverless host and true on a real server', async () => {
  const dir = tempDir('nemo-file-durable-');
  process.env.VERCEL = '1';
  assert.equal(new FileStorageDriver({ dir }).isDurable(), false);
  delete process.env.VERCEL;
  assert.equal(new FileStorageDriver({ dir }).isDurable(), true);
  process.env.NEMO_STORAGE_FILE_DURABLE = 'true';
  process.env.VERCEL = '1';
  assert.equal(new FileStorageDriver({ dir }).isDurable(), true, 'explicit volume mount overrides');
});

test('file driver ping distinguishes writable from read-only storage', async () => {
  const dir = tempDir('nemo-file-ping-');
  const ping = await new FileStorageDriver({ dir }).ping();
  assert.equal(ping.ok, true);
  assert.match(ping.detail, /writable/);
});

// ---------------------------------------------------------------------------------------------
// 2. Turso/libSQL driver: schema, document upsert, structured mirror, and read-back.
// ---------------------------------------------------------------------------------------------
interface CapturedRequest {
  url: string;
  body: { requests: Array<{ stmt: { sql: string; args?: unknown[] } }> };
}

function tursoHarness(rows: unknown[][] = []) {
  const captured: CapturedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as CapturedRequest['body'];
    captured.push({ url, body });
    const hasSelect = body.requests.some((r) => /select/i.test(r.stmt.sql));
    const payload = hasSelect
      ? { results: body.requests.map(() => ({ type: 'rows', rows })) }
      : { results: body.requests.map(() => ({ type: 'ok' })) };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    };
  };
  return { fetchImpl, captured };
}

test('turso driver creates its schema and upserts the document in one pipeline', async () => {
  const { fetchImpl, captured } = tursoHarness();
  const driver = new TursoStorageDriver({
    url: 'https://nemo-gateway.turso.io/',
    token: 'secret-token',
    fetchImpl,
  });

  assert.equal(driver.isDurable(), true);
  assert.equal(driver.describe().target, 'nemo-gateway.turso.io');

  const database = makeDatabase();
  const write = await driver.write(database);
  assert.equal(write.ok, true);
  assert.ok(write.bytes > 1000);
  assert.equal(write.mirror.matches, database.matches.length);
  assert.equal(write.mirror.news, database.news.length);
  assert.ok(write.mirror.standings >= 1);

  const schemaCall = captured[0];
  assert.match(schemaCall.url, /^https:\/\/nemo-gateway\.turso\.io\/v2\/pipeline$/);
  assert.equal(schemaCall.body.requests[0].stmt.sql.includes('CREATE TABLE IF NOT EXISTS gateway_documents'), true);

  const documentCall = captured.find((call) =>
    call.body.requests.some((r) => r.stmt.sql.includes('INSERT INTO gateway_documents'))
  );
  assert.ok(documentCall, 'the document upsert ran');
  const documentStatement = documentCall.body.requests[0];
  assert.match(documentStatement.stmt.sql, /ON CONFLICT\(id\) DO UPDATE/);
  assert.equal((documentStatement.stmt.args?.[0] as { value: string }).value, 'gateway');

  const mirrorCall = captured.find((call) =>
    call.body.requests.some((r) => r.stmt.sql.includes('INSERT INTO gateway_matches'))
  );
  assert.ok(mirrorCall, 'the structured match mirror ran');
  assert.ok(
    captured.some((call) => call.body.requests.some((r) => r.stmt.sql.includes('INSERT INTO gateway_news'))),
    'the news mirror ran'
  );
  assert.ok(
    captured.some((call) => call.body.requests.some((r) => r.stmt.sql.includes('INSERT INTO gateway_standings'))),
    'the standings mirror ran'
  );
  // Upsert + sweep, never a bulk DELETE that could wipe rows mid-refresh.
  assert.equal(
    captured.some((call) => call.body.requests.some((r) => /^DELETE FROM gateway_matches$/.test(r.stmt.sql.trim()))),
    false
  );
});

test('turso driver never sends the auth token in the request body', async () => {
  const { fetchImpl, captured } = tursoHarness();
  const driver = new TursoStorageDriver({
    url: 'https://nemo-gateway.turso.io',
    token: 'super-secret-token',
    fetchImpl,
  });
  await driver.write(makeDatabase());
  for (const call of captured) {
    assert.equal(JSON.stringify(call.body).includes('super-secret-token'), false);
  }
});

test('turso driver reads back a stored document and rejects a corrupted payload', async () => {
  const database = makeDatabase();
  const payload = JSON.stringify(database);
  const good = tursoHarness([[{ type: 'text', value: payload }]]);
  const goodDriver = new TursoStorageDriver({ url: 'https://x.turso.io', token: 't', fetchImpl: good.fetchImpl });
  const read = await goodDriver.read();
  assert.equal(read.ok, true);
  assert.equal(read.database?.matches.length, database.matches.length);

  const corrupt = tursoHarness([[{ type: 'text', value: '{"meta":' }]]);
  const corruptDriver = new TursoStorageDriver({ url: 'https://x.turso.io', token: 't', fetchImpl: corrupt.fetchImpl });
  const corruptRead = await corruptDriver.read();
  assert.equal(corruptRead.ok, false);
  assert.equal(corruptRead.error, 'payload_not_json');

  const wrongShape = tursoHarness([[{ type: 'text', value: '{"hello":"world"}' }]]);
  const wrongDriver = new TursoStorageDriver({ url: 'https://x.turso.io', token: 't', fetchImpl: wrongShape.fetchImpl });
  const wrongRead = await wrongDriver.read();
  assert.equal(wrongRead.ok, false);
  assert.equal(wrongRead.error, 'invalid_shape');
});

test('turso driver surfaces a provider error instead of reporting a silent success', async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: false,
    status: 401,
    text: async () => 'unauthorized',
    json: async () => ({}),
  });
  const driver = new TursoStorageDriver({ url: 'https://x.turso.io', token: 'bad', fetchImpl });
  const write = await driver.write(makeDatabase());
  assert.equal(write.ok, false);
  assert.match(String(write.error), /401/);
});

// ---------------------------------------------------------------------------------------------
// 3. Upstash Redis driver.
// ---------------------------------------------------------------------------------------------
test('upstash driver stores the document under one key and pings the server', async () => {
  const store = new Map<string, string>();
  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/ping') return { ok: true, status: 200, text: async () => '{"result":"PONG"}', json: async () => ({ result: 'PONG' }) };
    if (u.pathname.startsWith('/set')) {
      const [key, value] = JSON.parse(String(init?.body)) as [string, string];
      store.set(key, value);
      return { ok: true, status: 200, text: async () => '{"result":"OK"}', json: async () => ({ result: 'OK' }) };
    }
    if (u.pathname.startsWith('/get')) {
      const key = decodeURIComponent(u.pathname.slice('/get/'.length));
      return { ok: true, status: 200, text: async () => JSON.stringify({ result: store.get(key) ?? null }), json: async () => ({ result: store.get(key) ?? null }) };
    }
    return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
  };
  const driver = new UpstashStorageDriver({ url: 'https://eu1.upstash.io/', token: 'tok', fetchImpl });
  assert.equal(driver.isDurable(), true);

  const ping = await driver.ping();
  assert.equal(ping.ok, true);

  const database = makeDatabase();
  const write = await driver.write(database);
  assert.equal(write.ok, true);
  assert.ok(store.has('nemo:gateway'));
  assert.ok(store.has('nemo:gateway:mirror'));

  const read = await driver.read();
  assert.equal(read.ok, true);
  assert.equal(read.database?.matches.length, database.matches.length);
});

// ---------------------------------------------------------------------------------------------
// 4. Vercel Blob driver.
// ---------------------------------------------------------------------------------------------
test('vercel blob driver puts a deterministic object and reads it back', async () => {
  let stored: string | null = null;
  const fetchImpl: FetchLike = async (url, init) => {
    if (init?.method === 'PUT') {
      stored = String(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ url: 'https://blob/x', pathname: 'nemo-gateway/gateway-store.json' }), json: async () => ({}) };
    }
    if (url.includes('?prefix=')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ blobs: stored ? [{ url: 'https://blob/download', pathname: 'nemo-gateway/gateway-store.json' }] : [] }),
        json: async () => ({}),
      };
    }
    return { ok: true, status: 200, text: async () => stored || '', json: async () => ({}) };
  };
  const driver = new VercelBlobStorageDriver({ token: 'blobtok', fetchImpl });
  assert.equal(driver.isDurable(), true);

  const database = makeDatabase();
  const write = await driver.write(database);
  assert.equal(write.ok, true);
  assert.ok(stored);

  const read = await driver.read();
  assert.equal(read.ok, true);
  assert.equal(read.database?.matches.length, database.matches.length);
});

// ---------------------------------------------------------------------------------------------
// 5. Backend selection: explicit override → detected cloud → local file.
// ---------------------------------------------------------------------------------------------
test('storage selection prefers a detected cloud backend and falls back to the local file', () => {
  const local = selectStorageDriver();
  assert.equal(local.driver.kind, 'file');
  assert.equal(local.cloudConfigured, false);
  assert.ok(local.missingForCloud.includes('TURSO_DATABASE_URL'));

  process.env.TURSO_DATABASE_URL = 'https://nemo.turso.io';
  process.env.TURSO_AUTH_TOKEN = 'token';
  const turso = selectStorageDriver();
  assert.equal(turso.driver.kind, 'turso');
  assert.equal(turso.cloudConfigured, true);
  assert.equal(turso.driver.isDurable(), true);

  process.env.NEMO_STORAGE_DRIVER = 'memory';
  assert.equal(selectStorageDriver().driver.kind, 'memory');

  process.env.NEMO_STORAGE_DRIVER = 'upstash';
  const misconfigured = selectStorageDriver();
  assert.equal(misconfigured.driver.kind, 'file', 'a requested backend without credentials falls back');
  assert.match(misconfigured.reason, /not configured/);
});

test('describeStorage never leaks a secret', () => {
  process.env.TURSO_DATABASE_URL = 'https://nemo-gateway.turso.io';
  process.env.TURSO_AUTH_TOKEN = 'this-is-a-secret-token';
  setStorageDriverForTesting(null);
  const description = describeStorage();
  assert.equal(JSON.stringify(description).includes('this-is-a-secret-token'), false);
  assert.equal(description.kind, 'turso');
  assert.equal(description.durable, true);
});

// ---------------------------------------------------------------------------------------------
// 6. Store hydration: a write by one "process" is what the next reader sees.
// ---------------------------------------------------------------------------------------------
function withPersistenceOn(body: () => Promise<void>): Promise<void> {
  const previous = process.env.NEMO_GATEWAY_STORE_PERSIST;
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  return body().finally(() => {
    if (previous === undefined) delete process.env.NEMO_GATEWAY_STORE_PERSIST;
    else process.env.NEMO_GATEWAY_STORE_PERSIST = previous;
  });
}

test('the store hydrates from the driver, so a cron write survives a cold start', async () => {
  const driver = new MemoryStorageDriver();
  setStorageDriverForTesting(driver);
  const storeModule = await import('../lib/db/store');
  storeModule.resetStoreForTesting();
  await withPersistenceOn(async () => {

  const database = makeDatabase();
  await storeModule.persistGatewayDatabase(database);
  assert.equal(driver.writes.length, 1);

  // Simulate a cold start: forget the in-memory copy and hydrate from the backend.
  storeModule.resetStoreForTesting();
  const hydrated = await storeModule.hydrateStore();
  assert.equal(hydrated.matches.length, database.matches.length);
  assert.equal(storeModule.getPersistenceState().hydrated, true);

  const roundTrip = await storeModule.verifyStorageRoundTrip();
  assert.equal(roundTrip.ok, true);
  assert.equal(roundTrip.matchesReadBack, database.matches.length);
  });

  storeModule.resetStoreForTesting();
  setStorageDriverForTesting(null);
});

test('hydration seeds an empty cloud store from the committed snapshot', async () => {
  const driver = new MemoryStorageDriver();
  setStorageDriverForTesting(driver);
  const storeModule = await import('../lib/db/store');
  storeModule.resetStoreForTesting();

  await withPersistenceOn(async () => {
    const hydrated = await storeModule.hydrateStore();
    assert.ok(hydrated.matches.length > 0, 'the committed snapshot seeded the empty store');
    assert.equal(driver.writes.length, 1, 'and was written back so the next cold start is fast');
  });

  storeModule.resetStoreForTesting();
  setStorageDriverForTesting(null);
});

test('persistence off means the state says so instead of pretending to be durable', async () => {
  const driver = new MemoryStorageDriver();
  setStorageDriverForTesting(driver);
  const previous = process.env.NEMO_GATEWAY_STORE_PERSIST;
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'off';
  try {
    const storeModule = await import('../lib/db/store');
    storeModule.resetStoreForTesting();
    const state = await storeModule.persistGatewayDatabase(makeDatabase());
    assert.equal(state.ok, false);
    assert.equal(state.durable, false);
    assert.equal(state.error, 'persistence_disabled');
    assert.equal(driver.writes.length, 0);
    storeModule.resetStoreForTesting();
  } finally {
    if (previous === undefined) delete process.env.NEMO_GATEWAY_STORE_PERSIST;
    else process.env.NEMO_GATEWAY_STORE_PERSIST = previous;
    setStorageDriverForTesting(null);
  }
});

// ---------------------------------------------------------------------------------------------
// 7. A failing backend must not be reported as success by the cron endpoint.
// ---------------------------------------------------------------------------------------------
test('a backend that fails its write makes the matches cron return 503', async () => {
  const failing: FetchLike = async () => ({ ok: false, status: 500, text: async () => 'boom', json: async () => ({}) });
  const driver = new TursoStorageDriver({ url: 'https://broken.turso.io', token: 't', fetchImpl: failing });
  setStorageDriverForTesting(driver);
  const storeModule = await import('../lib/db/store');
  storeModule.resetStoreForTesting();
  const roundTrip = await storeModule.verifyStorageRoundTrip();
  assert.equal(roundTrip.ok, false);
  assert.equal(roundTrip.matchesReadBack, 0);
  storeModule.resetStoreForTesting();
  setStorageDriverForTesting(null);
});
