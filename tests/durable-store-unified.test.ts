import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  decodeStoredSnapshot,
  encodeSnapshot,
  resolveDurableBackend,
} from '../lib/db/durable-store';
import * as store from '../lib/db/store';
import { selectStorageDriver } from '../lib/storage';
import type { GatewayDatabase } from '../lib/types';

const projectRoot = process.cwd();
const environmentKeys = [
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'LIBSQL_URL',
  'LIBSQL_AUTH_TOKEN',
  'BLOB_READ_WRITE_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'NEMO_DURABLE_STORE',
  'NEMO_DURABLE_STORE_URL',
  'NEMO_DURABLE_STORE_TOKEN',
  'NEMO_DURABLE_STORE_KEY',
  'NEMO_STORAGE_DRIVER',
  'VERCEL',
  'VERCEL_ENV',
  'NEMO_GATEWAY_STORE_PERSIST',
  'NEMO_DATA_DIR',
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
  store.resetStoreStateForTests();
});

function loadDatabase(): GatewayDatabase {
  return JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'data/gateway-store.json'), 'utf-8')
  ) as GatewayDatabase;
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

/* -------------------------------------------------------------------------- */
/* Selector unification                                                        */
/* -------------------------------------------------------------------------- */

test('either selector configures the same durable backend', () => {
  clearEnvironment();
  process.env.TURSO_DATABASE_URL = 'libsql://nemo.turso.io';
  process.env.TURSO_AUTH_TOKEN = 'turso-token';
  assert.equal(resolveDurableBackend()?.id, 'turso', 'auto-detection finds Turso');

  process.env.NEMO_STORAGE_DRIVER = 'turso';
  assert.equal(resolveDurableBackend()?.id, 'turso', 'NEMO_STORAGE_DRIVER drives the live path');

  clearEnvironment();
  process.env.KV_REST_API_URL = 'https://kv.upstash.io';
  process.env.KV_REST_API_TOKEN = 'kv-token';
  process.env.NEMO_DURABLE_STORE = 'redis';
  assert.equal(resolveDurableBackend()?.id, 'redis');

  clearEnvironment();
  process.env.BLOB_READ_WRITE_TOKEN = 'blob-token';
  assert.equal(resolveDurableBackend()?.id, 'blob', 'Vercel Blob is a live backend, not tooling only');

  clearEnvironment();
  process.env.TURSO_DATABASE_URL = 'https://nemo.turso.io';
  process.env.TURSO_AUTH_TOKEN = 'turso-token';
  process.env.NEMO_DURABLE_STORE = 'http';
  process.env.NEMO_DURABLE_STORE_URL = 'https://example.test/snapshot';
  assert.equal(resolveDurableBackend()?.id, 'http', 'the explicit durable selector wins');

  // The lib/storage selection now agrees with the durable layer about the HTTP backend.
  const selection = selectStorageDriver();
  assert.equal(selection.driver.kind, 'http');
  assert.equal(selection.cloudConfigured, true);
  assert.equal(selection.driver.isDurable(), true);
});

test('stored snapshots decode in both the envelope and the legacy raw format', () => {
  const database = loadDatabase();
  const envelope = encodeSnapshot(database);
  assert.deepEqual(decodeStoredSnapshot(envelope).snapshot, database);

  const raw = JSON.stringify(database);
  assert.deepEqual(decodeStoredSnapshot(raw).snapshot, database, 'lib/storage raw documents are adopted');

  for (const invalid of ['{"meta":{},"matches":[]}', 'not json', '{"hello":"world"}']) {
    assert.throws(
      () => decodeStoredSnapshot(invalid),
      (error: Error & { code?: string }) => error.code === 'store_snapshot_invalid',
      `expected rejection for ${invalid.slice(0, 30)}`
    );
  }
});

/* -------------------------------------------------------------------------- */
/* Turso / libSQL backend against a real HTTP pipeline emulator                */
/* -------------------------------------------------------------------------- */

interface FakeTurso {
  url: string;
  kv: Map<string, string>;
  documents: Map<string, string>;
  close: () => Promise<void>;
}

