import { readEnv } from '../config/env';
import { FileStorageDriver, MemoryStorageDriver } from './file-driver';
import { TursoStorageDriver } from './turso-driver';
import { UpstashStorageDriver } from './upstash-driver';
import { VercelBlobStorageDriver } from './vercel-blob-driver';
import type { StorageDriver } from './types';

export type { StorageDriver, StorageDriverKind, StorageReadResult, StorageWriteResult, StoragePingResult, FetchLike } from './types';
export { FileStorageDriver, MemoryStorageDriver, TursoStorageDriver, UpstashStorageDriver, VercelBlobStorageDriver };

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

function detectCloudDriver(): { driver: StorageDriver; reason: string } | null {
  const tursoUrl = readEnv('TURSO_DATABASE_URL') || readEnv('LIBSQL_URL') || readEnv('TURSO_DB_URL');
  const tursoToken = readEnv('TURSO_AUTH_TOKEN') || readEnv('LIBSQL_AUTH_TOKEN');
  if (tursoUrl && tursoToken) {
    return {
      driver: new TursoStorageDriver({ url: tursoUrl, token: tursoToken }),
      reason: 'TURSO_DATABASE_URL + TURSO_AUTH_TOKEN',
    };
  }

  const upstashUrl = readEnv('UPSTASH_REDIS_REST_URL') || readEnv('KV_REST_API_URL');
  const upstashToken = readEnv('UPSTASH_REDIS_REST_TOKEN') || readEnv('KV_REST_API_TOKEN');
  if (upstashUrl && upstashToken) {
    return {
      driver: new UpstashStorageDriver({ url: upstashUrl, token: upstashToken }),
      reason: 'UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN',
    };
  }

  const blobToken = readEnv('BLOB_READ_WRITE_TOKEN');
  if (blobToken) {
    return {
      driver: new VercelBlobStorageDriver({ token: blobToken }),
      reason: 'BLOB_READ_WRITE_TOKEN',
    };
  }

  return null;
}

/**
 * Picks the storage backend.
 *
 * Order: explicit `NEMO_STORAGE_DRIVER` override → detected cloud backend → local file.
 * The local file is a real backend on a VPS/container with a mounted volume; on Vercel it is
 * reported as non-durable so nothing downstream can claim persistence it does not have.
 */
export function selectStorageDriver(): StorageSelection {
  const requested = readEnv('NEMO_STORAGE_DRIVER').toLowerCase() || null;
  const cloud = detectCloudDriver();

  const missingForCloud: string[] = [];
  if (!readEnv('TURSO_DATABASE_URL') && !readEnv('LIBSQL_URL')) missingForCloud.push('TURSO_DATABASE_URL');
  if (!readEnv('TURSO_AUTH_TOKEN') && !readEnv('LIBSQL_AUTH_TOKEN')) missingForCloud.push('TURSO_AUTH_TOKEN');
  if (!readEnv('UPSTASH_REDIS_REST_URL') && !readEnv('KV_REST_API_URL')) missingForCloud.push('UPSTASH_REDIS_REST_URL');
  if (!readEnv('UPSTASH_REDIS_REST_TOKEN') && !readEnv('KV_REST_API_TOKEN')) missingForCloud.push('UPSTASH_REDIS_REST_TOKEN');
  if (!readEnv('BLOB_READ_WRITE_TOKEN')) missingForCloud.push('BLOB_READ_WRITE_TOKEN');

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
