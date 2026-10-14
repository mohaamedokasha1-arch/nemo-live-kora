import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/auth/cron-auth';
import { describeStorageWarnings, flushDurableStore } from '@/lib/db/store';
import { runGatewaySync } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type SyncLog = Awaited<ReturnType<typeof runGatewaySync>>;

function parseMode(raw: string | null | undefined): 'live' | 'daily' | 'standings' | 'manual' {
  return raw === 'live' || raw === 'standings' || raw === 'manual' ? raw : 'daily';
}

function sourcesOk(log: SyncLog): boolean {
  return log.sourceResults.some(
    (source) =>
      !source.usedCachedSnapshot &&
      (source.matchesFetched > 0 || (source.newsPublished || 0) > 0 || source.standingsFetched > 0)
  );
}

/** Persists the snapshot and answers 200 with `ok: true`; the real state is in `status`/`syncOk`. */
async function respond(log: SyncLog) {
  const persistence = await flushDurableStore({ force: true });
  const syncOk = sourcesOk(log);
  return NextResponse.json(
    {
      ok: true,
      status: syncOk && persistence.ok ? 'ok' : 'degraded',
      syncOk,
      syncLog: log,
      persistence,
      durable: persistence.durable,
      warnings: describeStorageWarnings(persistence, syncOk),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}

function failed() {
  return NextResponse.json(
    {
      ok: true,
      status: 'degraded',
      syncOk: false,
      durable: false,
      error: 'sync_execution_failed',
      warnings: ['تعذّر تنفيذ المزامنة في هذه المحاولة.'],
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function GET(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    const mode = parseMode(new URL(request.url).searchParams.get('mode'));
    const log = await runGatewaySync({ mode, trigger: `Cron GET (${mode})` });
    return await respond(log);
  } catch {
    console.error('[cron:sync] sync_execution_failed');
    return failed();
  }
}

export async function POST(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    let mode: 'live' | 'daily' | 'standings' | 'manual' = 'manual';
    try {
      const body = await request.json();
      if (body?.mode === 'live' || body?.mode === 'daily' || body?.mode === 'standings') {
        mode = body.mode;
      }
    } catch {
      // default to 'manual'
    }
    const log = await runGatewaySync({ mode, trigger: `تحديث فوري (${mode})` });
    return await respond(log);
  } catch {
    console.error('[cron:sync] sync_execution_failed');
    return failed();
  }
}
