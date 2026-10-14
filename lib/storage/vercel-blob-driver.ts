import type { GatewayDatabase } from '../types';
import {
  FetchLike,
  StorageDriver,
  StoragePingResult,
  StorageReadResult,
  StorageWriteResult,
  parseStoredGatewayDocument,
  resolveFetch,
  withTimeout,
} from './types';

export interface VercelBlobDriverOptions {
  token: string;
  /** Path inside the blob store. Kept stable so every write overwrites the same object. */
  pathname?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const BLOB_API = 'https://blob.vercel-storage.com';
const API_VERSION = '7';

/**
 * Vercel Blob driver.
 *
 * Object storage that is durable and shared between instances, usable from a Vercel function
 * with only `BLOB_READ_WRITE_TOKEN`. `x-add-random-suffix: 0` keeps one deterministic object so
 * reads never chase a moving URL.
 */
export class VercelBlobStorageDriver implements StorageDriver {
  readonly kind = 'vercel-blob' as const;
  readonly labelAr = 'تخزين Vercel Blob (كائنات)';
  private readonly token: string;
  private readonly pathname: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: VercelBlobDriverOptions) {
    this.token = options.token;
    this.pathname = options.pathname || 'nemo-gateway/gateway-store.json';
    this.fetchImpl = resolveFetch(options.fetchImpl);
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  isDurable(): boolean {
    return true;
  }

  describe() {
    return { kind: this.kind, target: `blob:${this.pathname}`, durable: true };
  }

  async read(): Promise<StorageReadResult> {
    const startedAt = Date.now();
    try {
      const listResponse = await withTimeout(
        this.fetchImpl(`${BLOB_API}?prefix=${encodeURIComponent(this.pathname)}&limit=1`, {
          headers: { Authorization: `Bearer ${this.token}`, 'x-api-version': API_VERSION },
          cache: 'no-store',
        }),
        this.timeoutMs,
        'blob_list'
      );
      const listText = await listResponse.text();
      if (!listResponse.ok) {
        return { ok: false, database: null, bytes: 0, origin: this.pathname, latencyMs: Date.now() - startedAt, error: `HTTP ${listResponse.status}: ${listText.slice(0, 160)}` };
      }
      const listing = JSON.parse(listText) as { blobs?: Array<{ url: string; pathname: string }> };
      const blob = (listing.blobs || []).find((b) => b.pathname === this.pathname) || (listing.blobs || [])[0];
      if (!blob) {
        return { ok: false, database: null, bytes: 0, origin: this.pathname, latencyMs: Date.now() - startedAt, error: 'empty_store' };
      }
      const bodyResponse = await withTimeout(
        this.fetchImpl(blob.url, { headers: { 'x-api-version': API_VERSION }, cache: 'no-store' }),
        this.timeoutMs,
        'blob_get'
      );
      const rawText = await bodyResponse.text();
      if (!bodyResponse.ok) {
        return { ok: false, database: null, bytes: 0, origin: this.pathname, latencyMs: Date.now() - startedAt, error: `HTTP ${bodyResponse.status}` };
      }
      // Raw document (this driver's format) or the durable layer's gzip envelope at the same path.
      const { database, error } = parseStoredGatewayDocument(rawText);
      if (!database) {
        return { ok: false, database: null, bytes: rawText.length, origin: this.pathname, latencyMs: Date.now() - startedAt, error: error ?? 'invalid_shape' };
      }
      return { ok: true, database, bytes: rawText.length, origin: this.pathname, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        database: null,
        bytes: 0,
        origin: this.pathname,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async write(database: GatewayDatabase): Promise<StorageWriteResult> {
    const startedAt = Date.now();
    const payload = JSON.stringify(database, null, 2);
    const writtenAt = new Date().toISOString();
    try {
      const response = await withTimeout(
        this.fetchImpl(`${BLOB_API}/${this.pathname}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'x-api-version': API_VERSION,
            'x-content-type': 'application/json',
            'x-add-random-suffix': '0',
          },
          body: payload,
        }),
        this.timeoutMs,
        'blob_put'
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
        this.fetchImpl(`${BLOB_API}?limit=1`, {
          headers: { Authorization: `Bearer ${this.token}`, 'x-api-version': API_VERSION },
          cache: 'no-store',
        }),
        this.timeoutMs,
        'blob_ping'
      );
      await response.text();
      return {
        ok: response.ok,
        latencyMs: Date.now() - startedAt,
        detail: response.ok ? 'blob_store_reachable' : `HTTP ${response.status}`,
        observed: { durable: true },
      };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - startedAt, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
