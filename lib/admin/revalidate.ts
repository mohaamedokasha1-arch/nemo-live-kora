import { revalidatePath } from 'next/cache';
import { getTodayCairoDate, shiftDateString } from '../cairo-time';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  إبطال الكاش لصفحات الموقع بعد أي تعديل إداري
 * ═══════════════════════════════════════════════════════════════════════════════
 *  لماذا وحدة واحدة؟ لأن التعديل الإداري **يُحفظ فعلًا** في المخزن قبل هذه الخطوة،
 *  فإذا فشل إبطال الكاش لأي سبب لا يجوز أن يعود للمدير ردٌّ بالفشل على عملية نجحت.
 *  (خارج سياق طلب Next — مثل تشغيل سكربت أو اختبار — لا يوجد «مخزن توليد» أصلًا،
 *  و`revalidatePath` ترمي استثناءً؛ نحن نتجاهله لأن الصفحات ستُبنى من البيانات الجديدة
 *  في أول طلب.)
 */
export function revalidatePublicPaths(paths: Array<string | null | undefined>): string[] {
  const applied: string[] = [];
  for (const path of paths) {
    if (!path) continue;
    try {
      revalidatePath(path);
      applied.push(path);
    } catch {
      // لا سياق طلب ⇒ لا كاش صفحة ليُبطَل؛ البيانات المخزَّنة هي المصدر عند أول عرض.
    }
  }
  return applied;
}

/**
 * صفحات المباريات في التقويم المصري (`/matches/<تاريخ>`) — وهي صفحات تتغيّر يوميًا،
 * فكتابة تاريخ ثابت في الكود كانت تُبطل صفحة يوم واحد فقط وتترك البقية قديمة.
 */
export function cairoDatePagePaths(referenceDate = new Date()): string[] {
  const today = getTodayCairoDate(referenceDate);
  return [
    `/matches/${shiftDateString(today, -1)}`,
    `/matches/${today}`,
    `/matches/${shiftDateString(today, 1)}`,
  ];
}
