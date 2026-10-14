import test, { after, afterEach, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { writeFileAtomic } from '../lib/db/atomic-file';
import {
  decodeStoredSnapshot,
  describeDurableBackend,
  encodeSnapshot,
  resolveDurableBackend,
  resolveLocalStoreFile,
} from '../lib/db/durable-store';
import * as store from '../lib/db/store';
import { FileStorageDriver, describeStorage, selectStorageDriver } from '../lib/storage';
import { clearHttpCache } from '../lib/sources/http-client';
import { GET as updateMatchesGET, POST as updateMatchesPOST } from '../app/api/cron/update-matches/route';
import { GET as syncGET } from '../app/api/cron/sync/route';
import { GET as syncNewsGET } from '../app/api/cron/sync-news/route';
import { GET as healthGET } from '../app/api/health/route';

/**
 * The store is one local structured-JSON document. These tests run it against a temporary directory
 * (never the committed data/ snapshot) and check: atomic replacement, no configuration needed,
 * warm-instance honesty on serverless, corrupt-file recovery, cold-start adoption, and the cron
 * response contract (HTTP 200 with ok:true even when the sync or the storage fails).
 */

const environmentKeys = [
  'NEMO_GATEWAY_STORE_PERSIST',
  'NEMO_DATA_DIR',
  'NEMO_STORAGE_FILE_DURABLE',
  'VERCEL',
  'VERCEL_ENV',
  'AWS_LAMBDA_FUNCTION_NAME',
  'NETLIFY',
  'CRON_SECRET',
  'NEMO_INGEST_TOKEN',
  'FOOTBALL_DATA_API_KEY',
  'API_FOOTBALL_KEY',
  'NEMO_STORAGE_DRIVER',
  'NEMO_DURABLE_STORE',
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const realFetch = globalThis.fetch;
let dataDir: string;

function setEnvironment(overrides: Record<string, string | undefined>) {
  for (const key of environmentKeys) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function freshDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nemo-local-store-'));
}

before(() => {
  dataDir = freshDataDir();
});

beforeEach(() => {
  store.resetStoreStateForTests();
  clearHttpCache();
  setEnvironment({ NEMO_GATEWAY_STORE_PERSIST: 'on', NEMO_DATA_DIR: dataDir });
});

afterEach(() => {
  mock.restoreAll();
  store.resetStoreStateForTests();
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  // Serverless-path test writes under the OS temp dir; remove only what it created.
  fs.rmSync(path.join(os.tmpdir(), 'nemo-gateway'), { recursive: true, force: true });
});

function failEveryProvider() {
  clearHttpCache();
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.includes('127.0.0.1')) return realFetch(input, init);
    return new Response('Unavailable', { status: 503 });
  });
}

/* ------------------------------ atomic writes ------------------------------ */

test('atomic write replaces the whole document and leaves no temporary files behind', () => {
  const file = path.join(dataDir, 'atomic', 'doc.json');
  writeFileAtomic(file, JSON.stringify({ version: 1, payload: 'x'.repeat(100_000) }));
  writeFileAtomic(file, JSON.stringify({ version: 2 }));

  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), { version: 2 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['doc.json']);
});

test('a failed atomic write keeps the previous document intact', () => {
  const file = path.join(dataDir, 'atomic-fail', 'doc.json');
  writeFileAtomic(file, JSON.stringify({ version: 1 }));

  mock.method(fs, 'renameSync', () => {
    throw new Error('simulated crash before rename');
  });
  assert.throws(() => writeFileAtomic(file, JSON.stringify({ version: 2 })), /simulated crash/);
  mock.restoreAll();

  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), { version: 1 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['doc.json'], 'temporary file was cleaned up');
});

/* ----------------------------- zero configuration --------------------------- */

test('the store is active with no environment variables at all', () => {
  setEnvironment({ NEMO_DATA_DIR: dataDir });
  const backend = resolveDurableBackend();
  assert.ok(backend, 'a local backend always exists');
  assert.equal(backend.id, 'file');
  assert.equal(describeDurableBackend().configured, true);
  assert.equal(describeDurableBackend().reason, null);
});

test('persistence is off only when explicitly disabled', () => {
  setEnvironment({ NEMO_GATEWAY_STORE_PERSIST: 'off' });
  assert.equal(resolveDurableBackend(), null);
});

test('no external store is selectable: the storage selection is always the local file', () => {
  setEnvironment({ NEMO_DATA_DIR: dataDir, NEMO_STORAGE_DRIVER: 'turso', NEMO_DURABLE_STORE: 'redis' });
  const selection = selectStorageDriver();
  assert.ok(selection.driver instanceof FileStorageDriver);
  assert.equal(selection.cloudConfigured, false);
  assert.deepEqual(selection.missingForCloud, []);
  assert.equal(describeStorage().kind, 'file');
});

test('the default location is the runtime-resolved one, and serverless uses the temp directory', () => {
  setEnvironment({});
  assert.equal(resolveLocalStoreFile(), path.join(process.cwd(), 'data', 'gateway-store.json'));
  setEnvironment({ VERCEL: '1' });
  assert.equal(resolveLocalStoreFile(), path.join(os.tmpdir(), 'nemo-gateway', 'gateway-store.json'));
});

