import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/auth/cron-auth';
import { runNewsSync } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const denied = requireAdminRequest(request);
  if (denied) return denied;

  const sync = await runNewsSync('لوحة الإدارة — مزامنة اختبارية');
  return NextResponse.json({
    ok: sync.ok,
    sync,
  });
}
