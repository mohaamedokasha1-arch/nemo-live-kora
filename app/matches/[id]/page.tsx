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
import { hydrateStore, queryGatewayMatches } from '@/lib/db/store';
import { describeMatchesFreshness } from '@/lib/freshness';
import { landingPathsForMatches } from '@/lib/admin/served-catalog';
import { resolveMatchView, resolveUpcomingMatchViews } from '@/lib/matches/match-catalog';
import {
  resolveMatchDetailTarget,
  redirectIfAlias,
  type MatchDetailTarget,
} from '@/lib/matches/resolve-match';
import { getLatestNews } from '@/lib/news/query';
import { buildMatchLandingMetadata } from '@/lib/seo/metadata';
import {
  createMatchScheduleStructuredData,
  serializeJsonLd,
} from '@/lib/seo/match-structured-data';
import { ensureFreshMatches } from '@/lib/sync/engine';
import MatchGatewayClient from '@/components/MatchGatewayClient';
import MatchLandingView from '@/components/MatchLandingView';
import MatchUnavailableView from '@/components/MatchUnavailableView';
import NewsSection from '@/components/NewsSection';
import SportsEventJsonLd from '@/components/SportsEventJsonLd';
import type { MatchRecord } from '@/lib/types';

/**
 * مسار ديناميكي واحد يخدم حالتين (بدون تعارض مسارات في App Router):
 *   1) /matches/2026-10-20  → جدول مباريات اليوم/التاريخ.
 *   2) /matches/[id]        → صفحة هبوط المباراة الكاملة (SportsEvent + CTA للبث).
 *
 * سبب الدمج: Next.js يمنع وجود `[date]` و`[id]` في نفس المستوى، فالحل الأنظف هو
 * مسار واحد يحلّ النوع تلقائيًا — والنتيجة نفس سلوك الجدول السابق مع صفحات الهبوط الجديدة.
 *
 * 🔧 إصلاح جذري (2026-10-17): كان النقر على أي مباراة مُزامَنة حديثًا يُنتج 404 في
 * الإنتاج — لأن قراءة السجل كانت تعتمد على مخزن النسخة الباردة فقط (لقطة البذرة)،
 * بينما تُخزَّن المباريات الحديثة في نسخة أخرى. الآن الصفحة **تُشغّل تحديث الجدول
 * عند الطلب ثم تستعيد السجل بمعرّف المزوّد** (`lib/matches/resolve-match.ts`)، وتعرض
 * fallback أنيقًا بلا 404 عندما يحمل المعرّف هوية مباراة حقيقية بياناتها غير متاحة.
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

/** بيانات وصف سجل مباراة من المخزن — بنفس الصيغة التي تُبنى بها صفحات الهبوط. */
function buildRecordMetadata(record: MatchRecord): Metadata {
  return {
    title: `${record.homeTeam.nameAr} ضد ${record.awayTeam.nameAr} — ${record.competitionNameAr}`,
    description: `تفاصيل المباراة بتاريخ ${record.cairoDate}، النتيجة والحالة المتاحة من المصادر.`,
    alternates: { canonical: `/matches/${record.id}` },
    robots: { index: record.kickoffConfirmed === true, follow: true },
  };
}

/**
 * وصف الصفحة لحالة عدم التوفّر:
 *   • معرّف بهوية مزوّد (مباراة حقيقية بياناتها غير متاحة الآن) → صفحة fallback بـ 200
 *     لكنها `noindex` — ليست 404 ولا soft-404 مفهرسًا.
 *   • معرّف مجهول بلا صلة بأي مباراة → وصف 404 صريح.
 */
function buildUnavailableMetadata(target: MatchDetailTarget): Metadata {
  if (target.kind === 'unavailable' && target.hint.provider !== 'unknown') {
    return {
      title: 'تفاصيل المباراة غير متاحة حالياً',
      description: 'بيانات هذه المباراة غير متاحة من المصادر الرياضية الآن.',
      robots: { index: false, follow: true },
    };
  }
  return {
    title: 'الصفحة غير موجودة',
    robots: { index: false, follow: false },
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

  /**
   * نفس محول الوجهة الذي تستخدمه الصفحة — فلا يختلف وصف الصفحة عن محتواها أبدًا
   * (بما فيها سجلات الاستعادة من المزوّد: إن استعادتها الصفحة وصفتها، وُصفت هنا).
   */
  const target = await resolveMatchDetailTarget(id);
  switch (target.kind) {
    case 'catalog':
      return buildMatchLandingMetadata(resolveMatchView(target.entry));
    case 'alias':
      // المعرّف القديم يبقى بلا 404، و`canonical` يشير إلى الصفحة القانونية.
      return buildMatchLandingMetadata(resolveMatchView(target.entry));
    case 'record':
      return buildRecordMetadata(target.record);
    default:
      return buildUnavailableMetadata(target);
  }
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
          landingPaths={landingPathsForMatches(queryResult.matches)}
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

  /* ---------- الحالة ②: تفاصيل مباراة (كتالوج / سجل مصدر / استعادة من المزوّد) ---------- */
  const target = await resolveMatchDetailTarget(id);
  redirectIfAlias(target);

  if (target.kind === 'catalog') {
    const view = resolveMatchView(target.entry);
    const related = resolveUpcomingMatchViews(4);
    return (
      <>
        <SportsEventJsonLd view={view} />
        <MatchLandingView view={view} related={related} />
      </>
    );
  }

  if (target.kind === 'record') {
    return <SourceMatchDetails record={target.record} />;
  }

  /* حالة عدم التوفّر: معرّف بهوية مباراة حقيقية → fallback أنيق؛ مجهول → 404 صريح. */
  if (target.kind === 'unavailable' && target.hint.provider !== 'unknown') {
    return <MatchUnavailableView hint={target.hint} />;
  }

  notFound();
}
