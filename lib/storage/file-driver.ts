import fs from 'fs';
import path from 'path';
import type { GatewayDatabase } from '../types';
import {
  FetchLike,
  StorageDriver,
  StoragePingResult,
  StorageReadResult,
  StorageWriteResult,
  isGatewayDatabaseShape,
} from './types';

export const DEFAULT_DATA_DIR = path.join(process.cwd(), 'data');
export const DEFAULT_STORE_FILE = 'gateway-store.json';

/**
 * Local file driver.
 *
 * This is the development and self-hosted-VPS backend, and the local mirror the cloud drivers
 * also write. It is NOT durable on serverless hosts: each lambda gets its own ephemeral disk,
 * so `isDurable()` reports false when the app detects a serverless runtime. The sync endpoint
 * uses that flag to refuse reporting success.
 */
export class FileStorageDriver implements StorageDriver {
  readonly kind = 'file' as const;
  readonly labelAr = 'ملف محلي (data/gateway-store.json)';
  private readonly dir: string;
  private readonly file: string;
  /** Forced via NEMO_STORAGE_FILE_DURABLE=true on a real server with a persistent volume. */
  private readonly forceDurable: boolean;

  constructor(options?: { dir?: string; file?: string; durable?: boolean }) {
    const overrideDir = options?.dir || process.env.NEMO_DATA_DIR || '';
    const overrideFile = options?.file || '';
    this.dir = overrideDir || DEFAULT_DATA_DIR;
    // The default location is written as a statically scoped path so the bundler does not have
    // to trace the whole project; only an explicit override takes the dynamic branch.
    this.file = overrideDir
      ? path.join(/* turbopackIgnore: true */ overrideDir, overrideFile || DEFAULT_STORE_FILE)
      : path.join(process.cwd(), 'data', overrideFile || DEFAULT_STORE_FILE);
    this.forceDurable =
      options?.durable ??
      (process.env.NEMO_STORAGE_FILE_DURABLE || '').trim().toLowerCase() === 'true';
  }

  get filePath(): string {
    return this.file;
  }

  isDurable(): boolean {
    if (this.forceDurable) return true;
    // Serverless filesystems are per-instance scratch space: not shared, not persistent.
    return !(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
  }

  describe() {
    return {
      kind: this.kind,
      target: this.file,
      durable: this.isDurable(),
    };
  }

  async read(): Promise<StorageReadResult> {
    const startedAt = Date.now();
    try {
      if (!fs.existsSync(this.file)) {
        return { ok: false, database: null, bytes: 0, origin: this.file, latencyMs: Date.now() - startedAt, error: 'file_not_found' };
      }
      const raw = fs.readFileSync(this.file, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!isGatewayDatabaseShape(parsed)) {
        return { ok: false, database: null, bytes: raw.length, origin: this.file, latencyMs: Date.now() - startedAt, error: 'invalid_shape' };
      }
      return { ok: true, database: parsed, bytes: raw.length, origin: this.file, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        database: null,
        bytes: 0,
        origin: this.file,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async write(database: GatewayDatabase): Promise<StorageWriteResult> {
    const startedAt = Date.now();
    const payload = JSON.stringify(database, null, 2);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      // tmp + rename keeps a concurrent reader from ever seeing a half-written document.
      const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporary, payload, 'utf-8');
      fs.renameSync(temporary, this.file);
      return {
        ok: true,
        bytes: Buffer.byteLength(payload),
        writtenAt: new Date().toISOString(),
        mirror: { matches: 0, news: 0, standings: 0 },
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        bytes: 0,
        writtenAt: new Date().toISOString(),
        mirror: { matches: 0, news: 0, standings: 0 },
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async ping(): Promise<StoragePingResult> {
    const startedAt = Date.now();
    const readable = fs.existsSync(this.file);
    let writable = false;
    let detail = 'readable';
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const probe = path.join(this.dir, `.write-probe-${process.pid}`);
      fs.writeFileSync(probe, 'ok', 'utf-8');
      fs.rmSync(probe, { force: true });
      writable = true;
      detail = readable ? 'readable+writable' : 'writable_only';
    } catch (error) {
      detail = `read_only:${error instanceof Error ? error.message : String(error)}`;
    }
    return {
      ok: writable,
      latencyMs: Date.now() - startedAt,
      detail,
      observed: { fileExists: readable, writable, durable: this.isDurable() },
    };
  }
}

/** In-process driver used by the test-suite; never touches disk or network. */
export class MemoryStorageDriver implements StorageDriver {
  readonly kind = 'memory' as const;
  readonly labelAr = 'ذاكرة مؤقتة (للاختبارات فقط)';
  private payload: string | null = null;
  readonly writes: GatewayDatabase[] = [];

  isDurable(): boolean {
    return false;
  }

  describe() {
    return { kind: this.kind, target: 'process-memory', durable: false };
  }

  async read(): Promise<StorageReadResult> {
    if (!this.payload) {
      return { ok: false, database: null, bytes: 0, origin: 'memory', latencyMs: 0, error: 'empty' };
    }
    const parsed = JSON.parse(this.payload) as GatewayDatabase;
    return { ok: true, database: parsed, bytes: this.payload.length, origin: 'memory', latencyMs: 0 };
  }

  async write(database: GatewayDatabase): Promise<StorageWriteResult> {
    this.payload = JSON.stringify(database);
    this.writes.push(database);
    return {
      ok: true,
      bytes: this.payload.length,
      writtenAt: new Date().toISOString(),
      mirror: { matches: 0, news: 0, standings: 0 },
      latencyMs: 0,
    };
  }

  async ping(): Promise<StoragePingResult> {
    return { ok: true, latencyMs: 0, detail: 'memory_driver', observed: { writes: this.writes.length } };
  }
}

export type { FetchLike };
