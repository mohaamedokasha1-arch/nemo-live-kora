import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/auth/cron-auth';
import { flushDurableStore, isServerlessRuntime } from '@/lib/db/store';
import { runGatewaySync } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function parseMode(raw: string | null | undefined): 'live' | 'daily' | 'standings' | 'manual' {
  return raw === 'live' || raw === 'standings' || raw === 'manual' ? raw : 'daily';
}

function sourcesOk(log: Awaited<ReturnType<typeof runGatewaySync>>): boolean {
  return log.sourceResults.some(
    (source) =>
      !source.usedCachedSnapshot &&
      (source.matchesFetched > 0 || (source.newsPublished || 0) > 0 || source.standingsFetched > 0)
  );
}

async function respond(log: Awaited<ReturnType<typeof runGatewaySync>>) {
  // The sync only mutated memory + the local file; on serverless neither survives the instance.
  // Wait for the shared snapshot write and report it, exactly like /api/cron/update-matches.
  const persistence = await flushDurableStore({ force: true });
  const stored = persistence.ok && persistence.durable;
  const fetched = sourcesOk(log);
  const ok = fetched && stored;
  return NextResponse.json(
    {
      ok,
      syncLog: log,
      persistence,
      durableStorageRequired: Boolean(isServerlessRuntime()),
      ...(stored
        ? {}
        : {
            storageReason:
              'لم تُحفظ نتيجة المزامنة في تخزين دائم مشترك؛ اضبط أحد مخازن Turso/Upstash KV/Vercel Blob/HTTP ثم أعد المحاولة.',
          }),
    },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function GET(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const mode = parseMode(new URL(request.url).searchParams.get('mode'));
  const log = await runGatewaySync({
    mode,
    trigger: `Cron GET (${mode})`,
  });

  return respond(log);
}

export async function POST(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  let mode: 'live' | 'daily' | 'standings' | 'manual' = 'manual';
  try {
    const body = await request.json();
    if (body?.mode === 'live' || body?.mode === 'daily' || body?.mode === 'standings') {
      mode = body.mode;
    }
  } catch {
    // default to 'manual'
  }

  const log = await runGatewaySync({
    mode,
    trigger: `تحديث فوري (${mode})`,
  });

  return respond(log);
}
