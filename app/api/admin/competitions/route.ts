import { NextRequest, NextResponse } from 'next/server';
import { cairoDatePagePaths, revalidatePublicPaths } from '@/lib/admin/revalidate';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { getCompetitionRows, saveCompetitionOverride } from '@/lib/admin/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * البطولات والدوريات والمواسم: القائمة الفعلية = بطولات المشروع + ما ظهر في المباريات،
 * مع إمكانية تثبيت الأولوية والموسم والاسم والشعار ورابط بطولة NEMO.
 *
 * الأثر حقيقي: الأولوية تُعيد ترتيب مباريات البطولة في الصفحة الرئيسية، والموسم يظهر
 * في كل مباراة جديدة تُنشأ من اللوحة. لا نحذف بطولة قائمة ولا نغيّر رابطًا قائمًا.
 */
export async function GET(request: NextRequest) {
  const auth = requireAdminPermission(request, 'catalog:read');
  if (isDenied(auth)) return auth.response;
  await loadManualDocument();
  return NextResponse.json(
    { ok: true, competitions: getCompetitionRows() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function PUT(request: NextRequest) {
  const auth = requireAdminPermission(request, 'catalog:write');
  if (isDenied(auth)) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown> & { code?: string };
  await loadManualDocument();
  const code = String(body.code || '');
  const outcome = await saveCompetitionOverride(code, body as never, auth.identity);
  if (outcome.ok) {
    revalidatePublicPaths(['/', ...cairoDatePagePaths()]);
  }
  return NextResponse.json(
    { ok: outcome.ok, messageAr: outcome.messageAr, data: outcome.data, warningsAr: outcome.warningsAr },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}
