import { NextResponse } from 'next/server';
import { getGatewayDatabase, getPersistenceState, hydrateStore, verifyStorageRoundTrip } from '@/lib/db/store';
import { describeStorage } from '@/lib/storage';
import { ensureFreshMatches } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Matches refresh (Vercel cron / external scheduler / manual trigger).
 *
 * Public endpoint by design: GET and POST trigger a sync without cron credentials. The other cron
 * routes and the admin panel stay behind the shared cron auth guard. Repeated requests here spend
 * server time and provider quota, so the engine's own freshness window decides whether a call
 * actually re-fetches.
 *
 * Contract: HTTP 200 is returned ONLY when (a) at least one source returned matches and (b) the
 * write was verified by reading it back from the configured storage backend AND that backend is
 * durable (shared across instances and persistent across restarts). A lambda-local file, or a
 * failed read-back, is a 503 — a green cron log must mean the data is actually there.
 */
async function updateMatches() {
  try {
    await hydrateStore();
    const log = await ensureFreshMatches(0, 'API /api/cron/update-matches (live)');
    const result = getGatewayDatabase().meta.lastMatchesSyncResult;
    const roundTrip = await verifyStorageRoundTrip();
    const persistence = getPersistenceState();
    const storage = describeStorage();
    const durable = roundTrip.ok && roundTrip.durable;
    const ok = Boolean(result?.ok && durable);
    console.info('[cron:update-matches]', JSON.stringify({ runId: log?.id, ok, result, persistence, roundTrip }));
    return NextResponse.json(
      {
        status: ok ? 'ok' : 'degraded',
        ok,
        runId: log?.id,
        startedAt: log?.startedAt,
        finishedAt: log?.finishedAt,
        result,
        persistence,
        storage,
        storageRoundTrip: roundTrip,
        durableStorageRequired: true,
      },
      { status: ok ? 200 : 503 }
    );
  } catch (error) {
    console.error('[cron:update-matches] sync_execution_failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: 'sync_execution_failed' }, { status: 500 });
  }
}
export const GET = updateMatches;
export const POST = updateMatches;
