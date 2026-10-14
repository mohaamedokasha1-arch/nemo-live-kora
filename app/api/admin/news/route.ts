import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/auth/cron-auth';
import { SOURCE_CAPABILITIES } from '@/lib/news/capabilities';
import { getNewsAdminStats } from '@/lib/news/query';
import { hydrateStore } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const denied = requireAdminRequest(request);
  if (denied) return denied;

  const db = await hydrateStore();
  const stats = getNewsAdminStats(db.news);

  return NextResponse.json({
    ok: true,
    stats,
    meta: {
      lastNewsSyncAt: db.meta.lastNewsSyncAt,
      lastSuccessfulNewsSyncAt: db.meta.lastSuccessfulNewsSyncAt,
      lastFullSyncAt: db.meta.lastFullSyncAt,
    },
    sources: Object.values(db.sources).map((source) => ({
      id: source.id,
      nameAr: source.nameAr,
      status: source.status,
      statusLabelAr: source.statusLabelAr,
      providesNews: SOURCE_CAPABILITIES[source.id].providesNews,
      providesMatches: SOURCE_CAPABILITIES[source.id].providesMatches,
      lastSyncAt: source.lastSyncAt,
      lastSuccessfulNewsSyncAt: source.lastSuccessfulNewsSyncAt,
      lastHttpStatus: source.lastHttpStatus,
      newsImportedCount: source.newsImportedCount,
      newsPublishedCount: source.newsPublishedCount,
      errorCount: source.errorCount,
      notesAr: SOURCE_CAPABILITIES[source.id].newsAccessNoteAr,
    })),
    latestSyncs: db.newsSourceSyncs.slice(0, 12),
    importErrors: db.newsImportErrors.slice(0, 20),
    dedupRecords: db.newsDedupRecords.slice(0, 20),
    pending: db.news.filter((item) => item.publishStatus === 'pending').slice(0, 20),
    rejected: db.news.filter((item) => item.publishStatus === 'rejected').slice(0, 20),
    duplicates: db.news.filter((item) => item.publishStatus === 'duplicate').slice(0, 20),
    publishedSample: db.news.filter((item) => item.publishStatus === 'published').slice(0, 12),
  });
}
