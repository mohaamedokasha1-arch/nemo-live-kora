import { NextResponse } from 'next/server';
import { SOURCE_CAPABILITIES } from '@/lib/news/capabilities';
import { getPersistenceState, hydrateStore } from '@/lib/db/store';
import { getNewsAdminStats } from '@/lib/news/query';
import { describeStorage } from '@/lib/storage';
import { describeSourceConfiguration } from '@/lib/config/env';
import { auditMatchLinkIntegrity, blockingLinkIssues } from '@/lib/match-identity';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await hydrateStore();
  const newsStats = getNewsAdminStats(db.news);

  const integrity = auditMatchLinkIntegrity(db.matches);
  const newsSync = db.newsSourceSyncs[0] ?? null;

  return NextResponse.json({
    ok: true,
    storage: { ...describeStorage(), persistence: getPersistenceState() },
    keys: describeSourceConfiguration(),
    linkIntegrity: {
      checked: integrity.checked,
      linked: integrity.linked,
      unlinked: integrity.unlinked,
      warnings: integrity.issues.filter((issue) => issue.severity === 'warning').length,
      errors: blockingLinkIssues(integrity).length,
    },
    newsResolution: newsSync?.resolutionReport ?? null,
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
