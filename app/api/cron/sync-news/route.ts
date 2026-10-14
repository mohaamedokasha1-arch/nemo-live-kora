import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/auth/cron-auth';
import { describeStorageWarnings, flushDurableStore } from '@/lib/db/store';
import { runNewsSync } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    const sync = await runNewsSync('API /api/cron/sync-news');
    // Persist the news snapshot before answering so the articles survive the request.
    const persistence = await flushDurableStore({ force: true });
    const syncOk = Boolean(sync.ok);
    return NextResponse.json(
      {
        ok: true,
        status: syncOk && persistence.ok ? 'ok' : 'degraded',
        syncOk,
        success: syncOk && persistence.ok,
        messageAr: sync.messageAr,
        newsFetched: sync.fetchedCount,
        newsImported: sync.importedCount,
        newsPublished: sync.publishedCount,
        newsDuplicates: sync.duplicateCount,
        newsRejected: sync.rejectedCount,
        newsUpdated: sync.updatedCount,
        startedAt: sync.startedAt,
        finishedAt: sync.finishedAt,
        persistence,
        durable: persistence.durable,
        warnings: describeStorageWarnings(persistence, syncOk),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    console.error('[cron:sync-news] sync_execution_failed');
    return NextResponse.json(
      {
        ok: true,
        status: 'degraded',
        syncOk: false,
        success: false,
        durable: false,
        error: 'sync_execution_failed',
        warnings: ['تعذّر تنفيذ مزامنة الأخبار في هذه المحاولة.'],
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
