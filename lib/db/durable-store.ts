import fs from 'fs';
import os from 'os';
import path from 'path';
import { isGatewayDatabaseShape } from '../storage/types';
import { writeFileAtomic } from './atomic-file';

/**
 * Durable snapshot layer — self-contained, no external database.
 *
 * The whole `GatewayDatabase` is kept as one structured JSON document in a local file, written with
 * an atomic replace (`atomic-file.ts`). No token, URL or dashboard is required from the operator:
 * the location is derived from the runtime itself.
 *
 *  - Normal host (VPS, container, `next start`, `npm run sync`): `<cwd>/data/gateway-store.json`,
 *    which genuinely persists across restarts.
 *  - Serverless host (Vercel/Lambda/Netlify): `<os.tmpdir()>/nemo-gateway/gateway-store.json`
 *    (`/tmp` on Vercel). That is the only writable disk; it survives across requests served by a
 *    warm instance and is discarded on a cold start, so it is reported as warm-instance storage,
 *    never as shared durable storage.
 *  - `NEMO_DATA_DIR` optionally relocates the file; it is never required.
 *  - `NEMO_GATEWAY_STORE_PERSIST=off` disables writes (used by the test suite only).
 *
 * A corrupted file is moved aside (`*.corrupt-<timestamp>.json`) instead of blocking the store, so
 * the next successful sync rewrites a clean snapshot without operator intervention.
 */

export type DurableBackendId = 'file';

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

const SNAPSHOT_FILE_NAME = 'gateway-store.json';

/**
 * True on runtimes whose filesystem is ephemeral (Vercel/Lambda/Netlify/Workers). Detected instead
 * of assumed: a self-hosted Node server writes a genuinely persistent `data/gateway-store.json`.
 */
export function isServerlessRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.VERCEL ||
      env.VERCEL_ENV ||
      env.AWS_LAMBDA_FUNCTION_NAME ||
      env.NETLIFY ||
      env.CF_PAGES ||
      env.FUNCTIONS_WORKER_RUNTIME
  );
}

/** The writable snapshot location for the current runtime (see the module comment). */
export function resolveLocalStoreFile(env: NodeJS.ProcessEnv = process.env): string {
  const overrideDir = (env.NEMO_DATA_DIR || '').trim();
  if (overrideDir) return path.join(overrideDir, SNAPSHOT_FILE_NAME);
  if (isServerlessRuntime(env)) return path.join(os.tmpdir(), 'nemo-gateway', SNAPSHOT_FILE_NAME);
  return path.join(process.cwd(), 'data', SNAPSHOT_FILE_NAME);
}

/** Persistence is disabled only when explicitly switched off (the test suite does this). */
export function isPersistenceDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NEMO_GATEWAY_STORE_PERSIST || '').trim().toLowerCase() === 'off';
}

/** Serializes the whole database into the structured JSON document stored on disk. */
export function encodeSnapshot(snapshot: unknown): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Parses a stored document. Anything that is not a complete `GatewayDatabase` (schema marker,
 * matches, news, sources) throws `store_snapshot_invalid` so a truncated or foreign value is never
 * loaded as the live database.
 */
export function decodeStoredSnapshot(raw: string): { snapshot: unknown; savedAt: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DurableStoreError('store_snapshot_invalid', 'not JSON');
  }
  if (!isGatewayDatabaseShape(parsed)) {
    throw new DurableStoreError('store_snapshot_invalid', 'shape_mismatch');
  }
  return { snapshot: parsed, savedAt: null };
}

export interface DurableBackend {
  readonly id: DurableBackendId;
  /** Human-readable backend name for diagnostics. */
  readonly label: string;
  /** Local path of the document (no secrets exist in this layer). */
  readonly target: string;
  /** Returns the stored document, or `null` when none exists (or it was quarantined as corrupt). */
  read(): Promise<string | null>;
  /** Replaces the stored document atomically. Resolves only after the write has completed. */
  write(payload: string): Promise<void>;
}

/** Moves an unreadable document aside so the store can start fresh without manual cleanup. */
function quarantine(file: string): void {
  try {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}.json`);
  } catch {
    // If even the rename fails, the next atomic write replaces the file anyway.
  }
}

function createLocalFileBackend(file: string): DurableBackend {
  return {
    id: 'file',
    label: 'Local structured JSON (atomic write)',
    target: file,
    async read() {
      let raw: string;
      try {
        if (!fs.existsSync(file)) return null;
        raw = fs.readFileSync(file, 'utf-8');
      } catch (error) {
        throw new DurableStoreError(
          'store_read_failed',
          error instanceof Error ? error.message.slice(0, 120) : 'read_error'
        );
      }
      try {
        decodeStoredSnapshot(raw);
      } catch {
        console.warn('[store] corrupt_snapshot_quarantined', JSON.stringify({ file }));
        quarantine(file);
        return null;
      }
      return raw;
    },
    async write(payload) {
      try {
        writeFileAtomic(file, payload);
      } catch (error) {
        throw new DurableStoreError(
          'store_write_failed',
          error instanceof Error ? error.message.slice(0, 120) : 'write_error'
        );
      }
    },
  };
}

/**
 * Resolves the local snapshot backend, or `null` when persistence is explicitly switched off.
 * No environment variable is needed for it to be active.
 */
export function resolveDurableBackend(env: NodeJS.ProcessEnv = process.env): DurableBackend | null {
  if (isPersistenceDisabled(env)) return null;
  return createLocalFileBackend(resolveLocalStoreFile(env));
}

/** Diagnostics for the status pages and cron responses — contains no secrets. */
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
