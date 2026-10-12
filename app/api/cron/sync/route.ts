import { NextRequest, NextResponse } from 'next/server';
import { runGatewaySync } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';

function isAuthorizedCronRequest(request: NextRequest): boolean {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const ingestToken = (process.env.NEMO_INGEST_TOKEN || '').trim();

  // If neither secret is configured in local/preview environment, allow same-origin UI trigger
  if (!cronSecret && !ingestToken) {
    return true;
  }

  const authHeader = request.headers.get('authorization') || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const customHeader = (request.headers.get('x-nemo-ingest-token') || '').trim();

  if (cronSecret && bearerToken === cronSecret) return true;
  if (ingestToken && (bearerToken === ingestToken || customHeader === ingestToken)) return true;

  return false;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'غير مصرح — يرجى تمرير ترويسة Authorization: Bearer <CRON_SECRET> أو x-nemo-ingest-token صالحة.',
      },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const rawMode = searchParams.get('mode');
  const mode =
    rawMode === 'live' || rawMode === 'standings' || rawMode === 'manual'
      ? rawMode
      : 'daily';

  const log = await runGatewaySync({
    mode,
    trigger: `Cron GET (${mode})`,
  });

  return NextResponse.json({
    ok: true,
    syncLog: log,
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'غير مصرح — يرجى تمرير ترويسة Authorization: Bearer <CRON_SECRET> أو x-nemo-ingest-token صالحة.',
      },
      { status: 401 }
    );
  }

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

  return NextResponse.json({
    ok: true,
    syncLog: log,
  });
}
