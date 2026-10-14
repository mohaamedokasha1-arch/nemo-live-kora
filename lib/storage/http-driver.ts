import type { GatewayDatabase } from '../types';
import { decodeStoredSnapshot, encodeSnapshot } from '../db/durable-store';
import {
  FetchLike,
  StorageDriver,
  StoragePingResult,
  StorageReadResult,
  StorageWriteResult,
  isGatewayDatabaseShape,
  resolveFetch,
  withTimeout,
} from './types';

export interface HttpSnapshotDriverOptions {
  /** Endpoint that returns the latest snapshot on GET and stores the body on PUT. */
  url: string;
  token?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Generic HTTP snapshot driver.
 *
 * This is the `lib/storage/` face of the durable layer's `http` backend: both read and write the
 * same gzip envelope (`lib/db/durable-store.ts`), so data written by the live store can be read
 * back by the migration/audit tooling and vice versa. Previously this endpoint was only visible
 * to the durable layer while `selectStorageDriver()` reported "file", which made `/api/health`
 * and `/sources` contradict the cron about whether storage was durable at all.
 */
export class HttpSnapshotStorageDriver implements StorageDriver {
  readonly kind = 'http' as const;
  readonly labelAr = 'نقطة HTTP للقطة الدائمة (GET/PUT)';
  private readonly url: string;
  private readonly token?: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: HttpSnapshotDriverOptions) {
    this.url = options.url;
    this.token = options.token;
    this.fetchImpl = resolveFetch(options.fetchImpl);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  isDurable(): boolean {
    return true;
  }

  describe() {
    let target = this.url;
    try {
      const parsed = new URL(this.url);
      target = `${parsed.origin}${parsed.pathname}`;
    } catch {
      /* keep the raw value */
    }
    return { kind: this.kind, target, durable: true };
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  async read(): Promise<StorageReadResult> {
    const startedAt = Date.now();
    try {
      const response = await withTimeout(
        this.fetchImpl(this.url, {
          headers: this.headers({ Accept: 'application/json' }),
          cache: 'no-store',
        }),
        this.timeoutMs,
        'http_snapshot_read'
      );
      const rawText = await response.text();
      if (response.status === 404 || response.status === 204 || !rawText.trim()) {
        return { ok: false, database: null, bytes: 0, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: 'empty_store' };
      }
      if (!response.ok) {
        return { ok: false, database: null, bytes: 0, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: `HTTP ${response.status}: ${rawText.slice(0, 160)}` };
      }
      let snapshot: unknown;
      try {
        snapshot = decodeStoredSnapshot(rawText).snapshot;
      } catch {
        return { ok: false, database: null, bytes: rawText.length, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: 'invalid_shape' };
      }
      if (!isGatewayDatabaseShape(snapshot)) {
        return { ok: false, database: null, bytes: rawText.length, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: 'invalid_shape' };
      }
      return { ok: true, database: snapshot, bytes: rawText.length, origin: this.describe().target, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        database: null,
        bytes: 0,
        origin: this.describe().target,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async write(database: GatewayDatabase): Promise<StorageWriteResult> {
    const startedAt = Date.now();
    const payload = encodeSnapshot(database);
    const writtenAt = new Date().toISOString();
    try {
      const response = await withTimeout(
        this.fetchImpl(this.url, {
          method: 'PUT',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          body: payload,
          cache: 'no-store',
        }),
        this.timeoutMs,
        'http_snapshot_write'
      );
      const rawText = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          bytes: 0,
          writtenAt,
          mirror: { matches: 0, news: 0, standings: 0 },
          latencyMs: Date.now() - startedAt,
          error: `HTTP ${response.status}: ${rawText.slice(0, 200)}`,
        };
      }
      return {
        ok: true,
        bytes: Buffer.byteLength(payload),
        writtenAt,
        mirror: {
          matches: database.matches.length,
          news: database.news.length,
          standings: Object.keys(database.standings || {}).length,
        },
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        bytes: 0,
        writtenAt,
        mirror: { matches: 0, news: 0, standings: 0 },
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async ping(): Promise<StoragePingResult> {
    const startedAt = Date.now();
    try {
      const response = await withTimeout(
        this.fetchImpl(this.url, { headers: this.headers(), cache: 'no-store' }),
        this.timeoutMs,
        'http_snapshot_ping'
      );
      await response.text();
      // 404 only means "no snapshot yet"; the endpoint itself is reachable and writable.
      const reachable = response.ok || response.status === 404;
      return {
        ok: reachable,
        latencyMs: Date.now() - startedAt,
        detail: reachable ? 'snapshot_endpoint_reachable' : `HTTP ${response.status}`,
        observed: { durable: true, status: response.status },
      };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - startedAt, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
