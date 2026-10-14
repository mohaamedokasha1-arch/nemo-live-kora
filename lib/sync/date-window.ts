import { shiftDateString } from '../cairo-time';

/**
 * نافذة التواريخ للمزامنة — قابلة للضبط بالمتغيّرات البيئية بلا إعادة كتابة للكود.
 *
 *  - `NEMO_SYNC_DAYS_BACK`  عدد الأيام السابقة (الافتراضي 1 = الأمس لاستكمال النتائج، الحد الأقصى 30).
 *  - `NEMO_SYNC_DAYS_AHEAD` عدد الأيام القادمة بعد اليوم (الافتراضي 7، الحد الأقصى 14).
 *
 * الحدود تُفرض هنا (قيم غير صالحة ترجع للافتراضي، والقيم الكبيرة تُقصّ للحد الأقصى) حتى لا
 * يتحوّل متغير خاطئ إلى مئات طلبات الشبكة في كل تشغيل.
 *
 * الأيام الداخلة في النافذة هي ما **يُطلب** من كل مصدر؛ ما يدعمه المصدر فعليًا (نتائج تاريخية،
 * أيام مستقبلية) يتحدد عند الجلب وليس هنا.
 */

export const SYNC_WINDOW_MAX_DAYS_BACK = 30;
export const SYNC_WINDOW_MAX_DAYS_AHEAD = 14;
export const SYNC_WINDOW_DEFAULT_DAYS_BACK = 1;
export const SYNC_WINDOW_DEFAULT_DAYS_AHEAD = 7;

export interface SyncDateWindow {
  todayCairo: string;
  /** أول يوم في النافذة (الأقدم) */
  from: string;
  /** آخر يوم في النافذة (الأحدث) */
  to: string;
  /** كل التواريخ من الأقدم إلى الأحدث، بصيغة YYYY-MM-DD بتوقيت القاهرة */
  dates: string[];
  daysBack: number;
  daysAhead: number;
  /** `wide` للتشغيل المجدول، و`quick` للتحديث عند الطلب (الأمس/اليوم/غدًا فقط). */
  profile: 'wide' | 'quick';
}

/** يحوّل قيمة متغير بيئي إلى عدد صحيح ضمن الحدود؛ القيمة غير الصالحة ترجع للافتراضي. */
export function parseWindowDays(
  raw: string | undefined | null,
  fallback: number,
  max: number
): number {
  const trimmed = (raw ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value) || value < 0) return fallback;
  return Math.min(value, max);
}

export function readSyncWindowConfig(env: Record<string, string | undefined> = process.env): {
  daysBack: number;
  daysAhead: number;
} {
  return {
    daysBack: parseWindowDays(
      env.NEMO_SYNC_DAYS_BACK,
      SYNC_WINDOW_DEFAULT_DAYS_BACK,
      SYNC_WINDOW_MAX_DAYS_BACK
    ),
    daysAhead: parseWindowDays(
      env.NEMO_SYNC_DAYS_AHEAD,
      SYNC_WINDOW_DEFAULT_DAYS_AHEAD,
      SYNC_WINDOW_MAX_DAYS_AHEAD
    ),
  };
}

/** نافذة كاملة للتشغيل المجدول: من (اليوم − daysBack) إلى (اليوم + daysAhead). */
export function resolveWideSyncWindow(
  todayCairo: string,
  config: { daysBack: number; daysAhead: number }
): SyncDateWindow {
  const daysBack = Math.min(Math.max(0, Math.floor(config.daysBack)), SYNC_WINDOW_MAX_DAYS_BACK);
  const daysAhead = Math.min(Math.max(0, Math.floor(config.daysAhead)), SYNC_WINDOW_MAX_DAYS_AHEAD);
  const dates: string[] = [];
  for (let offset = -daysBack; offset <= daysAhead; offset += 1) {
    dates.push(shiftDateString(todayCairo, offset));
  }
  return {
    todayCairo,
    from: dates[0],
    to: dates[dates.length - 1],
    dates,
    daysBack,
    daysAhead,
    profile: 'wide',
  };
}

/** النافذة السريعة المستخدمة عند الطلب: الأمس واليوم وغدًا (كما كانت دائمًا). */
export function resolveQuickSyncWindow(todayCairo: string): SyncDateWindow {
  const dates = [-1, 0, 1].map((offset) => shiftDateString(todayCairo, offset));
  return {
    todayCairo,
    from: dates[0],
    to: dates[2],
    dates,
    daysBack: 1,
    daysAhead: 1,
    profile: 'quick',
  };
}

/** يختار النافذة حسب نوع التشغيل: الواسعة للمزامنة المجدولة/اليدوية، والسريعة للتحديث عند الطلب. */
export function resolveSyncWindowForRun(params: {
  todayCairo: string;
  wide: boolean;
  env?: Record<string, string | undefined>;
}): SyncDateWindow {
  if (!params.wide) return resolveQuickSyncWindow(params.todayCairo);
  return resolveWideSyncWindow(params.todayCairo, readSyncWindowConfig(params.env));
}
