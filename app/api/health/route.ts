import { NextResponse } from 'next/server';
import { getGatewayDatabase, getPersistenceState, hydrateStore, verifyStorageRoundTrip } from '@/lib/db/store';
import { describeStorage } from '@/lib/storage';
import { describeSourceConfiguration } from '@/lib/config/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Operational health.
 *
 * Answers three questions an operator actually needs, with evidence rather than assertions:
 *  1. Is there a persistent backend, and does a write→read round-trip succeed on it?
 *  2. Are the provider keys present (masked), and what did the last sync from each return?
 *  3. How much real data is in the store right now?
 *
 * HTTP 200 means the storage round-trip succeeded. A missing key is reported but does not fail
 * the probe, because the keyless sources can still serve a schedule.
 */
export async function GET() {
  await hydrateStore();
  const db = getGatewayDatabase();
  const roundTrip = await verifyStorageRoundTrip();
  const persistence = getPersistenceState();
  const storage = describeStorage();

  const publishedNews = db.news.filter((item) => item.publishStatus === 'published').length;
  const rejectedNews = db.news.filter((item) => item.publishStatus === 'rejected').length;

  const sources = Object.values(db.sources).map((source) => ({
    id: source.id,
    status: source.status,
    statusLabelAr: source.statusLabelAr,
    lastSyncAt: source.lastSyncAt,
    lastHttpStatus: source.lastHttpStatus,
    lastLatencyMs: source.lastLatencyMs,
    lastSuccessfulDataAt: source.lastSuccessfulDataAt ?? null,
    lastFailedDataAt: source.lastFailedDataAt ?? null,
    recordsImported: source.recordsImported,
    errorCount: source.errorCount,
    apiKeyProbes: source.apiKeyProbes ?? [],
  }));

  const checks = {
    storageRoundTrip: roundTrip.ok,
    storageDurable: roundTrip.durable,
    lastWritePersisted: persistence.ok,
    matchesPresent: db.matches.length > 0,
    newsPresent: publishedNews > 0,
  };
  const ok = checks.storageRoundTrip && checks.storageDurable && checks.lastWritePersisted && checks.matchesPresent;

  return NextResponse.json(
    {
      ok,
      checkedAt: new Date().toISOString(),
      checks,
      storage: { ...storage, roundTrip, persistence },
      keys: describeSourceConfiguration(),
      counts: {
        matches: db.matches.length,
        egyptianMatches: db.matches.filter((m) => m.isEgyptianInterest).length,
        standings: Object.keys(db.standings).length,
        competitions: db.competitions.length,
        news: db.news.length,
        publishedNews,
        rejectedNews,
        latestNewsSync: db.newsSourceSyncs[0] ?? null,
      },
      sources,
      meta: {
        lastFullSyncAt: db.meta.lastFullSyncAt,
        lastLiveSyncAt: db.meta.lastLiveSyncAt,
        lastNewsSyncAt: db.meta.lastNewsSyncAt,
        lastSuccessfulNewsSyncAt: db.meta.lastSuccessfulNewsSyncAt,
        lastMatchesSyncAttemptAt: db.meta.lastMatchesSyncAttemptAt ?? null,
        lastSuccessfulMatchesSyncAt: db.meta.lastSuccessfulMatchesSyncAt ?? null,
        lastMatchesSyncResult: db.meta.lastMatchesSyncResult ?? null,
      },
    },
    { status: ok ? 200 : 503 }
  );
}
