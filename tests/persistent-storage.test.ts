import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorageDriver } from '../lib/storage/file-driver';
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
// 7. The store that actually serves the request path: lib/db/store.ts over lib/db/durable-store.ts.
//    These run against a real local HTTP snapshot endpoint, so they prove a genuine read-back
//    rather than a mock agreeing with itself. lib/storage/ above is migration/audit tooling.
// ---------------------------------------------------------------------------------------------

import http from 'node:http';

/** A real snapshot endpoint: GET returns the stored payload, PUT overwrites it. */
async function startSnapshotServer(): Promise<{ url: string; close: () => Promise<void>; get: () => string | null; hits: () => number }> {
  let stored: string | null = null;
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (req.method === 'GET') {
      if (stored === null) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(stored);
      return;
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        stored = Buffer.concat(chunks).toString('utf-8');
        res.writeHead(204).end();
      });
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/snapshot`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    get: () => stored,
    hits: () => hits,
  };
}

async function withDurableBackend<T>(url: string, run: () => Promise<T>): Promise<T> {
  const previous = {
    url: process.env.NEMO_DURABLE_STORE_URL,
    token: process.env.NEMO_DURABLE_STORE_TOKEN,
    selector: process.env.NEMO_DURABLE_STORE,
    persist: process.env.NEMO_GATEWAY_STORE_PERSIST,
    skip: process.env.NEMO_SKIP_STORE_HYDRATION,
  };
  process.env.NEMO_DURABLE_STORE_URL = url;
  process.env.NEMO_DURABLE_STORE = 'http';
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  delete process.env.NEMO_DURABLE_STORE_TOKEN;
  delete process.env.NEMO_SKIP_STORE_HYDRATION;
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries({
      NEMO_DURABLE_STORE_URL: previous.url,
      NEMO_DURABLE_STORE_TOKEN: previous.token,
      NEMO_DURABLE_STORE: previous.selector,
      NEMO_GATEWAY_STORE_PERSIST: previous.persist,
      NEMO_SKIP_STORE_HYDRATION: previous.skip,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('with no durable backend configured the round trip says so instead of claiming durability', async () => {
  for (const key of ['NEMO_DURABLE_STORE_URL', 'KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']) delete process.env[key];
  const storeModule = await import('../lib/db/store');
  storeModule.resetStoreForTesting();

  const roundTrip = await storeModule.verifyStorageRoundTrip();
  assert.equal(roundTrip.ok, false);
  assert.equal(roundTrip.error, 'no_durable_backend');
  assert.equal(roundTrip.matchesReadBack, 0);
  // This is the value the cron gate reads: nothing shared means no success may be reported.
  assert.equal(storeModule.getPersistenceState().durableConfigured, false);

  storeModule.resetStoreForTesting();
});

test('hydrateStore adopts the shared snapshot, so a cold instance serves what the cron wrote', async () => {
  const server = await startSnapshotServer();
  const storeModule = await import('../lib/db/store');
  try {
    // Instance A writes its snapshot to the shared endpoint. Production always adopts the remote
    // state first (ensureFreshMatches -> hydrateGatewayDatabase), and the store refuses to push a
    // snapshot from an instance that never read the shared copy.
    await withDurableBackend(server.url, async () => {
      storeModule.resetStoreForTesting();
      await storeModule.hydrateGatewayDatabase();
      const database = makeDatabase();
      storeModule.persistGatewayDatabase(database);
      const state = await storeModule.flushDurableStore({ force: true });
      assert.equal(state.ok, true, `flush reported: ${state.error}`);
      assert.equal(state.durable, true);
    });
    assert.ok(server.get(), 'the snapshot reached the endpoint');

    // Instance B boots empty (as a cold lambda does) and must adopt the shared copy.
    await withDurableBackend(server.url, async () => {
      storeModule.resetStoreForTesting();
      const hydrated = await storeModule.hydrateStore();
      assert.equal(hydrated.matches.length > 0, true);
      assert.equal(storeModule.getDurableStoreStatus().hydrated, true);

      const roundTrip = await storeModule.verifyStorageRoundTrip();
      assert.equal(roundTrip.ok, true);
      assert.equal(roundTrip.durable, true);
      assert.equal(roundTrip.matchesReadBack, hydrated.matches.length);
      assert.equal(roundTrip.error, null);
    });
  } finally {
    storeModule.resetStoreForTesting();
    await server.close();
  }
});

test('an unhydrated instance refuses to overwrite newer shared data', async () => {
  const server = await startSnapshotServer();
  const storeModule = await import('../lib/db/store');
  try {
    await withDurableBackend(server.url, async () => {
      storeModule.resetStoreForTesting();
      const before = server.get();
      const state = await storeModule.flushDurableStore({ force: true });
      assert.equal(state.ok, false);
      assert.equal(state.error, 'store_not_hydrated');
      assert.equal(server.get(), before, 'the shared snapshot was left untouched');
    });
  } finally {
    storeModule.resetStoreForTesting();
    await server.close();
  }
});

test('a snapshot endpoint that fails its read is reported, not swallowed', async () => {
  const server = await startSnapshotServer();
  const storeModule = await import('../lib/db/store');
  try {
    await withDurableBackend('http://127.0.0.1:1/snapshot', async () => {
      storeModule.resetStoreForTesting();
      const roundTrip = await storeModule.verifyStorageRoundTrip();
      assert.equal(roundTrip.ok, false);
      assert.equal(roundTrip.matchesReadBack, 0);
      assert.ok(roundTrip.error, 'the failure carries a reason');
    });
  } finally {
    storeModule.resetStoreForTesting();
    await server.close();
  }
});

test('a corrupted value in the store is rejected instead of loaded as the database', async () => {
  const server = await startSnapshotServer();
  const storeModule = await import('../lib/db/store');
  try {
    // Seed a valid snapshot, then corrupt it behind the store's back.
    await withDurableBackend(server.url, async () => {
      storeModule.resetStoreForTesting();
      await storeModule.hydrateGatewayDatabase();
      storeModule.persistGatewayDatabase(makeDatabase());
      await storeModule.flushDurableStore({ force: true });
    });
    await new Promise<void>((resolve, reject) => {
      const req = http.request(server.url, { method: 'PUT' }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end('not-a-snapshot');
    });

    await withDurableBackend(server.url, async () => {
      storeModule.resetStoreForTesting();
      const roundTrip = await storeModule.verifyStorageRoundTrip();
      assert.equal(roundTrip.ok, false);
      assert.equal(roundTrip.error, 'store_snapshot_invalid');
    });
  } finally {
    storeModule.resetStoreForTesting();
    await server.close();
  }
});
