import { MetadataRoute } from 'next';
import { getTodayCairoDate } from '@/lib/cairo-time';
import { queryGatewayMatches } from '@/lib/db/store';

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://nemo-live-kora.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const todayCairo = getTodayCairoDate();
  const { availableDates } = queryGatewayMatches({});

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${GATEWAY_URL}/`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1.0,
    },
    {
      url: `${GATEWAY_URL}/sources`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.6,
    },
  ];

  // Only include date pages that actually have real matches (Section 13: never index empty pages)
  const dateRoutes: MetadataRoute.Sitemap = availableDates
    .filter((d) => d.total > 0)
    .map((d) => ({
      url: `${GATEWAY_URL}/matches/${d.date}`,
      lastModified: new Date(),
      changeFrequency: d.date === todayCairo ? ('hourly' as const) : ('daily' as const),
      priority: d.egyptianCount > 0 ? 0.9 : 0.75,
    }));

  return [...staticRoutes, ...dateRoutes];
}
