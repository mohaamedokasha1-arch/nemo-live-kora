import { NextResponse } from 'next/server';
import { hydrateStore } from '@/lib/db/store';
import { getLatestNews, getNewsAdminStats } from '@/lib/news/query';
import { ensureFreshNews } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureFreshNews();
  const db = await hydrateStore();
  const latest = getLatestNews(db.news, 20);
  const stats = getNewsAdminStats(db.news);

  return NextResponse.json({
    ok: true,
    lastSuccessfulNewsSyncAt: db.meta.lastSuccessfulNewsSyncAt,
    counts: {
      published: stats.published,
      latest: stats.latest,
      duplicates: stats.duplicates,
      rejected: stats.rejected,
      unknownPublishDate: stats.unknownPublishDate,
    },
    news: latest.map((item) => ({
      id: item.id,
      slug: item.slug,
      title: item.title,
      publisherName: item.publisherName,
      publishedAt: item.publishedAt,
      publishedAtKnown: item.publishedAtKnown,
      cairoTimeLabel: item.cairoTimeLabel,
      excerpt: item.excerpt,
      originalUrl: item.originalUrl,
      nemoRelatedUrl: item.nemoRelatedUrl,
      language: item.language,
    })),
  });
}
