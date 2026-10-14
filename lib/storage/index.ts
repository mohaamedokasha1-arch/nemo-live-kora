import { readEnv } from '../config/env';
import { FileStorageDriver, MemoryStorageDriver } from './file-driver';
import { HttpSnapshotStorageDriver } from './http-driver';
import { TursoStorageDriver } from './turso-driver';
import { UpstashStorageDriver } from './upstash-driver';
import { VercelBlobStorageDriver } from './vercel-blob-driver';
import type { StorageDriver } from './types';

export type { StorageDriver, StorageDriverKind, StorageReadResult, StorageWriteResult, StoragePingResult, FetchLike } from './types';
export { FileStorageDriver, MemoryStorageDriver, HttpSnapshotStorageDriver, TursoStorageDriver, UpstashStorageDriver, VercelBlobStorageDriver };

export interface StorageSelection {
  driver: StorageDriver;
  /** Why this driver was chosen — safe to render (no secrets). */
  reason: string;
  reasonAr: string;
  /** Explicit override via NEMO_STORAGE_DRIVER, or the detected provider. */
  requested: string | null;
  /** True when a cloud backend is configured, i.e. writes are shared and survive restarts. */
  cloudConfigured: boolean;
  /** Human-readable list of what is still missing to reach durable cloud storage. */
  missingForCloud: string[];
}

/**
 * Cloud detection shared with the live durable layer. The order (Turso → Upstash/KV → Blob →
 * HTTP snapshot) is the same one `lib/db/durable-store.ts` uses, and the Upstash driver is built
 * with the durable layer's snapshot key, so this tooling and the request path read and write the
 * very same data instead of two parallel copies that could disagree.
 */
function detectCloudDriver(requested?: string | null): { driver: StorageDriver; reason: string } | null {
  // An explicit kind restricts detection to that backend, exactly as in the durable layer.
  const wants = (kind: string) => !requested || requested === 'auto' || requested === kind;
  const tursoUrl = readEnv('TURSO_DATABASE_URL') || readEnv('LIBSQL_URL') || readEnv('TURSO_DB_URL');
  const tursoToken = readEnv('TURSO_AUTH_TOKEN') || readEnv('LIBSQL_AUTH_TOKEN');
  if (wants('turso') && tursoUrl && tursoToken) {
    return {
      driver: new TursoStorageDriver({ url: tursoUrl, token: tursoToken }),
      reason: 'TURSO_DATABASE_URL + TURSO_AUTH_TOKEN',
    };
  }

  const upstashUrl =
    readEnv('UPSTASH_REDIS_REST_URL') || readEnv('KV_REST_API_URL') || readEnv('NEMO_KV_REST_URL');
  const upstashToken =
    readEnv('UPSTASH_REDIS_REST_TOKEN') || readEnv('KV_REST_API_TOKEN') || readEnv('NEMO_KV_REST_TOKEN');
  if (wants('upstash') && upstashUrl && upstashToken) {
    return {
      driver: new UpstashStorageDriver({
        url: upstashUrl,
        token: upstashToken,
        key: readEnv('NEMO_DURABLE_STORE_KEY') || 'nemo-live-kora:gateway-store',
      }),
      reason: 'UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN',
    };
  }

  const blobToken = readEnv('BLOB_READ_WRITE_TOKEN');
  if (wants('vercel-blob') && blobToken) {
    return {
      driver: new VercelBlobStorageDriver({ token: blobToken }),
      reason: 'BLOB_READ_WRITE_TOKEN',
    };
  }

  const httpUrl = readEnv('NEMO_DURABLE_STORE_URL');
  if (wants('http') && httpUrl) {
    return {
      driver: new HttpSnapshotStorageDriver({
        url: httpUrl,
        token: readEnv('NEMO_DURABLE_STORE_TOKEN') || undefined,
      }),
      reason: 'NEMO_DURABLE_STORE_URL',
    };
  }

  return null;
}

/**
 * The explicit driver selection as a `lib/storage` kind. `NEMO_STORAGE_DRIVER` is primary;
 * `NEMO_DURABLE_STORE` names are mapped onto the same kinds (redis→upstash, blob→vercel-blob)
 * so setting either selector selects the same backend everywhere.
 */
function requestedKind(): string | null {
  const storage = readEnv('NEMO_STORAGE_DRIVER').toLowerCase();
  if (storage && storage !== 'auto') return storage;
  const durable = readEnv('NEMO_DURABLE_STORE').toLowerCase();
  if (!durable || durable === 'auto') return null;
  if (durable === 'redis' || durable === 'kv') return 'upstash';
  if (durable === 'blob') return 'vercel-blob';
  if (durable === 'off') return 'memory';
  return durable;
}

/**
 * Picks the storage backend.
 *
 * Order: explicit `NEMO_STORAGE_DRIVER` override → detected cloud backend → local file.
 * The local file is a real backend on a VPS/container with a mounted volume; on Vercel it is
 * reported as non-durable so nothing downstream can claim persistence it does not have.
 */
