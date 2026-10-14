import zlib from 'zlib';
import { isGatewayDatabaseShape } from '../storage/types';

/**
 * Durable snapshot transport for the gateway store — the single write path used by the request
 * layer (`lib/db/store.ts`), the cron routes and the CLI sync.
 *
 * `data/gateway-store.json` lives inside the deployment bundle, and a serverless filesystem is
 * neither shared nor persistent: two instances never see each other's writes and every cold start
 * begins from the committed snapshot. This module carries the whole `GatewayDatabase` snapshot to
 * an external store shared by every instance, so `/api/cron/update-matches` can make an honest
 * durability claim instead of reporting a lambda-local write as if it were production storage.
 *
 * Supported backends (all over plain `fetch`, no new dependency):
 *  - `turso` — Turso/libSQL over its HTTP pipeline API (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`,
 *    or the `LIBSQL_*` aliases). The envelope lives in `nemo_kv_store`; the same write also mirrors
 *    the raw document into `gateway_documents`, so `lib/storage/` tooling reads the same data.
 *  - `redis` — Upstash Redis REST API, including the variables the Vercel Marketplace integration
 *    injects (`KV_REST_API_URL` / `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_*`). Reads also fall
 *    back to the legacy `nemo:gateway` key written by older `lib/storage/` tooling.
 *  - `blob`  — Vercel Blob (`BLOB_READ_WRITE_TOKEN`) at a deterministic pathname.
 *  - `http`  — any HTTP endpoint that can GET the latest snapshot and PUT a new one
 *    (`NEMO_DURABLE_STORE_URL`).
 *
 * Selection: `NEMO_DURABLE_STORE` wins when set, then `NEMO_STORAGE_DRIVER` (the two selectors now
 * drive the same backends), then auto-detection in the order turso → redis → blob → http. A local
 * structured JSON file (see `lib/db/store.ts`) remains the fallback on hosts with a real disk; on
 * serverless it is only a warm-instance cache and is never reported as durable.
 *
 * The snapshot is gzip-compressed and base64-wrapped inside a small versioned envelope. The store
 * JSON is ~180 KB of repetitive match data, which shrinks to roughly a tenth of that, keeping every
 * write far below the value-size limits of free tiers. Readers additionally accept a legacy raw
 * `GatewayDatabase` JSON document (written by the `lib/storage/` drivers or `storage-migrate.ts`)
 * so an existing dataset is adopted instead of rejected — see `decodeStoredSnapshot`.
 */

export type DurableBackendId = 'redis' | 'http' | 'turso' | 'blob';

/** Machine-readable failure codes; the API surfaces them verbatim and never guesses at success. */
export type DurableStoreErrorCode =
  | 'durable_store_not_configured'
  | 'store_read_failed'
  | 'store_write_failed'
  | 'store_snapshot_invalid';

export class DurableStoreError extends Error {
  readonly code: DurableStoreErrorCode;

  constructor(code: DurableStoreErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'DurableStoreError';
    this.code = code;
  }
}

export const SNAPSHOT_ENVELOPE_VERSION = 1;
const SNAPSHOT_ALGORITHM = 'gzip+base64';
const DEFAULT_KEY = 'nemo-live-kora:gateway-store';
/** Key used by the older `lib/storage/` Upstash driver; read as a fallback so migrated data is found. */
const LEGACY_REDIS_KEY = 'nemo:gateway';
const DEFAULT_BLOB_PATHNAME = 'nemo-gateway/gateway-store.json';
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Reading `process.env` must not be cached: `npm test` flips these variables between cases, and a
 * deployment can only be reconfigured by restarting the process anyway.
 */
function readEnv(env: NodeJS.ProcessEnv, ...names: string[]): string | null {
  for (const name of names) {
    const value = (env[name] || '').trim();
    if (value) return value;
  }
  return null;
}

export function resolveStoreTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt((env.NEMO_DURABLE_STORE_TIMEOUT_MS || '').trim(), 10);
  if (Number.isFinite(parsed) && parsed >= 500 && parsed <= 30000) return parsed;
  return DEFAULT_TIMEOUT_MS;
}

export interface SnapshotEnvelope {
  v: typeof SNAPSHOT_ENVELOPE_VERSION;
  alg: typeof SNAPSHOT_ALGORITHM;
  savedAt: string;
  bytes: number;
  data: string;
}