async function startFakeTurso(): Promise<FakeTurso> {
  const kv = new Map<string, string>();
  const documents = new Map<string, string>();
  const server = http.createServer((request, response) => {
    void (async () => {
      const body = JSON.parse(await readBody(request)) as {
        requests: Array<{ stmt: { sql: string; args?: Array<{ value: string | number | null }> } }>;
      };
      const results = body.requests.map(({ stmt }) => {
        const sql = stmt.sql;
        const arg = (index: number) => stmt.args?.[index]?.value ?? null;
        let rows: unknown[][] = [];
        if (/INSERT INTO nemo_kv_store/i.test(sql)) {
          kv.set(String(arg(0)), String(arg(1)));
        } else if (/INSERT INTO gateway_documents/i.test(sql)) {
          documents.set(String(arg(0)), String(arg(1)));
        } else if (/SELECT value FROM nemo_kv_store/i.test(sql)) {
          const value = kv.get(String(arg(0)));
          rows = value === undefined ? [] : [[{ type: 'text', value }]];
        } else if (/SELECT payload FROM gateway_documents/i.test(sql)) {
          const value = documents.get(String(arg(0)));
          rows = value === undefined ? [] : [[{ type: 'text', value }]];
        }
        return { type: 'ok', response: { type: 'execute', result: { cols: [], rows } } };
      });
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ results }));
    })();
  });
  const url = await listen(server);
  return { url, kv, documents, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test('turso backend writes the envelope and mirrors the raw document', async () => {
  clearEnvironment();
  const turso = await startFakeTurso();
  process.env.TURSO_DATABASE_URL = turso.url;
  process.env.TURSO_AUTH_TOKEN = 'test-token';
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'off';
  try {
    const backend = resolveDurableBackend();
    assert.equal(backend?.id, 'turso');
    assert.equal(await backend!.read(), null, 'an empty database reads as null');

    const payload = encodeSnapshot(loadDatabase());
    await backend!.write(payload);
    assert.equal(await backend!.read(), payload);
    assert.equal(turso.kv.get('nemo-live-kora:gateway-store'), payload);

    const mirrored = turso.documents.get('gateway');
    assert.ok(mirrored, 'gateway_documents holds the raw mirror for SQL tooling');
    assert.equal(JSON.parse(mirrored!).matches.length, loadDatabase().matches.length);
  } finally {
    await turso.close();
  }
});

test('store round-trips through Turso across a cold start', async () => {
  clearEnvironment();
  const turso = await startFakeTurso();
  process.env.TURSO_DATABASE_URL = turso.url;
  process.env.TURSO_AUTH_TOKEN = 'test-token';
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'off';
  try {
    store.resetStoreStateForTests();
    await store.hydrateGatewayDatabase();
    const database = store.getGatewayDatabase();
    const template = database.matches[0];
    database.matches = [
      ...database.matches,
      {
        ...template,
        id: 'match-turso-round-trip',
        externalIds: {},
        competitionCode: 'turso-check',
        utcKickoff: '2026-10-14T18:00:00.000Z',
        cairoDate: '2026-10-14',
        homeTeam: { ...template.homeTeam, id: 'turso-home', nameEn: 'Turso Home', nameAr: 'تورسو هوم' },
        awayTeam: { ...template.awayTeam, id: 'turso-away', nameEn: 'Turso Away', nameAr: 'تورسو أواي' },
      },
    ];
    store.persistGatewayDatabase(database);
    const flushed = await store.flushDurableStore({ force: true });
    assert.equal(flushed.ok, true, `flush reported: ${flushed.error}`);
    assert.equal(flushed.mode, 'turso');
    assert.equal(flushed.durable, true);

    store.resetStoreStateForTests();
    const hydrated = await store.hydrateGatewayDatabase();
    assert.equal(hydrated.ok, true);
    assert.ok(store.getGatewayDatabase().matches.some((match) => match.id === 'match-turso-round-trip'));
  } finally {
    store.resetStoreStateForTests();
    await turso.close();
  }
});

/* -------------------------------------------------------------------------- */
/* Vercel Blob backend (global fetch intercepted at the Blob API)              */
/* -------------------------------------------------------------------------- */

test('blob backend stores the snapshot at a deterministic pathname', async () => {
  clearEnvironment();
  process.env.BLOB_READ_WRITE_TOKEN = 'blob-token';
  let stored: string | null = null;
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PUT') {
      stored = String(init.body);
      return new Response(JSON.stringify({ url: 'https://blob.test/x', pathname: 'nemo-gateway/gateway-store.json' }), { status: 200 });
    }
    if (url.includes('blob.vercel-storage.com?')) {
      return Response.json({ blobs: stored ? [{ url: 'https://blob.test/download', pathname: 'nemo-gateway/gateway-store.json' }] : [] });
    }
    return new Response(stored ?? '', { status: 200 });
  });

  const backend = resolveDurableBackend();
  assert.equal(backend?.id, 'blob');
  assert.equal(await backend!.read(), null);
  const payload = encodeSnapshot(loadDatabase());
  await backend!.write(payload);
  assert.equal(stored, payload);
  assert.equal(await backend!.read(), payload);
});

