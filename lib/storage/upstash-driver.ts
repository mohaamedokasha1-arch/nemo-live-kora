import type { GatewayDatabase } from '../types';
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

export interface UpstashDriverOptions {
  /** e.g. https://eu1-xxxx.upstash.io (UPSTASH_REDIS_REST_URL) */
  url: string;
  token: string;
  key?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Upstash Redis (REST) driver.
 *
 * Alternative cloud backend for deployments that already run Upstash/Vercel KV. It is durable
 * and shared across instances. The structured mirror is kept as separate keys so the data can
 * still be inspected without downloading the whole document.
 */
export class UpstashStorageDriver implements StorageDriver {
  readonly kind = 'upstash' as const;
  readonly labelAr = 'قاعدة بيانات Upstash Redis سحابية';
  private readonly url: string;
  private readonly token: string;
  private readonly key: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: UpstashDriverOptions) {
    this.url = options.url.replace(/\/+$/, '');
    this.token = options.token;
    this.key = options.key || 'nemo:gateway';
    this.fetchImpl = resolveFetch(options.fetchImpl);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  isDurable(): boolean {
    return true;
  }

  describe() {
    let target = this.url;
    try {
      target = new URL(this.url).host;
    } catch {
      /* keep raw */
    }
    return { kind: this.kind, target, durable: true };
  }

  private async command<T>(
    path: string,
    init: { method?: string; body?: string } = {}
  ): Promise<{ ok: boolean; status: number | null; result: T | null; error?: string }> {
    try {
      const response = await withTimeout(
        this.fetchImpl(`${this.url}/${path}`, {
          method: init.method || 'GET',
          headers: {
            Authorization: `Bearer ${this.token}`,
            ...(init.body ? { 'Content-Type': 'text/plain' } : {}),
          },
          body: init.body,
          cache: 'no-store',
        }),
        this.timeoutMs,
        'upstash'
      );
      const rawText = await response.text();
      if (!response.ok) {
        return { ok: false, status: response.status, result: null, error: `HTTP ${response.status}: ${rawText.slice(0, 200)}` };
      }
      let parsed: { result?: T; error?: string } = {};
      try {
        parsed = JSON.parse(rawText) as { result?: T; error?: string };
      } catch {
        return { ok: false, status: response.status, result: null, error: 'invalid_json_response' };
      }
      if (parsed.error) {
        return { ok: false, status: response.status, result: null, error: String(parsed.error).slice(0, 200) };
      }
      return { ok: true, status: response.status, result: parsed.result ?? null };
    } catch (error) {
      return { ok: false, status: null, result: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async read(): Promise<StorageReadResult> {
    const startedAt = Date.now();
    const response = await this.command<string>(`get/${encodeURIComponent(this.key)}`);
    if (!response.ok) {
      return { ok: false, database: null, bytes: 0, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: response.error };
    }
    if (!response.result) {
      return { ok: false, database: null, bytes: 0, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: 'empty_store' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.result);
    } catch {
      return { ok: false, database: null, bytes: response.result.length, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: 'payload_not_json' };
    }
    if (!isGatewayDatabaseShape(parsed)) {
      return { ok: false, database: null, bytes: response.result.length, origin: this.describe().target, latencyMs: Date.now() - startedAt, error: 'invalid_shape' };
    }
    return { ok: true, database: parsed, bytes: response.result.length, origin: this.describe().target, latencyMs: Date.now() - startedAt };
  }

  async write(database: GatewayDatabase): Promise<StorageWriteResult> {
    const startedAt = Date.now();
    const payload = JSON.stringify(database);
    const writtenAt = new Date().toISOString();
    const response = await this.command('set', { method: 'POST', body: JSON.stringify([this.key, payload]) });
    if (!response.ok) {
      return {
        ok: false,
        bytes: 0,
        writtenAt,
        mirror: { matches: 0, news: 0, standings: 0 },
        latencyMs: Date.now() - startedAt,
        error: response.error,
      };
    }
    // Structured mirror: counts + index of ids, so the dataset stays inspectable.
    const mirrorBody = JSON.stringify([
      `${this.key}:mirror`,
      JSON.stringify({
        writtenAt,
        matches: database.matches.length,
        news: database.news.length,
        publishedNews: database.news.filter((n) => n.publishStatus === 'published').length,
        standings: Object.keys(database.standings || {}),
        matchIds: database.matches.map((m) => m.id).slice(0, 500),
      }),
    ]);
    const mirrorResponse = await this.command('set', { method: 'POST', body: mirrorBody });
    return {
      ok: true,
      bytes: Buffer.byteLength(payload),
      writtenAt,
      mirror: {
        matches: mirrorResponse.ok ? database.matches.length : 0,
        news: mirrorResponse.ok ? database.news.length : 0,
        standings: mirrorResponse.ok ? Object.keys(database.standings || {}).length : 0,
      },
      latencyMs: Date.now() - startedAt,
    };
  }

  async ping(): Promise<StoragePingResult> {
    const startedAt = Date.now();
    const response = await this.command<string>('ping');
    return {
      ok: response.ok && String(response.result).toUpperCase() === 'PONG',
      latencyMs: Date.now() - startedAt,
      detail: response.ok ? `redis_${response.result}` : response.error || 'ping_failed',
      observed: { durable: true, pong: response.ok },
    };
  }
}
