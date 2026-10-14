import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/auth/cron-auth';
import { flushDurableStore, isServerlessRuntime } from '@/lib/db/store';
import { runNewsSync } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const sync = await runNewsSync('API /api/cron/sync-news');
  // Persist the news snapshot to shared storage before answering, so a 200 means the articles
  // survive this instance instead of living only in its memory/local temp file.
  const persistence = await flushDurableStore({ force: true });
  const stored = persistence.ok && persistence.durable;
  const ok = sync.ok && stored;
  return NextResponse.json(
    {
      ok,
      success: ok,
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
      durableStorageRequired: Boolean(isServerlessRuntime()),
      ...(stored
        ? {}
        : {
            storageReason:
              'لم تُحفظ الأخبار في تخزين دائم مشترك؛ اضبط أحد مخازن Turso/Upstash KV/Vercel Blob/HTTP ثم أعد المحاولة.',
          }),
    },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
