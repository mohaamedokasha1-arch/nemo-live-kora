import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/auth/cron-auth';
import { flushDurableStore, isServerlessRuntime } from '@/lib/db/store';
import { runNewsSync } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const denied = requireAdminRequest(request);
  if (denied) return denied;

  const sync = await runNewsSync('لوحة الإدارة — مزامنة اختبارية');
  const persistence = await flushDurableStore({ force: true });
  const stored = persistence.ok && persistence.durable;
  return NextResponse.json(
    {
      ok: sync.ok && stored,
      sync,
      persistence,
      durableStorageRequired: Boolean(isServerlessRuntime()),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