test('on serverless the snapshot is reported as warm-instance storage, never as durable', async () => {
  setEnvironment({ VERCEL: '1' });
  const hydrated = await store.hydrateGatewayDatabase();
  assert.equal(hydrated.ok, true);
  store.persistGatewayDatabase(store.getGatewayDatabase());
  const flushed = await store.flushDurableStore({ force: true });
  assert.equal(flushed.ok, true, 'the local write succeeds');
  assert.equal(flushed.durable, false, 'but /tmp is not shared storage');
  assert.ok(fs.existsSync(path.join(os.tmpdir(), 'nemo-gateway', 'gateway-store.json')));
});

/* ------------------------------ document format ----------------------------- */

test('a complete database round-trips through the document format', () => {
  const database = store.getGatewayDatabase();
  const { snapshot } = decodeStoredSnapshot(encodeSnapshot(database));
  assert.deepEqual(snapshot, database);
});

test('truncated, foreign or incomplete documents are rejected instead of loaded', () => {
  const database = store.getGatewayDatabase();
  const valid = encodeSnapshot(database);
  for (const raw of [valid.slice(0, 500), '{"meta":{},"matches":[]}', '{"v":1,"alg":"gzip+base64","data":"AAAA"}']) {
    assert.throws(() => decodeStoredSnapshot(raw), /store_snapshot_invalid/);
  }
});

test('a corrupted local document is moved aside and the store starts clean', async () => {
  const file = resolveLocalStoreFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"meta": truncated', 'utf-8');

  const hydrated = await store.hydrateGatewayDatabase();
  assert.equal(hydrated.ok, true, 'hydration does not fail on a corrupt cache');
  assert.equal(fs.existsSync(file), false, 'the corrupt file is no longer the live document');
  const quarantined = fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.corrupt-'));
  assert.equal(quarantined.length, 1, 'the bad file is kept for inspection');
});

/* ------------------------------ cold start ---------------------------------- */

test('a cold instance adopts the snapshot written by the previous instance', async () => {
  const first = await store.hydrateGatewayDatabase();
  assert.equal(first.ok, true);

  const database = store.getGatewayDatabase();
  const markerId = 'match-local-json-round-trip';
  const template = database.matches[0];
  database.matches = [
    ...database.matches,
    {
      ...template,
      id: markerId,
      externalIds: {},
      competitionCode: 'local-json-check',
      utcKickoff: '2026-10-14T18:00:00.000Z',
      cairoDate: '2026-10-14',
      homeTeam: { ...template.homeTeam, id: 'local-home', nameEn: 'Local Home', nameAr: 'محلي هوم' },
      awayTeam: { ...template.awayTeam, id: 'local-away', nameEn: 'Local Away', nameAr: 'محلي أواي' },
    },
  ];
  store.persistGatewayDatabase(database);
  const flushed = await store.flushDurableStore({ force: true });
  assert.equal(flushed.ok, true);

  store.resetStoreStateForTests();
  const second = await store.hydrateGatewayDatabase();
  assert.equal(second.ok, true);
  assert.ok(store.getGatewayDatabase().matches.some((match) => match.id === markerId));
});

test('an unhydrated instance refuses to overwrite the stored snapshot', async () => {
  const refused = await store.flushDurableStore({ force: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'store_not_hydrated');
});

/* --------------------------- cron response contract ------------------------- */

test('update-matches answers HTTP 200 with ok:true when every provider fails', async () => {
  failEveryProvider();
  const response = await updateMatchesGET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'degraded');
  assert.equal(body.syncOk, false);
  assert.ok(Array.isArray(body.warnings) && body.warnings.length > 0, 'the reason is still reported');
});

test('update-matches answers HTTP 200 with ok:true on POST too and never 503', async () => {
  failEveryProvider();
  const response = await updateMatchesPOST();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test('update-matches answers 200 ok:true even when the sync throws unexpectedly', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('network exploded');
  });
  const response = await updateMatchesGET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
});

test('the authenticated sync route answers 401 without the secret and 200 ok:true with it', async () => {
  setEnvironment({ NEMO_DATA_DIR: dataDir, NEMO_GATEWAY_STORE_PERSIST: 'on', CRON_SECRET: 'local-test-secret' });
  const unauthenticated = await syncGET(new NextRequest('http://localhost/api/cron/sync?mode=daily'));
  assert.equal(unauthenticated.status, 401, 'the secret still guards the sync route');

  failEveryProvider();
  const authenticated = await syncGET(
    new NextRequest('http://localhost/api/cron/sync?mode=daily', {
      headers: { authorization: 'Bearer local-test-secret' },
    })
  );
  assert.equal(authenticated.status, 200);
  const body = await authenticated.json();
  assert.equal(body.ok, true);
  assert.equal(body.syncOk, false);
});

test('the news sync route answers 200 ok:true when the news sources are unreachable', async () => {
  setEnvironment({ NEMO_DATA_DIR: dataDir, NEMO_GATEWAY_STORE_PERSIST: 'on', CRON_SECRET: 'local-test-secret' });
  failEveryProvider();
  const response = await syncNewsGET(
    new NextRequest('http://localhost/api/cron/sync-news', {
      headers: { authorization: 'Bearer local-test-secret' },
    })
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test('health answers 200 even when persistence is disabled', async () => {
  setEnvironment({ NEMO_GATEWAY_STORE_PERSIST: 'off' });
  const response = await healthGET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.checks.storageRoundTrip, false, 'the probe still reports the truth');
});
