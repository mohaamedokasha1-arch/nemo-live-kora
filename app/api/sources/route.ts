import { NextResponse } from 'next/server';
import { SOURCE_CAPABILITIES } from '@/lib/news/capabilities';
import { getGatewayDatabase } from '@/lib/db/store';
import { getNewsAdminStats } from '@/lib/news/query';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getGatewayDatabase();
  const newsStats = getNewsAdminStats(db.news);

  return NextResponse.json({
    ok: true,
    meta: {
      timezone: db.meta.timezone,
      lastFullSyncAt: db.meta.lastFullSyncAt,
      lastLiveSyncAt: db.meta.lastLiveSyncAt,
      lastSuccessfulNewsSyncAt: db.meta.lastSuccessfulNewsSyncAt,
    },
    sources: Object.values(db.sources).map((source) => {
      const caps = SOURCE_CAPABILITIES[source.id];
      return {
        id: source.id,
        name: source.name,
        nameAr: source.nameAr,
        type: source.type,
        providesMatches: caps.providesMatches,
        providesStandings: caps.providesStandings,
        providesNews: caps.providesNews,
        status: source.status,
        statusLabelAr: source.statusLabelAr,
        lastSyncAt: source.lastSyncAt,
        lastSuccessfulNewsSyncAt: source.lastSuccessfulNewsSyncAt,
        lastHttpStatus: source.lastHttpStatus,
        recordsImported: source.recordsImported,
        newsPublishedCount: source.newsPublishedCount,
        requiresKey: source.requiresKey,
        isKeyConfigured: source.isKeyConfigured,
        notesAr: caps.newsAccessNoteAr,
      };
    }),
    competitionsCount: db.competitions.length,
    seasonsCount: db.seasons.length,
    teamsCount: db.teams.length,
    matchesCount: db.matches.length,
    news: {
      published: newsStats.published,
      latest: newsStats.latest,
      duplicates: newsStats.duplicates,
      rejected: newsStats.rejected,
    },
  });
}
