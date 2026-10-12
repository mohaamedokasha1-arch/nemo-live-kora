import React from 'react';
import { formatArabicTimestamp, getTodayCairoDate } from '@/lib/cairo-time';
import { getGatewayDatabase, queryGatewayMatches } from '@/lib/db/store';
import { getLatestNews } from '@/lib/news/query';
import { ensureFreshNews } from '@/lib/sync/engine';
import MatchGatewayClient from '@/components/MatchGatewayClient';
import NewsSection from '@/components/NewsSection';

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams?: { date?: string };
}) {
  const todayCairo = getTodayCairoDate();
  const requestedDate =
    searchParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
      ? searchParams.date
      : todayCairo;

  await ensureFreshNews();
  const store = getGatewayDatabase();
  const queryResult = queryGatewayMatches({ cairoDate: requestedDate });
  const latestNews = getLatestNews(store.news, 8);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `جدول مباريات (${requestedDate}) — نيمو كورة لايف`,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: queryResult.matches.length,
    itemListElement: queryResult.matches.slice(0, 20).map((m, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      item: {
        '@type': 'SportsEvent',
        name: `${m.homeTeam.nameAr} ضد ${m.awayTeam.nameAr}`,
        startDate: m.utcKickoff,
        eventStatus:
          m.status === 'cancelled'
            ? 'https://schema.org/EventCancelled'
            : m.status === 'postponed'
            ? 'https://schema.org/EventPostponed'
            : 'https://schema.org/EventScheduled',
        homeTeam: {
          '@type': 'SportsTeam',
          name: m.homeTeam.nameAr,
        },
        awayTeam: {
          '@type': 'SportsTeam',
          name: m.awayTeam.nameAr,
        },
        url: m.nemoLink.url,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MatchGatewayClient
        selectedDate={requestedDate}
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
