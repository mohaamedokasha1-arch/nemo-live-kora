import zlib from 'zlib';

/**
 * Durable snapshot transport for the gateway store.
 *
 * `data/gateway-store.json` lives inside the deployment bundle, and a serverless filesystem is
 * neither shared nor persistent: two instances never see each other's writes and every cold start
 * begins from the committed snapshot. This module is the transport layer that carries the whole
 * `GatewayDatabase` snapshot to an external key-value store, so `/api/cron/update-matches` can make
 * an honest durability claim instead of reporting a lambda-local write as if it were production
 * storage.
 *
 * Two interchangeable backends are supported, both over plain `fetch` (no new dependency):
 *  - `redis` — Upstash Redis REST API (also Vercel KV's REST-compatible variables).
 *  - `http`  — any HTTP endpoint that can GET the latest snapshot and PUT a new one.
 *
 * The snapshot is gzip-compressed and base64-wrapped inside a small versioned envelope. The store
 * JSON is ~160 KB of repetitive match data, which shrinks to roughly a tenth of that, keeping every
 * write far below the value-size limits of free tiers.
 */

export type DurableBackendId = 'redis' | 'http';

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

  return {
    id: 'redis',
    label: 'Upstash Redis REST',
    target: `${base} (key: ${key})`,
    async read() {
      let value: unknown;
      try {
        value = await runCommand(['GET', key]);
      } catch (error) {
        if (error instanceof DurableStoreError && error.message.includes('command_form_unsupported')) {
          // Path form used by the original Vercel KV REST API.
          const response = await fetch(`${base}/get/${encodeURIComponent(key)}`, {
            headers,
            signal: timeoutSignal(timeoutMs),
            cache: 'no-store',
          });
          if (!response.ok) {
            throw new DurableStoreError('store_read_failed', `redis_http_${response.status}`);
          }
          const text = await readBody(response);
          try {
            value = (JSON.parse(text) as { result?: unknown }).result ?? null;
          } catch {
            throw new DurableStoreError('store_read_failed', 'redis_invalid_json');
          }
        } else {
          throw error;
        }
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

/**
 * Resolves the configured durable backend, or `null` when the deployment has none.
 *
 * Detection order prefers an explicit `NEMO_DURABLE_STORE` selection, then Upstash-compatible
 * Redis variables (the names injected by the Vercel Marketplace integration), then a generic HTTP
 * endpoint. Secrets are never logged or returned.
 */
export function resolveDurableBackend(env: NodeJS.ProcessEnv = process.env): DurableBackend | null {
  const timeoutMs = resolveStoreTimeoutMs(env);
  const requested = (env.NEMO_DURABLE_STORE || '').trim().toLowerCase();
  if (requested === 'off' || requested === 'memory' || requested === 'file') return null;

  const redisUrl = readEnv(env, 'KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'NEMO_KV_REST_URL');
  const redisToken = readEnv(env, 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN', 'NEMO_KV_REST_TOKEN');
  const httpUrl = readEnv(env, 'NEMO_DURABLE_STORE_URL');

  const wantsRedis = requested === '' || requested === 'redis' || requested === 'kv' || requested === 'upstash';
  const wantsHttp = requested === '' || requested === 'http';

  if (wantsRedis && redisUrl && redisToken) {
    const key = readEnv(env, 'NEMO_DURABLE_STORE_KEY') || DEFAULT_KEY;
    return createRedisBackend(redisUrl, redisToken, key, timeoutMs);
  }
  if (wantsHttp && httpUrl) {
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
