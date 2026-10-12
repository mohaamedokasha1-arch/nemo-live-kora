import { MetadataRoute } from 'next';
import { getTodayCairoDate } from '@/lib/cairo-time';
import { queryGatewayMatches, getGatewayDatabase } from '@/lib/db/store';
import { getPublishedNews } from '@/lib/news/query';

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://nemo-live-kora.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const todayCairo = getTodayCairoDate();
  const { availableDates } = queryGatewayMatches({});
  const db = getGatewayDatabase();
  const publishedNews = getPublishedNews(db.news);

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${GATEWAY_URL}/`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1.0,
    },
    {
      url: `${GATEWAY_URL}/news`,
      lastModified: db.meta.lastSuccessfulNewsSyncAt
        ? new Date(db.meta.lastSuccessfulNewsSyncAt)
        : new Date(),
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: `${GATEWAY_URL}/news/archive`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.5,
    },
    {
      url: `${GATEWAY_URL}/sources`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.6,
    },
  ];

  const dateRoutes: MetadataRoute.Sitemap = availableDates
    .filter((d) => d.total > 0)
    .map((d) => ({
      url: `${GATEWAY_URL}/matches/${d.date}`,
      lastModified: new Date(),
      changeFrequency: d.date === todayCairo ? ('hourly' as const) : ('daily' as const),
      priority: d.egyptianCount > 0 ? 0.9 : 0.75,
    }));

  const newsRoutes: MetadataRoute.Sitemap = publishedNews.map((item) => ({
    url: `${GATEWAY_URL}/news/${item.slug}`,
    lastModified: item.updatedAt
      ? new Date(item.updatedAt)
      : item.publishedAtKnown && item.publishedAt
      ? new Date(item.publishedAt)
      : new Date(item.fetchedAt),
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }));

  return [...staticRoutes, ...dateRoutes, ...newsRoutes];
}