/** Serializes the whole database into the compressed envelope stored by a durable backend. */
export function encodeSnapshot(snapshot: unknown, savedAt = new Date().toISOString()): string {
  const json = JSON.stringify(snapshot);
  const envelope: SnapshotEnvelope = {
    v: SNAPSHOT_ENVELOPE_VERSION,
    alg: SNAPSHOT_ALGORITHM,
    savedAt,
    bytes: Buffer.byteLength(json, 'utf-8'),
    data: zlib.gzipSync(Buffer.from(json, 'utf-8')).toString('base64'),
  };
  return JSON.stringify(envelope);
}

/**
 * Reverses {@link encodeSnapshot}. Throws `DurableStoreError` for anything that is not a snapshot
 * written by this module — a corrupted or foreign value must never be loaded as the database.
 */
export function decodeSnapshot(raw: string): { snapshot: unknown; savedAt: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DurableStoreError('store_snapshot_invalid', 'not JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new DurableStoreError('store_snapshot_invalid', 'not an object');
  }
  const envelope = parsed as Partial<SnapshotEnvelope>;
  if (envelope.v !== SNAPSHOT_ENVELOPE_VERSION) {
    throw new DurableStoreError('store_snapshot_invalid', `unsupported envelope version ${String(envelope.v)}`);
  }
  if (envelope.alg !== SNAPSHOT_ALGORITHM || typeof envelope.data !== 'string') {
    throw new DurableStoreError('store_snapshot_invalid', 'unsupported encoding');
  }
  try {
    const json = zlib.gunzipSync(Buffer.from(envelope.data, 'base64')).toString('utf-8');
    return {
      snapshot: JSON.parse(json),
      savedAt: typeof envelope.savedAt === 'string' ? envelope.savedAt : null,
    };
  } catch {
    throw new DurableStoreError('store_snapshot_invalid', 'payload could not be decoded');
  }
}

/**
 * Decodes whatever a backend actually holds: the compressed envelope written by this layer, or a
 * legacy raw `GatewayDatabase` JSON document written by the `lib/storage/` drivers / migration
 * tooling (Turso `gateway_documents`, the old Upstash key, a Blob object). A raw value is only
 * accepted when it passes the strict shape check (schema version, matches, news, sources), so a
 * foreign or truncated value like `{"meta":{},"matches":[]}` is still rejected.
 */
export function decodeStoredSnapshot(raw: string): { snapshot: unknown; savedAt: string | null } {
  try {
    return decodeSnapshot(raw);
  } catch (error) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw error;
    }
    if (isGatewayDatabaseShape(parsed)) {
      return { snapshot: parsed, savedAt: null };
    }
    throw error;
  }
}

