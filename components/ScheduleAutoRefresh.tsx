'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getTodayCairoDate } from '@/lib/cairo-time';

/** How often an open schedule page re-reads the server while a match on it is live. */
export const LIVE_SCHEDULE_REFRESH_MS = 2 * 60_000;
/** How often an open schedule page re-reads the server otherwise. */
export const IDLE_SCHEDULE_REFRESH_MS = 10 * 60_000;
const TICK_MS = 30_000;

/**
 * يقرّر هل يجب إعادة قراءة الجدول من الخادم الآن. دالة صافية (بلا متصفح) حتى تُختبر:
 *  - تغيّر تاريخ القاهرة منذ رسم الصفحة (منتصف الليل بتوقيت مصر) ⇒ نعم فورًا، فينتقل «اليوم»
 *    و«الغد» إلى التاريخين الجديدين دون أن يعيد الزائر تحميل الصفحة.
 *  - مرّت فترة التحديث (أقصر عند وجود مباراة جارية) ⇒ نعم.
 */
export function shouldRefreshSchedule(params: {
  renderedTodayCairo: string;
  nowCairo: string;
  msSinceLastRefresh: number;
  hasLiveMatches: boolean;
}): boolean {
  if (params.nowCairo && params.nowCairo !== params.renderedTodayCairo) return true;
  const interval = params.hasLiveMatches ? LIVE_SCHEDULE_REFRESH_MS : IDLE_SCHEDULE_REFRESH_MS;
  return params.msSinceLastRefresh >= interval;
}

/**
 * تحديث تلقائي لصفحة الجدول المفتوحة — لا يرسم أي عنصر (لا تغيير في التصميم).
 * يعيد قراءة مكوّنات الخادم فقط (`router.refresh`)، والخادم نفسه يقرر هل يجلب من المصادر
 * (نافذة الحداثة في `ensureFreshMatches`) — فلا يزيد هذا المكوّن الضغط على مزوّدي البيانات.
 * لا يعمل والتبويب مخفي، ويتحقق فور عودة الزائر إليه.
 */
export default function ScheduleAutoRefresh({
  todayCairo,
  hasLiveMatches,
}: {
  todayCairo: string;
  hasLiveMatches: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    let lastRefresh = Date.now();
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (
        shouldRefreshSchedule({
          renderedTodayCairo: todayCairo,
          nowCairo: getTodayCairoDate(),
          msSinceLastRefresh: Date.now() - lastRefresh,
          hasLiveMatches,
        })
      ) {
        lastRefresh = Date.now();
        router.refresh();
      }
    };
    const timer = window.setInterval(tick, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [todayCairo, hasLiveMatches, router]);

  return null;
}
