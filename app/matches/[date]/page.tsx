import React from 'react';
import type { Metadata } from 'next';
import { formatArabicFullDate, getTodayCairoDate } from '@/lib/cairo-time';
import { getGatewayDatabase, queryGatewayMatches } from '@/lib/db/store';
import MatchGatewayClient from '@/components/MatchGatewayClient';
import NewsSection from '@/components/NewsSection';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: { date: string };
}): Promise<Metadata> {
  const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date
    : getTodayCairoDate();
  const queryResult = queryGatewayMatches({ cairoDate: dateStr });
  const readableDate = formatArabicFullDate(dateStr);
  const hasMatches = queryResult.matches.length > 0;

  return {
    title: `مباريات ${readableDate} (${dateStr})`,
    description: `جدول مباريات يوم ${readableDate} (${dateStr}) بتوقيت القاهرة — الدوري المصري والبطولات الأفريقية والأوروبية مع روابط مباشرة إلى NEMO Sports.`,
    alternates: {
      canonical: `/matches/${dateStr}`,
    },
    robots: {
      index: hasMatches,
      follow: true,
    },
  };
}

export default async function DateSchedulePage({
  params,
}: {
  params: { date: string };
}) {
  const todayCairo = getTodayCairoDate();
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date
    : todayCairo;

  const store = getGatewayDatabase();
  const queryResult = queryGatewayMatches({ cairoDate: selectedDate });

  return (
    <>
      <MatchGatewayClient
        selectedDate={selectedDate}
        todayCairo={todayCairo}
        allMatchesOnDate={queryResult.matches}
      />
      <NewsSection news={store.news} />
    </>
  );
}
