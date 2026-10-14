import type { GatewayDatabase } from '../types';

/**
 * Storage contract for the gateway snapshot.
 *
 * The application keeps its dataset in a structured JSON document on the local disk (see
 * `lib/db/durable-store.ts`). Every driver answers `isDurable()`, so status pages and sync
 * responses can say honestly whether the data survives a cold start and is shared between
 * instances, instead of implying it always does.
 */

export type StorageDriverKind = 'file' | 'memory';

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
  /** ISO timestamp assigned by the driver. */
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
   * True when data survives process restarts AND is shared between instances of the app.
   * A local file on a serverless host is deliberately `false`.
   */
  isDurable(): boolean;
  /** Description of the backing file or memory store — contains no secret. */
  describe(): { kind: StorageDriverKind; target: string; durable: boolean };
  read(): Promise<StorageReadResult>;
  write(database: GatewayDatabase): Promise<StorageWriteResult>;
  /** Cheap round-trip used by /api/health and the sync endpoints. */
  ping(): Promise<StoragePingResult>;
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