export function selectStorageDriver(): StorageSelection {
  const requested = requestedKind();
  const cloud = detectCloudDriver(requested);

  const missingForCloud: string[] = [];
  if (!readEnv('TURSO_DATABASE_URL') && !readEnv('LIBSQL_URL')) missingForCloud.push('TURSO_DATABASE_URL');
  if (!readEnv('TURSO_AUTH_TOKEN') && !readEnv('LIBSQL_AUTH_TOKEN')) missingForCloud.push('TURSO_AUTH_TOKEN');
  if (!readEnv('UPSTASH_REDIS_REST_URL') && !readEnv('KV_REST_API_URL')) missingForCloud.push('UPSTASH_REDIS_REST_URL');
  if (!readEnv('UPSTASH_REDIS_REST_TOKEN') && !readEnv('KV_REST_API_TOKEN')) missingForCloud.push('UPSTASH_REDIS_REST_TOKEN');
  if (!readEnv('BLOB_READ_WRITE_TOKEN')) missingForCloud.push('BLOB_READ_WRITE_TOKEN');
  if (!readEnv('NEMO_DURABLE_STORE_URL')) missingForCloud.push('NEMO_DURABLE_STORE_URL');

  if (requested === 'memory') {
    return {
      driver: new MemoryStorageDriver(),
      reason: 'NEMO_STORAGE_DRIVER=memory',
      reasonAr: 'مخزن ذاكرة مؤقت (اختبارات فقط) — غير دائم.',
      requested,
      cloudConfigured: false,
      missingForCloud,
    };
  }

  if (requested && requested !== 'file' && requested !== 'auto') {
    if (!cloud || cloud.driver.kind !== requested) {
      return {
        driver: new FileStorageDriver(),
        reason: `requested=${requested} but its credentials are not configured; fell back to the local file driver`,
        reasonAr: `طُلب المخزن ${requested} لكن مفاتيحه غير مضبوطة؛ تم الرجوع إلى الملف المحلي غير الدائم.`,
        requested,
        cloudConfigured: false,
        missingForCloud,
      };
    }
  }

  if (cloud) {
    return {
      driver: cloud.driver,
      reason: `detected ${cloud.reason}`,
      reasonAr:
        cloud.driver.kind === 'turso'
          ? 'قاعدة بيانات Turso/libSQL سحابية — كتابة دائمة ومشتركة بين كل الطلبات.'
          : cloud.driver.kind === 'upstash'
          ? 'قاعدة Upstash Redis سحابية — كتابة دائمة ومشتركة.'
          : cloud.driver.kind === 'http'
          ? 'نقطة HTTP للقطة الدائمة — كتابة دائمة ومشتركة.'
          : 'تخزين Vercel Blob — كتابة دائمة ومشتركة.',
      requested,
      cloudConfigured: true,
      missingForCloud,
    };
  }

  return {
    driver: new FileStorageDriver(),
    reason: 'no cloud storage credentials found; using the local file driver',
    reasonAr:
      'لم يتم ضبط مفاتيح تخزين سحابي؛ يُستخدم الملف المحلي. على Vercel هذا التخزين غير دائم ويجب ضبط TURSO_DATABASE_URL/TURSO_AUTH_TOKEN.',
    requested,
    cloudConfigured: false,
    missingForCloud,
  };
}

let activeSelection: StorageSelection | null = null;

/** Process-wide storage driver. Cached so a single request does not rebuild clients. */
export function getStorageDriver(): StorageDriver {
  return getStorageSelection().driver;
}

export function getStorageSelection(): StorageSelection {
  if (!activeSelection) {
    activeSelection = selectStorageDriver();
  }
  return activeSelection;
}

/** Test hook: swap the active driver (used by the storage and cron tests). */
export function setStorageDriverForTesting(selection: StorageSelection | StorageDriver | null): void {
  if (selection === null) {
    activeSelection = null;
    return;
  }
  if ('driver' in selection) {
    activeSelection = selection;
    return;
  }
  activeSelection = {
    driver: selection,
    reason: 'injected_for_test',
    reasonAr: 'مخزن مُحقن للاختبار.',
    requested: null,
    cloudConfigured: selection.isDurable(),
    missingForCloud: [],
  };
}

/** Safe, secret-free description of the active backend for dashboards and logs. */
export function describeStorage() {
  const selection = getStorageSelection();
  const description = selection.driver.describe();
  return {
    kind: description.kind,
    target: description.target,
    durable: selection.driver.isDurable(),
    labelAr: selection.driver.labelAr,
    reason: selection.reason,
    reasonAr: selection.reasonAr,
    cloudConfigured: selection.cloudConfigured,
    missingForCloud: selection.missingForCloud,
  };
}
