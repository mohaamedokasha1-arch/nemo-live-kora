import { getGatewayDatabase, persistGatewayDatabase } from '../lib/db/store';
import { runGatewaySync } from '../lib/sync/engine';

async function main() {
  const db = getGatewayDatabase();
  persistGatewayDatabase(db);
  const log = await runGatewaySync({
    mode: 'daily',
    trigger: 'CLI scripts/run-sync.ts',
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
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
