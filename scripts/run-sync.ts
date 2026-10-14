import {
  flushDurableStore,
  getGatewayDatabase,
  getPersistenceState,
  hydrateGatewayDatabase,
  persistGatewayDatabase,
} from '../lib/db/store';
import { runGatewaySync } from '../lib/sync/engine';

async function main() {
  // With a durable backend configured, start from the shared snapshot instead of the local copy.
  await hydrateGatewayDatabase();
  const db = getGatewayDatabase();
  persistGatewayDatabase(db);
  const log = await runGatewaySync({
    mode: 'daily',
    trigger: 'CLI scripts/run-sync.ts',
  });
  const persistence = await flushDurableStore({ force: true });
  console.log(
    JSON.stringify(
      {
        ok: persistence.ok && persistence.durable,
        persistence,
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
  if (!persistence.ok || !persistence.durable) {
    console.error('[sync] snapshot was not committed to durable storage', getPersistenceState());
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
