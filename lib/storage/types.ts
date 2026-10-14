import type { GatewayDatabase } from '../types';

/**
 * Persistent storage contract.
 *
 * The gateway used to keep its whole dataset in a module-level object plus a best-effort local
 * JSON file. On a serverless host that file is per-lambda scratch space: a cron write was
 * invisible to the next request, and a cold start threw everything away. Every write path in
 * this system now goes through a driver that answers `isDurable()`, so the sync endpoint can
 * tell the truth about whether data survived.
 */

export type StorageDriverKind = 'file' | 'turso' | 'upstash' | 'vercel-blob' | 'memory';

export interface StorageReadResult {
  ok: boolean;
  /** Parsed document, or null when the store is empty/unreadable. */
  database: GatewayDatabase | null;
  /** Raw payload size in bytes, for diagnostics. */
  bytes: number;
  /** Where the payload came from, for diagnostics. */
  origin: string;
  error?: string;
  latencyMs: number;
}

export interface StorageWriteResult {
  ok: boolean;
  bytes: number;
  /** ISO timestamp assigned by the driver (or locally when the driver has no clock). */
  writtenAt: string;
  /** Rows/objects updated by the structured mirror, when the driver keeps one. */
  mirror: { matches: number; news: number; standings: number };
  error?: string;
  latencyMs: number;
}

export interface StoragePingResult {
  ok: boolean;
  latencyMs: number;
  detail: string;
  /** What the driver saw at the far end (row counts, key existence). */
  observed?: Record<string, string | number | boolean>;
}

export interface StorageDriver {
  readonly kind: StorageDriverKind;
  /** Human/Arabic label used in the sources dashboard. */
  readonly labelAr: string;
  /**
   * True when data survives process restarts AND is shared between every instance of the app.
   * A local file on a serverless host is deliberately `false`.
   */
  isDurable(): boolean;
  /** Redacted description of the backing service — never contains a secret. */
  describe(): { kind: StorageDriverKind; target: string; durable: boolean };
  read(): Promise<StorageReadResult>;
  write(database: GatewayDatabase): Promise<StorageWriteResult>;
  /** Cheap round-trip used by /api/health and the sync endpoints. */
  ping(): Promise<StoragePingResult>;
}

/** Minimal fetch surface the drivers depend on, so tests can inject a stub. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    cache?: RequestCache;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  headers?: { get(name: string): string | null };
}>;

export function resolveFetch(injected?: FetchLike): FetchLike {
  if (injected) return injected;
  return ((url, init) =>
    fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>) as FetchLike;
}

/** Wraps a driver call in a timeout so a slow cloud never wedges a cron run. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout_after_${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** libSQL escapes single quotes by doubling them; used by the Turso driver. */
export function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Validates that a parsed JSON blob really is a GatewayDatabase before the store adopts it. */
export function isGatewayDatabaseShape(value: unknown): value is GatewayDatabase {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GatewayDatabase>;
  return Boolean(
    candidate.meta &&
      typeof candidate.meta === 'object' &&
      typeof candidate.meta.schemaVersion === 'string' &&
      Array.isArray(candidate.matches) &&
      Array.isArray(candidate.news) &&
      candidate.sources &&
      typeof candidate.sources === 'object'
  );
}
