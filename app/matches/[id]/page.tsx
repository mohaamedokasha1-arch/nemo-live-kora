import SourceMatchDetails from '@/components/SourceMatchDetails';
import React from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import {
  formatArabicFullDate,
  formatArabicTimestamp,
  getTodayCairoDate,
  isValidDateParam,
} from '@/lib/cairo-time';
import { findMatchRecordById, hydrateStore, queryGatewayMatches } from '@/lib/db/store';
import { describeMatchesFreshness } from '@/lib/freshness';
import { findServedCatalogEntryById, findServedCatalogEntryForMatch } from '@/lib/admin/served-catalog';
import { resolveMatchView, resolveUpcomingMatchViews } from '@/lib/matches/match-catalog';
import { getLatestNews } from '@/lib/news/query';
import { buildMatchLandingMetadata } from '@/lib/seo/metadata';
import {
  createMatchScheduleStructuredData,
  serializeJsonLd,
} from '@/lib/seo/match-structured-data';
import { ensureFreshMatches } from '@/lib/sync/engine';
import MatchGatewayClient from '@/components/MatchGatewayClient';
import MatchLandingView from '@/components/MatchLandingView';
import NewsSection from '@/components/NewsSection';
import SportsEventJsonLd from '@/components/SportsEventJsonLd';

/**
 * مسار ديناميكي واحد يخدم حالتين (بدون تعارض مسارات في App Router):
 *   1) /matches/2026-10-20  → جدول مباريات اليوم/التاريخ.
 *   2) /matches/[id]        → صفحة هبوط المباراة الكاملة (SportsEvent + CTA للبث).
 *
 * سبب الدمج: Next.js يمنع وجود `[date]` و`[id]` في نفس المستوى، فالحل الأنظف هو
 * مسار واحد يحلّ النوع تلقائيًا — والنتيجة نفس سلوك الجدول السابق مع صفحات الهبوط الجديدة.
 */
export const dynamic = 'force-dynamic';

async function buildDateMetadata(id: string): Promise<Metadata> {
  const queryResult = queryGatewayMatches({ cairoDate: id });
  const readableDate = formatArabicFullDate(id);
  const isToday = id === getTodayCairoDate();

  return {
    title: `مباريات ${readableDate}`,
    description: `جدول مباريات يوم ${readableDate} بتوقيت القاهرة. المواعيد والنتائج وحالات المباريات بحسب بيانات المصادر الرياضية.`,
    alternates: {
      canonical: isToday ? '/' : `/matches/${id}`,
    },
    robots: {
      index: queryResult.matches.length > 0,
      follow: true,
    },
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  if (isValidDateParam(id)) {
    return buildDateMetadata(id);
  }

  const entry = findServedCatalogEntryById(id);
  if (!entry) {
    /**
     * القراءة تمرّ بـ`findMatchRecordById`: إن كان هذا المعرّف سجلًا مُعلَّمًا كتكرار لمباراة
     * موجودة (نفس المباراة من مصدر آخر)، فالقراءة تُعاد إلى السجل الأساسي. النتيجة: الصفحة
     * القديمة تبقى تعمل بلا خطأ 404، ومحتواها هو محتوى المباراة نفسه، و`canonical` يشير إلى
     * الصفحة الأساسية — فلا يظهر المحتوى نفسه مرتين لمحركات البحث ولا للزائر.
     */
    const store = await hydrateStore();
    const match = findMatchRecordById(id, store);
    if (match && findServedCatalogEntryForMatch(match)) return buildMatchLandingMetadata(resolveMatchView(findServedCatalogEntryForMatch(match)!));
    if (match) return { title: `${match.homeTeam.nameAr} ضد ${match.awayTeam.nameAr} — ${match.competitionNameAr}`, description: `تفاصيل المباراة بتاريخ ${match.cairoDate}، النتيجة والحالة المتاحة من المصادر.`, alternates: { canonical: `/matches/${match.id}` }, robots: { index: match.kickoffConfirmed === true, follow: true } };
    return {
      title: 'الصفحة غير موجودة',
      robots: { index: false, follow: false },
    };
  }

  return buildMatchLandingMetadata(resolveMatchView(entry));
}

export default async function MatchRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  /* ---------- الحالة ①: جدول مباريات تاريخ معيّن ---------- */
  if (isValidDateParam(id)) {
    const todayCairo = getTodayCairoDate();
    if (id === todayCairo) redirect('/');

    await ensureFreshMatches();
    const store = await hydrateStore();
    const queryResult = queryGatewayMatches({ cairoDate: id });
    const jsonLd = createMatchScheduleStructuredData(id, queryResult.matches);

    return (
      <>
        {jsonLd ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
          />
        ) : null}
        <MatchGatewayClient
          selectedDate={id}
          todayCairo={todayCairo}
          allMatchesOnDate={queryResult.matches}
          freshnessNote={describeMatchesFreshness(store.meta)}
        />
        <NewsSection
          news={getLatestNews(store.news, 6)}
          lastUpdatedLabel={
            store.meta.lastSuccessfulNewsSyncAt
              ? formatArabicTimestamp(store.meta.lastSuccessfulNewsSyncAt)
              : null
          }
        />
      </>
    );
  }

  /* ---------- الحالة ②: صفحة هبوط مباراة من كتالوج data/matches.ts ---------- */
  const entry = findServedCatalogEntryById(id);
  if (!entry) {
    // معرّف سجل مُعلَّم كتكرار → يُعرض السجل الأساسي (نفس المحتوى، ورابطه هو القانوني).
    const match = findMatchRecordById(id, await hydrateStore());
    if (!match) notFound();
    const canonicalEntry = findServedCatalogEntryForMatch(match);
    if (canonicalEntry) redirect(`/matches/${canonicalEntry.id}`);
    return <SourceMatchDetails record={match} />;
  }

  const view = resolveMatchView(entry);
  const related = resolveUpcomingMatchViews(4);

  return (
    <>
      <SportsEventJsonLd view={view} />
      <MatchLandingView view={view} related={related} />
    </>
  );
}
