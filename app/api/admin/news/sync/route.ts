import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/auth/cron-auth';
import { describeStorageWarnings, flushDurableStore } from '@/lib/db/store';
import { runNewsSync } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const denied = requireAdminRequest(request);
  if (denied) return denied;

  try {
    const sync = await runNewsSync('لوحة الإدارة — مزامنة اختبارية');
    const persistence = await flushDurableStore({ force: true });
    const syncOk = Boolean(sync.ok);
    return NextResponse.json(
      {
        ok: true,
        status: syncOk && persistence.ok ? 'ok' : 'degraded',
        syncOk,
        sync,
        persistence,
        durable: persistence.durable,
        warnings: describeStorageWarnings(persistence, syncOk),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    console.error('[admin:news-sync] sync_execution_failed');
    return NextResponse.json(
      {
        ok: true,
        status: 'degraded',
        syncOk: false,
        durable: false,
        error: 'sync_execution_failed',
        warnings: ['تعذّر تنفيذ المزامنة في هذه المحاولة.'],
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
