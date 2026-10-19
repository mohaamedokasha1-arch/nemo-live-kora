import {
  flushDurableStore,
  getActiveMatches,
  getGatewayDatabase,
  getPersistenceState,
  hydrateGatewayDatabase,
  persistGatewayDatabase,
} from '../lib/db/store';
import {
  collectChangedMatchIds,
  collectChangedPublishedNewsSlugs,
  matchLandingUrl,
  newsArticleUrl,
  notifyGoogleIndexing,
} from '../lib/seo/google-indexing';
import { runGatewaySync } from '../lib/sync/engine';

async function main() {
  // With a durable backend configured, start from the shared snapshot instead of the local copy.
  await hydrateGatewayDatabase();
  /** لقطتا «قبل» لكشف ما تغيّر فعلًا في هذه الجولة لإشعار Google Indexing. */
  const matchesBefore = getActiveMatches(getGatewayDatabase());
  const newsBefore = [...getGatewayDatabase().news];
  const db = getGatewayDatabase();
  persistGatewayDatabase(db);
  const log = await runGatewaySync({
    mode: 'daily',
    trigger: 'CLI scripts/run-sync.ts',
  });
  const persistence = await flushDurableStore({ force: true });

  /**
   * إشعار Google Indexing بروابط الصفحات الجديدة/المتغيّرة — يعمل فقط عند ضبط
   * GOOGLE_CLIENT_EMAIL وGOOGLE_PRIVATE_KEY في البيئة. يُنتظَر بالكامل هنا (بخلاف
   * مسارات الطلبات) حتى لا تخرج العملية قبل اكتمال الإرسال.
   */
  const dbAfter = getGatewayDatabase();
  const changedUrls = [
    ...collectChangedMatchIds(matchesBefore, getActiveMatches(dbAfter)).map(matchLandingUrl),
    ...collectChangedPublishedNewsSlugs(newsBefore, dbAfter.news).map(newsArticleUrl),
  ];
  if (changedUrls.length > 0) {
    const indexing = await notifyGoogleIndexing(changedUrls, { contextAr: 'CLI scripts/run-sync.ts' });
    if (indexing.configured) {
      console.log('[run-sync] google-indexing', JSON.stringify(indexing));
    }
  }
  // «ok» لا يعني أن الكتابة نجحت فقط: يجب أن يستجيب مصدر واحد على الأقل بنجاح في هذه المحاولة
  // (بالمعيار نفسه المستخدم في المحرك). استجابة ناجحة بصفر مباراة تُعد نجاحًا، والمصدر الذي
  // يعيد نسخة مخزنة أو حالة degraded لم ينجح مهما كانت حالة الكتابة.
  const freshSources = log.sourceResults.filter((s) => !s.usedCachedSnapshot && s.status !== 'degraded');
  const syncOk = freshSources.length > 0;
  console.log(
    JSON.stringify(
      {
        ok: syncOk && persistence.ok && persistence.durable,
        syncOk,
        status: syncOk && persistence.ok ? 'ok' : 'degraded',
        persistence,
        dateWindow: log.dateWindow,
        totalMatches: log.totalMatchesInStore,
        totalStandings: log.totalStandingsInStore,
        totalNews: log.totalNewsInStore,
        sources: log.sourceResults.map((s) => ({
          id: s.sourceId,
          status: s.status,
          httpStatus: s.httpStatus,
          matchesFetched: s.matchesFetched,
          usedCachedSnapshot: s.usedCachedSnapshot,
        })),
      },
      null,
      2
    )
  );
  if (!persistence.ok || !persistence.durable) {
    console.error('[sync] snapshot was not committed to durable storage', getPersistenceState());
    process.exitCode = 2;
  } else if (!syncOk) {
    console.error('[sync] no source returned fresh data; existing snapshot kept unchanged');
    process.exitCode = 3;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
