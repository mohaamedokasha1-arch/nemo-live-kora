import { MetadataRoute } from 'next';
import {
  getTodayCairoDate,
  isValidDateParam,
  shiftDateString,
} from '@/lib/cairo-time';
import { getGatewayDatabase, queryGatewayMatches } from '@/lib/db/store';
import { getArchiveNews, getLatestNews, getPublishedNews } from '@/lib/news/query';
import { isIndexableNewsArticle } from '@/lib/news/validate';
import { GATEWAY_SITE_URL } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function mostRecentDate(dates: Array<Date | null>, fallback: Date): Date {
  const validDates = dates.filter((date): date is Date => date !== null);
  return validDates.length > 0
    ? validDates.reduce((latest, date) => (date > latest ? date : latest))
    : fallback;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const todayCairo = getTodayCairoDate();
  const startDate = shiftDateString(todayCairo, -1);
  const endDate = shiftDateString(todayCairo, 7);
  const db = getGatewayDatabase();
  const { availableDates } = queryGatewayMatches({});
  const latestNews = getLatestNews(db.news, 24);
  const archiveNews = getArchiveNews(db.news);
  const indexableNews = getPublishedNews(db.news).filter(isIndexableNewsArticle);

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${GATEWAY_SITE_URL}/`,
      lastModified: parseDate(db.meta.lastLiveSyncAt) || now,
      changeFrequency: 'hourly',
      priority: 1.0,
    },
  ];

  // Listing pages enter the sitemap only when they contain real, indexable articles.
  if (latestNews.some(isIndexableNewsArticle)) {
    staticRoutes.push({
      url: `${GATEWAY_SITE_URL}/news`,
      lastModified: parseDate(db.meta.lastSuccessfulNewsSyncAt) || now,
      changeFrequency: 'hourly',
      priority: 0.7,
    });
  }

  const indexableArchive = archiveNews.filter(isIndexableNewsArticle);
  if (indexableArchive.length > 0) {
    staticRoutes.push({
      url: `${GATEWAY_SITE_URL}/news/archive`,
      lastModified: mostRecentDate(
        indexableArchive.map(
          (item) =>
            parseDate(item.updatedAt) ||
            parseDate(item.publishedAt) ||
            parseDate(item.fetchedAt)
        ),
        now
      ),
      changeFrequency: 'weekly',
      priority: 0.4,
    });
  }

  // Today is represented by the canonical homepage. Keep the indexed schedule window
  // deliberately short; the date picker remains functional but arbitrary dates are not
  // added to the sitemap merely because they are queryable.
  const dateRoutes: MetadataRoute.Sitemap = availableDates
    .filter(
      (entry) =>
        entry.total > 0 &&
        isValidDateParam(entry.date) &&
        entry.date !== todayCairo &&
        entry.date >= startDate &&
        entry.date <= endDate
    )
    .map((entry) => {
      const updatedAt = mostRecentDate(
        db.matches
          .filter((match) => match.cairoDate === entry.date)
          .map((match) => parseDate(match.lastUpdatedAt)),
        now
      );

      return {
        url: `${GATEWAY_SITE_URL}/matches/${entry.date}`,
        lastModified: updatedAt,
        changeFrequency: 'daily' as const,
        priority: entry.egyptianCount > 0 ? 0.8 : 0.6,
      };
    });

  const newsRoutes: MetadataRoute.Sitemap = indexableNews.map((item) => ({
    url: `${GATEWAY_SITE_URL}/news/${item.slug}`,
    lastModified:
      parseDate(item.updatedAt) ||
      parseDate(item.publishedAt) ||
      parseDate(item.fetchedAt) ||
      now,
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }));

  return [...staticRoutes, ...dateRoutes, ...newsRoutes];
}
