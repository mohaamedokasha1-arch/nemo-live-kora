import { FileStorageDriver, MemoryStorageDriver } from './file-driver';
import type { StorageDriver } from './types';

export type { StorageDriver, StorageDriverKind, StorageReadResult, StorageWriteResult, StoragePingResult } from './types';
export { FileStorageDriver, MemoryStorageDriver };

export interface StorageSelection {
  driver: StorageDriver;
  /** Why this driver was chosen — safe to render. */
  reason: string;
  reasonAr: string;
  /** Kept for API compatibility: the application no longer uses any external database. */
  requested: string | null;
  /** Always false: there is no external storage backend. */
  cloudConfigured: boolean;
  /** Always empty: no configuration is required from the operator. */
  missingForCloud: string[];
}

/**
 * Picks the storage backend. The application is self-contained: it always uses the structured JSON
 * file resolved for the current runtime (see `lib/db/durable-store.ts`). Nothing has to be
 * configured, and nothing is reached over the network.
 */
export function selectStorageDriver(): StorageSelection {
  const onServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
  return {
    driver: new FileStorageDriver(),
    reason: onServerless
      ? 'local structured JSON in the runtime temp directory (warm-instance cache)'
      : 'local structured JSON in data/ (persists on this host)',
    reasonAr: onServerless
      ? 'ملف JSON محلي مهيكل في /tmp — ذاكرة للنسخة الدافئة فقط، وتُعاد تهيئتها عند البدء البارد.'
      : 'ملف JSON محلي مهيكل في مجلد data/ — يبقى بعد إعادة التشغيل على هذا الخادم.',
    requested: null,
    cloudConfigured: false,
    missingForCloud: [],
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
    cloudConfigured: false,
    missingForCloud: [],
  };
}

/** Safe description of the active backend for dashboards and logs. */
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
