import { formatArabicTimestamp } from './cairo-time';
import type { GatewayDatabase } from './types';

/**
 * Human-readable description of the last matches fetch: distinguishes a fresh success, a
 * failed attempt (previous data kept) and a store that has not been refreshed at all.
 */
export function describeMatchesFreshness(meta: GatewayDatabase['meta']): string | null {
  const attemptAt = meta.lastMatchesSyncAttemptAt ?? null;
  const successAt = meta.lastSuccessfulMatchesSyncAt ?? null;
  const result = meta.lastMatchesSyncResult ?? null;
  if (!attemptAt && !successAt) {
    return meta.lastLiveSyncAt
      ? `آخر تحديث للمباريات: ${formatArabicTimestamp(meta.lastLiveSyncAt)}`
      : null;
  }
  if (result && !result.ok) {
    return successAt
      ? `تعذر تحديث المباريات في آخر محاولة (${formatArabicTimestamp(attemptAt || successAt)})؛ تُعرض بيانات آخر جلب ناجح: ${formatArabicTimestamp(successAt)}`
      : `تعذر تحديث المباريات في آخر محاولة (${formatArabicTimestamp(attemptAt || '')})؛ تُعرض آخر بيانات محفوظة.`;
  }
  return successAt ? `آخر تحديث للمباريات من المصادر: ${formatArabicTimestamp(successAt)}` : null;
}