/* -------------------------------------------------------------------------- */
/* Serverless local file: writable temp JSON, no bundle write, no error spam   */
/* -------------------------------------------------------------------------- */

test('on serverless the local JSON goes to the writable temp dir and is never claimed durable', async () => {
  clearEnvironment();
  process.env.VERCEL = '1';
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });

  store.resetStoreStateForTests();
  const database = store.getGatewayDatabase();
  store.persistGatewayDatabase(database);

  const localFile = store.resolveLocalStoreFile();
  assert.ok(localFile.startsWith(os.tmpdir()), `writable snapshot lives outside the bundle: ${localFile}`);
  assert.equal(fs.existsSync(localFile), true, 'the structured JSON file was written');
  const onDisk = JSON.parse(fs.readFileSync(localFile, 'utf-8')) as GatewayDatabase;
  assert.equal(onDisk.matches.length, database.matches.length);

  const persistence = store.getPersistenceState();
  assert.equal(persistence.mode, 'file');
  assert.equal(persistence.ok, true);
  assert.equal(persistence.durable, false, 'a lambda temp file is a cache, not shared storage');
  assert.equal(persistence.durableConfigured, false);
  assert.equal(
    errors.some((line) => line.includes('memory-only') || line.includes('store_write_failed')),
    false,
    `no memory-only error spam in logs: ${errors.join(' | ')}`
  );
});

/* -------------------------------------------------------------------------- */
/* Flush drains mutations that raced an in-flight write                        */
/* -------------------------------------------------------------------------- */

test('an awaited flush includes mutations that arrived while it was writing', async () => {
  clearEnvironment();
  const data = new Map<string, string>();
  let setCount = 0;
  const server = http.createServer((request, response) => {
    void (async () => {
      const command = JSON.parse(await readBody(request)) as string[];
      if (command[0] === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ result: data.get(command[1]) ?? null }));
        return;
      }
      if (command[0] === 'SET') {
        setCount += 1;
        if (setCount === 1) await new Promise((resolve) => setTimeout(resolve, 90));
        data.set(command[1], command[2]);
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ result: 'OK' }));
        return;
      }
      response.writeHead(400).end();
    })();
  });
  const url = await listen(server);
  process.env.KV_REST_API_URL = url;
  process.env.KV_REST_API_TOKEN = 'test-token';
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'off';
  try {
    store.resetStoreStateForTests();
    await store.hydrateGatewayDatabase();
    const database = store.getGatewayDatabase();
    const template = database.matches[0];
    const marker = (id: string) => ({
      ...template,
      id,
      externalIds: {},
      competitionCode: 'flush-race-check',
      utcKickoff: '2026-10-14T18:00:00.000Z',
      cairoDate: '2026-10-14',
      homeTeam: { ...template.homeTeam, id: `${id}-home`, nameEn: `${id} Home`, nameAr: 'هوم' },
      awayTeam: { ...template.awayTeam, id: `${id}-away`, nameEn: `${id} Away`, nameAr: 'أواي' },
    });
    database.matches = [...database.matches, marker('match-flush-first')];
    store.persistGatewayDatabase(database);

    const flushing = store.flushDurableStore({ force: true });
    // Land a second mutation while the first SET is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const during = store.getGatewayDatabase();
    during.matches = [...during.matches, marker('match-flush-second')];
    store.persistGatewayDatabase(during);

    const flushed = await flushing;
    assert.equal(flushed.ok, true, `flush reported: ${flushed.error}`);
    const stored = data.get('nemo-live-kora:gateway-store');
    assert.ok(stored);
    const { snapshot } = decodeStoredSnapshot(stored!);
    const ids = (snapshot as GatewayDatabase).matches.map((match) => match.id);
    assert.ok(ids.includes('match-flush-first'));
    assert.ok(ids.includes('match-flush-second'), 'the raced mutation reached the backend before the flush resolved');
  } finally {
    store.resetStoreStateForTests();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
