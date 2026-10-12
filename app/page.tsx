import React from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { formatArabicTimestamp, getTodayCairoDate, isValidDateParam } from '@/lib/cairo-time';
import { getGatewayDatabase, queryGatewayMatches } from '@/lib/db/store';
import { getLatestNews } from '@/lib/news/query';
import MatchGatewayClient from '@/components/MatchGatewayClient';
import NewsSection from '@/components/NewsSection';
import {
  createMatchScheduleStructuredData,
  serializeJsonLd,
} from '@/lib/seo/match-structured-data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'جدول مباريات اليوم بتوقيت القاهرة',
  description:
    'جدول مباريات كرة القدم اليوم مع المواعيد والنتائج وحالات المباريات بحسب بيانات المصادر الرياضية، بتوقيت القاهرة.',
  alternates: { canonical: '/' },
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const todayCairo = getTodayCairoDate();
  const { date } = await searchParams;
  if (
    typeof date === 'string' &&
    isValidDateParam(date) &&
    date !== todayCairo
  ) {
    redirect(`/matches/${date}`);
  }

  // Keep the essential match schedule independent from the optional news source's latency.
  const store = getGatewayDatabase();
  const queryResult = queryGatewayMatches({ cairoDate: todayCairo });
  const latestNews = getLatestNews(store.news, 8);
  const jsonLd = createMatchScheduleStructuredData(todayCairo, queryResult.matches);

  return (
    <>
      {jsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      ) : null}
      <MatchGatewayClient
        selectedDate={todayCairo}
        todayCairo={todayCairo}
        allMatchesOnDate={queryResult.matches}
      />
      <NewsSection
        news={latestNews}
        lastUpdatedLabel={
          store.meta.lastSuccessfulNewsSyncAt
            ? formatArabicTimestamp(store.meta.lastSuccessfulNewsSyncAt)
            : null
        }
      />
    </>
  );
}
