/**
 * Read-only check of the local snapshot store: reports where the document lives for this runtime
 * and whether it can actually be read back. It never writes, so it is safe to run at any time.
 *
 * Usage:  npm run store:check
 */
import { getDurableStoreStatus, getPersistenceState, hydrateGatewayDatabase } from '../lib/db/store';

async function main() {
  const status = getDurableStoreStatus();
  console.log(JSON.stringify({ ...status, ...getPersistenceState() }, null, 2));

  const startedAt = Date.now();
  const persistence = await hydrateGatewayDatabase();
  console.log(
    JSON.stringify(
      {
        hydrated: persistence.ok,
        mode: persistence.mode,
        durable: persistence.durable,
        error: persistence.error,
        readMs: Date.now() - startedAt,
        note: persistence.durable
          ? 'Snapshot is on durable local disk.'
          : 'Snapshot is warm-instance storage (serverless /tmp): it is rebuilt after a cold start, by design.',
      },
      null,
      2
    )
  );
  if (!persistence.ok && persistence.error !== 'store_read_failed') {
    // A missing or quarantined document is not a failure: the next sync writes a fresh one.
    console.log('No readable snapshot yet; the next sync will create it.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
