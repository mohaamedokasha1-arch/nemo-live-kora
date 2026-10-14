import { hydrateStore, getPersistenceState } from '../lib/db/store';
import { describeStorage } from '../lib/storage';
import { runGatewaySync } from '../lib/sync/engine';

async function main() {
  const db = await hydrateStore();
  const storage = describeStorage();
  const beforeCounts = {
    matches: db.matches.length,
    standings: Object.keys(db.standings).length,
    news: db.news.length,
  };
  const log = await runGatewaySync({
    mode: 'daily',
    trigger: 'CLI scripts/run-sync.ts',
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        beforeCounts,
        storage,
        persistence: getPersistenceState(),
        totalMatches: log.totalMatchesInStore,
        totalStandings: log.totalStandingsInStore,
        totalNews: log.totalNewsInStore,
        sources: log.sourceResults.map((s) => ({
          id: s.sourceId,
          status: s.status,
          usedCachedSnapshot: s.usedCachedSnapshot,
        })),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