export interface DurableBackend {
  readonly id: DurableBackendId;
  /** Human-readable backend name for diagnostics. */
  readonly label: string;
  /** Safe target description (host/path only — never a token). */
  readonly target: string;
  /** Returns the stored snapshot string, or `null` when the store is empty. */
  read(): Promise<string | null>;
  /** Overwrites the stored snapshot. Resolves only after the backend confirmed the write. */
  write(payload: string): Promise<void>;
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  // AbortSignal.timeout exists on Node 18.17+; every supported runtime here has it.
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** libSQL URLs are often pasted as `libsql://…` / `wss://…`; the HTTP pipeline needs `https://…`. */
export function normalizeLibsqlUrl(url: string): string {
  return url
    .trim()
    .replace(/^libsql:\/\//i, 'https://')
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://')
    .replace(/\/+$/, '');
}

/* -------------------------------------------------------------------------- */
/* Redis (Upstash REST / Vercel KV)                                            */
/* -------------------------------------------------------------------------- */

function createRedisBackend(
  url: string,
  token: string,
  key: string,
  timeoutMs: number
): DurableBackend {
  const base = url.replace(/\/+$/, '');
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  /** Upstash command form: POST the base URL with a JSON command array. */
  async function runCommand(command: string[]): Promise<unknown> {
    const response = await fetch(base, {
      method: 'POST',
      headers,
      body: JSON.stringify(command),
      signal: timeoutSignal(timeoutMs),
      cache: 'no-store',
    });
    if (response.status === 404 || response.status === 405) {
      throw new DurableStoreError('store_read_failed', `command_form_unsupported_${response.status}`);
    }
    const text = await readBody(response);
    if (!response.ok) {
      throw new DurableStoreError(
        command[0] === 'SET' ? 'store_write_failed' : 'store_read_failed',
        `redis_http_${response.status}${text ? ` ${text.slice(0, 120)}` : ''}`
      );
    }
    let payload: { result?: unknown; error?: string } = {};
    try {
      payload = JSON.parse(text) as { result?: unknown; error?: string };
    } catch {
      throw new DurableStoreError('store_read_failed', 'redis_invalid_json');
    }
    if (payload.error) {
      throw new DurableStoreError(
        command[0] === 'SET' ? 'store_write_failed' : 'store_read_failed',
        String(payload.error).slice(0, 120)
      );
    }
    return payload.result ?? null;
  }

  /** GET one key, falling back to the legacy `/get/<key>` path form when commands are unsupported. */
  async function getKey(candidate: string): Promise<unknown> {
    try {
      return await runCommand(['GET', candidate]);
    } catch (error) {
      if (error instanceof DurableStoreError && error.message.includes('command_form_unsupported')) {
        // Path form used by the original Vercel KV REST API.
        const response = await fetch(`${base}/get/${encodeURIComponent(candidate)}`, {
          headers,
          signal: timeoutSignal(timeoutMs),
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new DurableStoreError('store_read_failed', `redis_http_${response.status}`);
        }
        const text = await readBody(response);
        try {
          return (JSON.parse(text) as { result?: unknown }).result ?? null;
        } catch {
          throw new DurableStoreError('store_read_failed', 'redis_invalid_json');
        }
      }
      throw error;
    }
  }

  return {
    id: 'redis',
    label: 'Upstash Redis REST',
    target: `${base} (key: ${key})`,
    async read() {
      let value = await getKey(key);
      if ((value === null || value === undefined || value === '') && key !== LEGACY_REDIS_KEY) {
        // Data migrated by the older lib/storage tooling lives under a different key; adopt it
        // instead of reporting an empty store and letting the next write start from the seed.
        value = await getKey(LEGACY_REDIS_KEY);
      }
      if (value === null || value === undefined || value === '') return null;
      if (typeof value !== 'string') {
        throw new DurableStoreError('store_snapshot_invalid', 'redis_value_not_a_string');
      }
      return value;
    },
    async write(payload) {
      await runCommand(['SET', key, payload]);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Generic HTTP snapshot endpoint                                              */
/* -------------------------------------------------------------------------- */

function createHttpBackend(
  url: string,
  token: string | null,
  timeoutMs: number
): DurableBackend {
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  let target = url;
  try {
    const parsed = new URL(url);
    target = `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Keep the raw string; the failing fetch reports the real problem.
  }

  return {
    id: 'http',
    label: 'Generic HTTP snapshot endpoint',
    target,
    async read() {
      const response = await fetch(url, {
        headers: { ...authHeaders, Accept: 'application/json' },
        signal: timeoutSignal(timeoutMs),
        cache: 'no-store',
      });
      if (response.status === 404 || response.status === 204) return null;
      if (!response.ok) {
        throw new DurableStoreError('store_read_failed', `http_${response.status}`);
      }
      const text = (await readBody(response)).trim();
      return text ? text : null;
    },
    async write(payload) {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: payload,
        signal: timeoutSignal(timeoutMs),
        cache: 'no-store',
      });
      if (!response.ok) {
        const text = await readBody(response);
        throw new DurableStoreError(
          'store_write_failed',
          `http_${response.status}${text ? ` ${text.slice(0, 120)}` : ''}`
        );
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Turso / libSQL                                                              */
/* -------------------------------------------------------------------------- */

interface LibsqlStatement {
  sql: string;
  args?: Array<{ type: string; value: string | number | null }>;
}

function libsqlText(value: string | null) {
  return { type: 'text', value };
}
function libsqlInteger(value: number) {
  return { type: 'integer', value };
}

const TURSO_KV_TABLE = 'nemo_kv_store';
const TURSO_SCHEMA_STATEMENTS: LibsqlStatement[] = [
  {
    sql: `CREATE TABLE IF NOT EXISTS ${TURSO_KV_TABLE} (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )`,
  },
  {
    sql: `CREATE TABLE IF NOT EXISTS gateway_documents (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            bytes INTEGER NOT NULL,
            matches_count INTEGER NOT NULL DEFAULT 0,
            news_count INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
          )`,
  },
];

/** Extracts row arrays from any of the pipeline response shapes libSQL/hosted proxies return. */
function libsqlRows(entry: unknown): unknown[][] {
  if (!entry || typeof entry !== 'object') return [];
  const record = entry as Record<string, unknown>;
  if (Array.isArray(record.rows)) return record.rows as unknown[][];
  const response = record.response as Record<string, unknown> | undefined;
  const result = (response?.result ?? record.result) as Record<string, unknown> | undefined;
  if (result && Array.isArray(result.rows)) return result.rows as unknown[][];
  return [];
}

function libsqlCellValue(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
  if (typeof cell === 'object' && 'value' in (cell as Record<string, unknown>)) {
    const value = (cell as { value: unknown }).value;
    return value === null || value === undefined ? null : String(value);
  }
  return null;
}

function createTursoBackend(
  rawUrl: string,
  token: string,
  key: string,
  timeoutMs: number
): DurableBackend {
  const base = normalizeLibsqlUrl(rawUrl);

  async function pipeline(
    statements: LibsqlStatement[],
    failure: 'store_read_failed' | 'store_write_failed'
  ): Promise<unknown[][][]> {
    let response: Response;
    try {
      response = await fetch(`${base}/v2/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: statements.map((stmt) => ({ type: 'execute', stmt })),
        }),
        signal: timeoutSignal(timeoutMs),
        cache: 'no-store',
      });
    } catch (error) {
      // Network/timeout failures surface with the caller's read/write code, not as raw TypeErrors.
      throw new DurableStoreError(
        failure,
        error instanceof Error ? error.message.slice(0, 120) : 'network_error'
      );
    }
    const text = await readBody(response);
    if (!response.ok) {
      throw new DurableStoreError(failure, `turso_http_${response.status}${text ? ` ${text.slice(0, 120)}` : ''}`);
    }
    let parsed: { results?: unknown[] } = {};
    try {
      parsed = JSON.parse(text) as { results?: unknown[] };
    } catch {
      throw new DurableStoreError(failure, 'turso_invalid_json');
    }
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    for (const entry of results) {
      const record = entry as { type?: string; error?: unknown } | null;
      if (record && record.type === 'error') {
        throw new DurableStoreError(failure, `turso_error ${JSON.stringify(record.error).slice(0, 120)}`);
      }
    }
    return results.map((entry) => libsqlRows(entry));
  }

  return {
    id: 'turso',
    label: 'Turso/libSQL',
    target: `${safeHost(base)} (key: ${key})`,
    async read() {
      const results = await pipeline(
        [
          ...TURSO_SCHEMA_STATEMENTS,
          { sql: `SELECT value FROM ${TURSO_KV_TABLE} WHERE key = ?`, args: [libsqlText(key)] },
          { sql: 'SELECT payload FROM gateway_documents WHERE id = ?', args: [libsqlText('gateway')] },
        ],
        'store_read_failed'
      );
      // Pipeline order: [create kv, create documents, select kv, select documents].
      const kvRows = results[2] ?? [];
      const kvValue = kvRows.length > 0 ? libsqlCellValue((kvRows[0] as unknown[])[0]) : null;
      if (kvValue) return kvValue;
      // Legacy fallback: a document migrated with the lib/storage Turso driver.
      const documentRows = results[3] ?? [];
      const documentValue =
        documentRows.length > 0 ? libsqlCellValue((documentRows[0] as unknown[])[0]) : null;
      return documentValue || null;
    },
    async write(payload) {
      const now = new Date().toISOString();
      const statements: LibsqlStatement[] = [
        ...TURSO_SCHEMA_STATEMENTS,
        {
          sql: `INSERT INTO ${TURSO_KV_TABLE} (key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          args: [libsqlText(key), libsqlText(payload), libsqlText(now)],
        },
      ];
      // Mirror the raw document into gateway_documents in the same pipeline, so the lib/storage
      // Turso driver (and SQL inspection) sees exactly what this layer wrote. Only possible when
      // the payload is one of our envelopes; arbitrary payloads still land in the KV table.
      try {
        const { snapshot } = decodeSnapshot(payload);
        const rawJson = JSON.stringify(snapshot);
        const record = snapshot as { matches?: unknown[]; news?: unknown[] } | null;
        statements.push({
          sql: `INSERT INTO gateway_documents (id, payload, bytes, matches_count, news_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  payload = excluded.payload,
                  bytes = excluded.bytes,
                  matches_count = excluded.matches_count,
                  news_count = excluded.news_count,
                  updated_at = excluded.updated_at`,
          args: [
            libsqlText('gateway'),
            libsqlText(rawJson),
            libsqlInteger(Buffer.byteLength(rawJson, 'utf-8')),
            libsqlInteger(Array.isArray(record?.matches) ? record.matches.length : 0),
            libsqlInteger(Array.isArray(record?.news) ? record.news.length : 0),
            libsqlText(now),
          ],
        });
      } catch {
        // Not an envelope written by this layer; the KV row above is the canonical copy.
      }
      await pipeline(statements, 'store_write_failed');
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Vercel Blob                                                                 */
/* -------------------------------------------------------------------------- */

const BLOB_API = 'https://blob.vercel-storage.com';
const BLOB_API_VERSION = '7';

function createBlobBackend(token: string, pathname: string, timeoutMs: number): DurableBackend {
  return {
    id: 'blob',
    label: 'Vercel Blob',
    target: `blob:${pathname}`,
    async read() {
      let listResponse: Response;
      try {
        listResponse = await fetch(
          `${BLOB_API}?prefix=${encodeURIComponent(pathname)}&limit=1`,
          {
            headers: { Authorization: `Bearer ${token}`, 'x-api-version': BLOB_API_VERSION },
            signal: timeoutSignal(timeoutMs),
            cache: 'no-store',
          }
        );
      } catch (error) {
        throw new DurableStoreError(
          'store_read_failed',
          error instanceof Error ? error.message.slice(0, 120) : 'network_error'
        );
      }
      const listText = await readBody(listResponse);
      if (!listResponse.ok) {
        throw new DurableStoreError('store_read_failed', `blob_http_${listResponse.status}`);
      }
      let listing: { blobs?: Array<{ url: string; pathname: string }> } = {};
      try {
        listing = JSON.parse(listText) as { blobs?: Array<{ url: string; pathname: string }> };
      } catch {
        throw new DurableStoreError('store_read_failed', 'blob_invalid_json');
      }
      const blob =
        (listing.blobs || []).find((entry) => entry.pathname === pathname) || (listing.blobs || [])[0];
      if (!blob) return null;
      let bodyResponse: Response;
      try {
        bodyResponse = await fetch(blob.url, {
          headers: { 'x-api-version': BLOB_API_VERSION },
          signal: timeoutSignal(timeoutMs),
          cache: 'no-store',
        });
      } catch (error) {
        throw new DurableStoreError(
          'store_read_failed',
          error instanceof Error ? error.message.slice(0, 120) : 'network_error'
        );
      }
      if (!bodyResponse.ok) {
        throw new DurableStoreError('store_read_failed', `blob_http_${bodyResponse.status}`);
      }
      const text = (await readBody(bodyResponse)).trim();
      return text ? text : null;
    },
    async write(payload) {
      let response: Response;
      try {
        response = await fetch(`${BLOB_API}/${pathname}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'x-api-version': BLOB_API_VERSION,
            'x-content-type': 'application/json',
            'x-add-random-suffix': '0',
          },
          body: payload,
          signal: timeoutSignal(timeoutMs),
          cache: 'no-store',
        });
      } catch (error) {
        throw new DurableStoreError(
          'store_write_failed',
          error instanceof Error ? error.message.slice(0, 120) : 'network_error'
        );
      }
      if (!response.ok) {
        const text = await readBody(response);
        throw new DurableStoreError(
          'store_write_failed',
          `blob_http_${response.status}${text ? ` ${text.slice(0, 120)}` : ''}`
        );
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Backend resolution                                                          */
/* -------------------------------------------------------------------------- */

type RequestedBackend = DurableBackendId | 'file' | 'memory' | 'off' | null;

function normalizeRequested(value: string): RequestedBackend {
  switch (value.trim().toLowerCase()) {
    case 'redis':
    case 'kv':
    case 'upstash':
    case 'vercel-kv':
      return 'redis';
    case 'http':
      return 'http';
    case 'turso':
    case 'libsql':
      return 'turso';
    case 'blob':
    case 'vercel-blob':
      return 'blob';
    case 'file':
      return 'file';
    case 'memory':
      return 'memory';
    case 'off':
      return 'off';
    default:
      return null;
  }
}

/**
 * Which backend the environment asks for, if any. `NEMO_DURABLE_STORE` is the primary selector;
 * `NEMO_STORAGE_DRIVER` (used by the `lib/storage/` tooling) is honoured as the same selection so
 * configuring either one configures the live write path — previously only one of the two worked,
 * depending on which subsystem an operator happened to read about.
 */
function requestedBackend(env: NodeJS.ProcessEnv): RequestedBackend {
  const durable = (env.NEMO_DURABLE_STORE || '').trim();
  if (durable && durable.toLowerCase() !== 'auto') return normalizeRequested(durable);
  const storage = (env.NEMO_STORAGE_DRIVER || '').trim();
  if (storage && storage.toLowerCase() !== 'auto') return normalizeRequested(storage);
  return null;
}

/**
 * Resolves the configured durable backend, or `null` when the deployment has none.
 *
 * Detection order prefers an explicit selection (`NEMO_DURABLE_STORE`, then
 * `NEMO_STORAGE_DRIVER`), then auto-detection: Turso/libSQL → Upstash Redis / Vercel KV → Vercel
 * Blob → generic HTTP endpoint. Secrets are never logged or returned.
 */
export function resolveDurableBackend(env: NodeJS.ProcessEnv = process.env): DurableBackend | null {
  const timeoutMs = resolveStoreTimeoutMs(env);
  const requested = requestedBackend(env);
  if (requested === 'off' || requested === 'memory' || requested === 'file') return null;

  const tursoUrl = readEnv(env, 'TURSO_DATABASE_URL', 'LIBSQL_URL', 'TURSO_DB_URL');
  const tursoToken = readEnv(env, 'TURSO_AUTH_TOKEN', 'LIBSQL_AUTH_TOKEN');
  const redisUrl = readEnv(env, 'KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'NEMO_KV_REST_URL');
  const redisToken = readEnv(env, 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN', 'NEMO_KV_REST_TOKEN');
  const blobToken = readEnv(env, 'BLOB_READ_WRITE_TOKEN');
  const httpUrl = readEnv(env, 'NEMO_DURABLE_STORE_URL');
  const key = readEnv(env, 'NEMO_DURABLE_STORE_KEY') || DEFAULT_KEY;

  const wants = (id: DurableBackendId) => requested === null || requested === id;

  if (wants('turso') && tursoUrl && tursoToken) {
    return createTursoBackend(tursoUrl, tursoToken, key, timeoutMs);
  }
  if (wants('redis') && redisUrl && redisToken) {
    return createRedisBackend(redisUrl, redisToken, key, timeoutMs);
  }
  if (wants('blob') && blobToken) {
    const pathname = readEnv(env, 'NEMO_BLOB_PATHNAME', 'NEMO_DURABLE_STORE_BLOB_PATH') || DEFAULT_BLOB_PATHNAME;
    return createBlobBackend(blobToken, pathname, timeoutMs);
  }
  if (wants('http') && httpUrl) {
    return createHttpBackend(httpUrl, readEnv(env, 'NEMO_DURABLE_STORE_TOKEN'), timeoutMs);
  }
  return null;
}

/** Diagnostics for docs, the status script and the cron response — contains no secrets. */
export function describeDurableBackend(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  backendId: DurableBackendId | null;
  label: string;
  target: string | null;
  reason: DurableStoreErrorCode | null;
} {
  const backend = resolveDurableBackend(env);
  if (!backend) {
    return {
      configured: false,
      backendId: null,
      label: 'none',
      target: null,
      reason: 'durable_store_not_configured',
    };
  }
  return {
    configured: true,
    backendId: backend.id,
    label: backend.label,
    target: backend.target,
    reason: null,
  };
}
