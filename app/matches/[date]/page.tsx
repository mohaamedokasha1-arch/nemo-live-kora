import React from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import {
  formatArabicFullDate,
  formatArabicTimestamp,
  getTodayCairoDate,
  isValidDateParam,
} from '@/lib/cairo-time';
import { getGatewayDatabase, queryGatewayMatches } from '@/lib/db/store';
import { getLatestNews } from '@/lib/news/query';
import MatchGatewayClient from '@/components/MatchGatewayClient';
import NewsSection from '@/components/NewsSection';
import {
  createMatchScheduleStructuredData,
  serializeJsonLd,
} from '@/lib/seo/match-structured-data';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}): Promise<Metadata> {
  const { date } = await params;
  if (!isValidDateParam(date)) {
    return {
      title: 'تاريخ غير صالح',
      robots: { index: false, follow: false },
    };
  }

  const queryResult = queryGatewayMatches({ cairoDate: date });
  const readableDate = formatArabicFullDate(date);
  const isToday = date === getTodayCairoDate();

  return {
    title: `مباريات ${readableDate}`,
    description: `جدول مباريات يوم ${readableDate} بتوقيت القاهرة. المواعيد والنتائج وحالات المباريات بحسب بيانات المصادر الرياضية.`,
    alternates: {
      canonical: isToday ? '/' : `/matches/${date}`,
    },
    robots: {
      index: queryResult.matches.length > 0,
      follow: true,
    },
  };
}

export default async function DateSchedulePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateParam(date)) notFound();

  const todayCairo = getTodayCairoDate();
  if (date === todayCairo) redirect('/');

  const store = getGatewayDatabase();
  const queryResult = queryGatewayMatches({ cairoDate: date });
  const jsonLd = createMatchScheduleStructuredData(date, queryResult.matches);

  return (
    <>
      {jsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      ) : null}
      <MatchGatewayClient
        selectedDate={date}
        todayCairo={todayCairo}
        allMatchesOnDate={queryResult.matches}
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
