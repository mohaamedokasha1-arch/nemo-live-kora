import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/auth/cron-auth';
import { runNewsSync } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const sync = await runNewsSync('API /api/cron/sync-news');
  return NextResponse.json({
    ok: sync.ok,
    success: sync.ok,
    messageAr: sync.messageAr,
    newsFetched: sync.fetchedCount,
    newsImported: sync.importedCount,
    newsPublished: sync.publishedCount,
    newsDuplicates: sync.duplicateCount,
    newsRejected: sync.rejectedCount,
    newsUpdated: sync.updatedCount,
    startedAt: sync.startedAt,
    finishedAt: sync.finishedAt,
  }, { status: sync.ok ? 200 : 503 });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
