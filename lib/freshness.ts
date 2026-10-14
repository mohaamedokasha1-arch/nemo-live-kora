import { formatArabicTimestamp } from './cairo-time';
import type { GatewayDatabase } from './types';

/**
 * سطر حالة ودود للزائر — **نجاح فقط، بلا أي ذكر لفشل**.
 *
 * كان يعرض عبارات من نوع «تعذر تحديث المباريات في آخر محاولة…» لكل زائر، وهو ما يجعل
 * الموقع يبدو معطّلًا أو تجريبيًا رغم أن البيانات المعروضة سليمة ومحفوظة. أخطاء المزامنة
 * مكانها سجلّات الخادم ولوحة الإدارة (`/api/cron/*` و`/admin`)، لا واجهة الزائر.
 */
export function describeMatchesFreshness(meta: GatewayDatabase['meta']): string | null {
  const successAt = meta.lastSuccessfulMatchesSyncAt ?? null;
  if (successAt) return `آخر تحديث للمباريات: ${formatArabicTimestamp(successAt)}`;
  // بلا وقت نجاح مسجّل: نعرض آخر وقت تحديث عام إن وُجد، وإلا نصمت بدل عرض رسالة فشل.
  return meta.lastLiveSyncAt ? `آخر تحديث للمباريات: ${formatArabicTimestamp(meta.lastLiveSyncAt)}` : null;
}
