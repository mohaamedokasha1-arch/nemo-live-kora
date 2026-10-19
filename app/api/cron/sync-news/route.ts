import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/auth/cron-auth';
import { describeStorageWarnings, flushDurableStore, getGatewayDatabase, hydrateStore } from '@/lib/db/store';
import {
  collectChangedPublishedNewsSlugs,
  newsArticleUrl,
  notifyGoogleIndexingAfterResponse,
} from '@/lib/seo/google-indexing';
import { runNewsSync } from '@/lib/sync/engine';
import type { NewsItemRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    const dbBefore = await hydrateStore();
    const publishedBefore = dbBefore.news.filter((item) => item.publishStatus === 'published').length;
    /** لقطة الأخبار قبل الجولة — يقاس عليها ما صار قابلًا للفهرسة فعلًا لإشعار Google. */
    const newsBefore: NewsItemRecord[] = [...dbBefore.news];
    // نافذة هذه الجولة تُقاس من بدئها، لا من بداية سجل Google: سجل الخلاصات المباشرة
    // يُسجَّل أولًا وينتهي قبل أن يبدأ جريان Google أصلًا.
    const runStartedAt = new Date().toISOString();
    const sync = await runNewsSync('API /api/cron/sync-news');
    // Persist the news snapshot before answering so the articles survive the request.
    const persistence = await flushDurableStore({ force: true });
    const syncOk = Boolean(sync.ok);
    /**
     * الحالة الإجمالية الصادقة: مصدر الأخبار عند Google قد يفشل بينما الخلاصات المباشرة
     * تنشر مقالات فعليًا في نفس الجولة — لا يجوز أن يُبلَّغ المجدوّل الخارجي بـ«degraded»
     * والمخزن قد امتلأ للتو. يُحسب النشر الفعلي من الفرق في المخزن، لا من سجل مصدر واحد.
     */
    const dbAfter = getGatewayDatabase();
    const publishedAfter = dbAfter.news.filter((item) => item.publishStatus === 'published').length;
    const publishedDelta = Math.max(0, publishedAfter - publishedBefore);
    const newsFlowOk = syncOk || publishedDelta > 0;
    const thisRunRecords = dbAfter.newsSourceSyncs.filter((record) => record.finishedAt >= runStartedAt);

    // إشعار Google في الخلفية بكل خبر صار قابلًا للفهرسة في هذه الجولة (جديد أو متغيّر المحتوى).
    const changedNewsUrls = collectChangedPublishedNewsSlugs(newsBefore, dbAfter.news).map(newsArticleUrl);
    if (changedNewsUrls.length > 0) {
      notifyGoogleIndexingAfterResponse(changedNewsUrls, { contextAr: 'cron/sync-news' });
    }

    return NextResponse.json(
      {
        ok: true,
        status: newsFlowOk && persistence.ok ? 'ok' : 'degraded',
        syncOk,
        success: newsFlowOk && persistence.ok,
        messageAr:
          !syncOk && publishedDelta > 0
            ? `${sync.messageAr} — نشرت الخلاصات المباشرة ${publishedDelta} مقالًا في هذه الجولة.`
            : sync.messageAr,
        newsFetched: thisRunRecords.reduce((total, record) => total + (record.fetchedCount || 0), 0),
        newsImported: thisRunRecords.reduce((total, record) => total + (record.importedCount || 0), 0),
        newsPublished: publishedDelta,
        newsDuplicates: thisRunRecords.reduce((total, record) => total + (record.duplicateCount || 0), 0),
        newsRejected: thisRunRecords.reduce((total, record) => total + (record.rejectedCount || 0), 0),
        newsUpdated: thisRunRecords.reduce((total, record) => total + (record.updatedCount || 0), 0),
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
