import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/auth/cron-auth';
import {
  describeStorageWarnings,
  flushDurableStore,
  getActiveMatches,
  getGatewayDatabase,
  hydrateStore,
} from '@/lib/db/store';
import {
  collectChangedMatchIds,
  collectChangedPublishedNewsSlugs,
  matchLandingUrl,
  newsArticleUrl,
  notifyGoogleIndexingAfterResponse,
} from '@/lib/seo/google-indexing';
import { runGatewaySync } from '@/lib/sync/engine';
import type { MatchRecord, NewsItemRecord } from '@/lib/types';

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

/** لقطة «قبل» يقاس عليها التغيّر الحقيقي؛ المصفوفات المنسوخة تحميها من أي استبدال لاحق في المخزن. */
interface IndexingDiffSnapshot {
  matches: MatchRecord[];
  news: NewsItemRecord[];
}

async function snapshotBeforeSync(): Promise<IndexingDiffSnapshot> {
  const db = await hydrateStore();
  return { matches: getActiveMatches(db), news: [...db.news] };
}

/**
 * بعد ثبات المزامنة: يُجمع ما تغيّر فعلًا (مباريات جديدة/محدَّثة + أخبار صارت
 * قابلة للفهرسة) وتُرسَل روابط صفحاته إلى Google في الخلفية عبر after() —
 * الإجابة تُرجَع فورًا ولا ينتظر المجدوّل شبكة Google.
 */
function scheduleIndexingNotifications(contextAr: string, snapshot: IndexingDiffSnapshot): void {
  const dbAfter = getGatewayDatabase();
  const matchUrls = collectChangedMatchIds(snapshot.matches, getActiveMatches(dbAfter)).map(matchLandingUrl);
  const newsUrls = collectChangedPublishedNewsSlugs(snapshot.news, dbAfter.news).map(newsArticleUrl);
  const urls = [...matchUrls, ...newsUrls];
  if (urls.length === 0) return;
  notifyGoogleIndexingAfterResponse(urls, { contextAr });
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
    const snapshot = await snapshotBeforeSync();
    const log = await runGatewaySync({ mode, trigger: `Cron GET (${mode})` });
    scheduleIndexingNotifications(`cron/sync GET (${mode})`, snapshot);
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
    const snapshot = await snapshotBeforeSync();
    const log = await runGatewaySync({ mode, trigger: `تحديث فوري (${mode})` });
    scheduleIndexingNotifications(`cron/sync POST (${mode})`, snapshot);
    return await respond(log);
  } catch {
    console.error('[cron:sync] sync_execution_failed');
    return failed();
  }
}
