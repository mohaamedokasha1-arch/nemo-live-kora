import { NextResponse } from 'next/server';
import { getGatewayDatabase, getPersistenceState } from '@/lib/db/store';
import { ensureFreshMatches } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Public endpoint by design: GET and POST trigger a sync without cron credentials.
async function updateMatches() {
  try {
    const log = await ensureFreshMatches(0, 'API /api/cron/update-matches (live)');
    const result = getGatewayDatabase().meta.lastMatchesSyncResult;
    const persistence = getPersistenceState();
    // A lambda-local file/memory update is not durable, shared production storage.
    const stored = persistence.ok && !process.env.VERCEL;
    const ok = Boolean(result?.ok && stored);
    console.info('[cron:update-matches]', JSON.stringify({ runId: log?.id, ok, result, persistence }));
    return NextResponse.json({ status: ok ? 'ok' : 'degraded', ok, runId: log?.id,
      startedAt: log?.startedAt, finishedAt: log?.finishedAt, result, persistence,
      durableStorageRequired: Boolean(process.env.VERCEL) }, { status: ok ? 200 : 503 });
  } catch {
    console.error('[cron:update-matches] sync_execution_failed');
    return NextResponse.json({ ok: false, error: 'sync_execution_failed' }, { status: 500 });
  }
}
export const GET = updateMatches;
export const POST = updateMatches;
