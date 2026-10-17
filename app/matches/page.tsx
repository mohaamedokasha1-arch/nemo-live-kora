import React from 'react';
import { buildStaticPageMetadata } from '@/lib/seo/metadata';

import { getTodayCairoDate, shiftDateString } from '@/lib/cairo-time';
import { queryGatewayMatches } from '@/lib/db/store';
import { ensureFreshMatches } from '@/lib/sync/engine';
import { landingPathsForMatches } from '@/lib/admin/served-catalog';
import MatchesScheduleTabs from '@/components/matches/MatchesScheduleTabs';

export const metadata = buildStaticPageMetadata({
  title: 'جدول المباريات | NEMO Live Kora',
  description: 'شاهد جدول المباريات الكامل لجميع البطولات العربية والعالمية',
  path: '/matches',
});


/**
 * «جدول المباريات» — تبويبا اليوم والغد من المخزن الحقيقي (نفس نظام الصفحة الرئيسية وصفحات
 * التواريخ). التاريخان يُحسبان بتوقيت القاهرة على الخادم في كل طلب، ويُجدَّد المخزن عند الطلب
 * من المصادر إذا انقضت نافذة الحداثة؛ فشل أي مصدر لا يمسح البيانات المحفوظة.
 */
export const dynamic = 'force-dynamic';

export default async function MatchesPage() {
  const todayCairo = getTodayCairoDate();
  const tomorrowCairo = shiftDateString(todayCairo, 1);

  await Promise.allSettled([ensureFreshMatches()]);

  const todayMatches = queryGatewayMatches({ cairoDate: todayCairo }).matches;
  const tomorrowMatches = queryGatewayMatches({ cairoDate: tomorrowCairo }).matches;

  return (
    <MatchesScheduleTabs
      todayCairo={todayCairo}
      tomorrowCairo={tomorrowCairo}
      todayMatches={todayMatches}
      tomorrowMatches={tomorrowMatches}
      landingPaths={landingPathsForMatches([...todayMatches, ...tomorrowMatches])}
    />
  );
}
