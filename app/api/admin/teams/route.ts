import { NextRequest, NextResponse } from 'next/server';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { getManualDocument, loadManualDocument } from '@/lib/admin/manual-store';
import { deleteManualTeam, getTeamOptions, saveManualTeam } from '@/lib/admin/service';
import type { ManualTeamRecord } from '@/lib/admin/manual-document';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * الفرق: قائمة موحّدة (من بيانات المصادر + كتالوج المشروع + ما أضافه المدير)،
 * وإضافة/تعديل فريق يستخدمه المدير في المباريات اليدوية عند توقّف الجلب التلقائي.
 */
export async function GET(request: NextRequest) {
  const auth = requireAdminPermission(request, 'catalog:read');
  if (isDenied(auth)) return auth.response;
  await loadManualDocument();
  const document = getManualDocument();
  return NextResponse.json(
    {
      ok: true,
      teams: getTeamOptions(),
      manualTeams: document.teams,
      noteAr:
        'الفرق القادمة من المصادر للقراءة فقط — الشعار والاسم يتبعان المصدر حتى لا نُخالف بياناته. الفرق التي تضيفها أنت قابلة للتعديل والحذف.',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  const auth = requireAdminPermission(request, 'catalog:write');
  if (isDenied(auth)) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Partial<ManualTeamRecord>;
  await loadManualDocument();
  const outcome = await saveManualTeam(body, auth.identity);
  return NextResponse.json(
    { ok: outcome.ok, messageAr: outcome.messageAr, data: outcome.data, warningsAr: outcome.warningsAr },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function DELETE(request: NextRequest) {
  const auth = requireAdminPermission(request, 'catalog:write');
  if (isDenied(auth)) return auth.response;
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  await loadManualDocument();
  const outcome = await deleteManualTeam(id, auth.identity);
  return NextResponse.json(
    { ok: outcome.ok, messageAr: outcome.messageAr, data: outcome.data },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}
