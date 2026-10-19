import { NextResponse } from 'next/server';
import {
  describeStorageWarnings,
  flushDurableStore,
  getActiveMatches,
  getDurableStoreStatus,
  getGatewayDatabase,
  hydrateGatewayDatabase,
} from '@/lib/db/store';
import {
  collectChangedMatchIds,
  matchLandingUrl,
  notifyGoogleIndexingAfterResponse,
} from '@/lib/seo/google-indexing';
import { ensureFreshMatches } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Public, self-contained cron endpoint: GET and POST run a real sync and persist the snapshot to the
 * local structured-JSON store. No credential, URL or environment variable is required.
 *
 * Response contract (always HTTP 200 with `ok: true`, so the scheduler never records a failure
 * because of storage configuration):
 *  - `status: "ok"`       — the provider sync succeeded AND the snapshot was written locally.
 *  - `status: "degraded"` — anything else. The reason is in `syncOk`, `persistence`, `durable`
 *    and `warnings`; monitors should read those fields rather than the HTTP code.
 */
async function updateMatches() {
  try {
    // Adopt the newest stored snapshot first so this instance never syncs from a stale bundle.
    await hydrateGatewayDatabase();
    /** لقطة «قبل» لكشف المباريات التي تغيّر محتواها فعلًا لإشعار Google بعد الجولة. */
    const matchesBefore = getActiveMatches(getGatewayDatabase());

    const log = await ensureFreshMatches(0, 'API /api/cron/update-matches (live)');
    const result = getGatewayDatabase().meta.lastMatchesSyncResult;
    const persistence = await flushDurableStore({ force: true });
    const syncOk = Boolean(result?.ok);
    const status = syncOk && persistence.ok ? 'ok' : 'degraded';

    // إشعار Google في الخلفية بصفحات المباريات التي تغيّرت فعلًا في هذه الجولة.
    const changedMatchUrls = collectChangedMatchIds(matchesBefore, getActiveMatches(getGatewayDatabase())).map(
      matchLandingUrl
    );
    if (changedMatchUrls.length > 0) {
      notifyGoogleIndexingAfterResponse(changedMatchUrls, { contextAr: 'cron/update-matches' });
    }

    console.info(
      '[cron:update-matches]',
      JSON.stringify({ runId: log?.id, status, syncOk, persistence: { ok: persistence.ok, durable: persistence.durable } })
    );

    return NextResponse.json(
      {
        ok: true,
        status,
        syncOk,
        runId: log?.id,
        startedAt: log?.startedAt,
        finishedAt: log?.finishedAt,
        result,
        persistence,
        durable: persistence.durable,
        storage: getDurableStoreStatus(),
        warnings: describeStorageWarnings(persistence, syncOk),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error(
      '[cron:update-matches] sync_execution_failed',
      error instanceof Error ? error.message.slice(0, 200) : 'unknown'
    );
    return NextResponse.json(
      {
        ok: true,
        status: 'degraded',
        syncOk: false,
        durable: false,
        error: 'sync_execution_failed',
        warnings: ['تعذّر تنفيذ المزامنة في هذه المحاولة؛ ستُعاد المحاولة في الجدولة التالية.'],
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export const GET = updateMatches;
export const POST = updateMatches;
