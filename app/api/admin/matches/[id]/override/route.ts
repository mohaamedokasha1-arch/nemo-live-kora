import { NextRequest, NextResponse } from 'next/server';
import { cairoDatePagePaths, revalidatePublicPaths } from '@/lib/admin/revalidate';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { CONFLICT_POLICY_SUMMARY_AR } from '@/lib/admin/manual-document';
import { saveMatchOverride, type OverrideFormInput } from '@/lib/admin/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * سياسة فضّ التعارض لمباراة بعينها: تثبيت حقول محددة، أو تجميد السجل بالكامل،
 * أو استبعاد مصدر معيّن عن هذه المباراة فقط.
 *
 * هذا هو ما يمنع «المزامنة التالية» من محو تعديلات المدير: القيم المثبَّتة تُعاد
 * فوق نتيجة أي دمج في `lib/db/store.ts` نفسه.
 */

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'matches:read');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  await loadManualDocument();
  const { findManualOverride } = await import('@/lib/admin/manual-store');
  return NextResponse.json(
    {
      ok: true,
      matchId: decodeURIComponent(id),
      override: findManualOverride(decodeURIComponent(id)),
      policyAr: CONFLICT_POLICY_SUMMARY_AR,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'matches:write');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as OverrideFormInput;
  await loadManualDocument();

  const decoded = decodeURIComponent(id);
  const outcome = await saveMatchOverride(decoded, body, auth.identity);
  if (outcome.ok) {
    revalidatePublicPaths([`/matches/${decoded}`, `/live/${decoded}`, '/', ...cairoDatePagePaths()]);
  }
  return NextResponse.json(
    { ok: outcome.ok, messageAr: outcome.messageAr, data: outcome.data, warningsAr: outcome.warningsAr },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}
