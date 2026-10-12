import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/auth/cron-auth';
import { runGatewaySync } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function parseMode(raw: string | null | undefined): 'live' | 'daily' | 'standings' | 'manual' {
  return raw === 'live' || raw === 'standings' || raw === 'manual' ? raw : 'daily';
}

export async function GET(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const mode = parseMode(new URL(request.url).searchParams.get('mode'));
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

  return NextResponse.json({
    ok: true,
    syncLog: log,
  });
}
