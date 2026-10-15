import { NextResponse } from 'next/server';
import { SOURCE_CAPABILITIES } from '@/lib/news/capabilities';
import { getActiveMatches, getPersistenceState, hydrateStore } from '@/lib/db/store';
import { getNewsAdminStats } from '@/lib/news/query';
import { describeStorage } from '@/lib/storage';
import { describeSourceConfiguration } from '@/lib/config/env';
import { auditMatchLinkIntegrity, blockingLinkIssues } from '@/lib/match-identity';
import { describeNewsRejectionAr, summarizeNewsRejectionsAr } from '@/lib/news/validate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await hydrateStore();
  const newsStats = getNewsAdminStats(db.news);

  const activeMatchRecords = getActiveMatches(db);
  const integrity = auditMatchLinkIntegrity(activeMatchRecords);
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
      /**
       * فحص التكرار عبر المصادر: المباراة نفسها في سجلين. الفحص أعلاه (`checked`/`linked`)
       * يعمل على السجلات **المعروضة**، وهذان الرقمان يوضّحان ما أُخفي عن العرض:
       * `mergedDuplicateMatches` = سجلات أُثبت أنها تكرار وأُدمجت منطقيًا ولا تُعرض،
       * و`unresolvedDuplicateGroups` = مجموعات لم تُعالَج بعد (المتوقع 0).
       * لا تُحذف أي سجلات: السجل المكرر يبقى ببيانات مصدره كاملة.
       */
      mergedDuplicateMatches: db.matches.length - activeMatchRecords.length,
      unresolvedDuplicateGroups: integrity.unresolvedDuplicateGroups.length,
      unresolvedDuplicateGroupIds: integrity.unresolvedDuplicateGroups.map((group) => group.ids),
      lastConsolidation: db.meta.lastFixtureConsolidation ?? null,
    },
    newsResolution: newsSync?.resolutionReport ?? null,
    /**
     * لماذا لا يوجد خبر منشور؟ الأسباب بعدّاداتها من آخر محاولة جلب، بشرح عربي مكتوب —
     * فـ«٠ منشور» وحدها لا تفرّق بين رابط وسيط لم يُحلّ وعنوان نتيجة مباراة رُفض.
     * (قراءة فقط — لا تُغيّر شيئًا في المخزن.)
     */
    newsRejections: {
      lastAttemptAt: newsSync?.finishedAt ?? null,
      feedOk: newsSync?.feedOk ?? null,
      fetchedCount: newsSync?.fetchedCount ?? 0,
      rejectedCount: newsSync?.rejectedCount ?? 0,
      top: summarizeNewsRejectionsAr(newsSync?.rejectionBreakdown),
      reasons: Object.entries(newsSync?.rejectionBreakdown || {})
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([code, count]) => ({ code, count, reasonAr: describeNewsRejectionAr(code) })),
    },
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
    matchesCount: activeMatchRecords.length,
    matchesStoredTotal: db.matches.length,
    news: {
      published: newsStats.published,
      latest: newsStats.latest,
      duplicates: newsStats.duplicates,
      rejected: newsStats.rejected,
    },
  });
}
