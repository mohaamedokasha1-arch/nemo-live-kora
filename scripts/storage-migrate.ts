/**
 * Storage migration.
 *
 * Imports a gateway dataset document (default: the committed `data/gateway-store.json`, or any
 * file passed with --from) into the local structured-JSON store, then proves the import by reading
 * the data back and comparing counts. The application has no external database to migrate to.
 *
 *   node --import tsx scripts/storage-migrate.ts --from=path/to/gateway-store.json
 *
 * Flags:
 *   --from=<path>   read the source document from this file (default: data/gateway-store.json)
 *   --dry-run       validate and report without writing
 *   --force         overwrite a non-empty target store
 */
import fs from 'node:fs';
import path from 'node:path';
import { FileStorageDriver } from '../lib/storage/file-driver';
import { describeStorage, getStorageDriver } from '../lib/storage';
import { isGatewayDatabaseShape } from '../lib/storage/types';
import { migrateGatewayDatabase } from '../lib/news/migrate';
import { auditMatchLinkIntegrity, blockingLinkIssues } from '../lib/match-identity';
import type { GatewayDatabase } from '../lib/types';

interface Args {
  from: string;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { from: path.join(process.cwd(), 'data/gateway-store.json'), dryRun: false, force: false };
  for (const arg of argv) {
    if (arg.startsWith('--from=')) args.from = arg.slice('--from='.length);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force') args.force = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const driver = getStorageDriver();
  const description = describeStorage();

  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    target: description,
    source: args.from,
    dryRun: args.dryRun,
  };

  if (!fs.existsSync(args.from)) {
    throw new Error(`source_not_found: ${args.from}`);
  }
  const raw = fs.readFileSync(args.from, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`source_not_json: ${(error as Error).message}`);
  }
  if (!isGatewayDatabaseShape(parsed)) {
    throw new Error('source_invalid_shape: the file is not a GatewayDatabase document');
  }

  const database = migrateGatewayDatabase(parsed as GatewayDatabase);
  const publishedNews = database.news.filter((item) => item.publishStatus === 'published').length;
  report.sourceCounts = {
    matches: database.matches.length,
    news: database.news.length,
    publishedNews,
    standings: Object.keys(database.standings).length,
    competitions: database.competitions.length,
    teams: database.teams.length,
  };

  // Refuse to migrate data that would send visitors to the wrong match page.
  const integrity = auditMatchLinkIntegrity(database.matches);
  const blocking = blockingLinkIssues(integrity);
  report.linkIntegrity = {
    checked: integrity.checked,
    linked: integrity.linked,
    warnings: integrity.issues.filter((issue) => issue.severity === 'warning').length,
    errors: blocking.length,
  };
  if (blocking.length > 0) {
    throw new Error(`link_integrity_errors: ${JSON.stringify(blocking.slice(0, 5))}`);
  }

  const existing = await driver.read();
  if (existing.ok && existing.database && !args.force && !args.dryRun) {
    throw new Error(
      `target_not_empty: the backend already holds ${existing.database.matches.length} matches; re-run with --force to replace it`
    );
  }
  report.targetBefore = existing.ok
    ? { matches: existing.database?.matches.length ?? 0, news: existing.database?.news.length ?? 0 }
    : { empty: true, reason: existing.error ?? 'unreadable' };

  if (args.dryRun) {
    report.result = 'dry_run_ok';
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const write = await driver.write(database);
  if (!write.ok) {
    throw new Error(`write_failed: ${write.error}`);
  }
  report.write = { bytes: write.bytes, writtenAt: write.writtenAt, mirror: write.mirror, latencyMs: write.latencyMs };

  // Read it back — a write that cannot be read is not a migration.
  const readBack = await driver.read();
  if (!readBack.ok || !readBack.database) {
    throw new Error(`readback_failed: ${readBack.error}`);
  }
  const after = readBack.database;
  report.readBack = {
    matches: after.matches.length,
    news: after.news.length,
    publishedNews: after.news.filter((item) => item.publishStatus === 'published').length,
    standings: Object.keys(after.standings).length,
  };
  report.verified =
    after.matches.length === database.matches.length &&
    after.news.length === database.news.length &&
    Object.keys(after.standings).length === Object.keys(database.standings).length;

  if (!report.verified) {
    throw new Error(`readback_mismatch: ${JSON.stringify(report.readBack)}`);
  }

  // Keep the local snapshot in step so a fresh clone deploys with current data.
  if (driver.kind !== 'file') {
    const local = new FileStorageDriver();
    const localWrite = await local.write(after);
    report.localMirror = { ok: localWrite.ok, error: localWrite.error ?? null };
  }

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedAt;
  report.result = 'migrated_and_verified';
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
