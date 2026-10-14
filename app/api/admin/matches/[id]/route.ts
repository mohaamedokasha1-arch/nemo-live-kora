import { NextRequest, NextResponse } from 'next/server';
import { cairoDatePagePaths, revalidatePublicPaths } from '@/lib/admin/revalidate';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import {
  deleteManualMatch,
  detectDuplicateMatch,
  queryAdminMatches,
  updateManualMatch,
  type MatchFormInput,
} from '@/lib/admin/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * مباراة واحدة: قراءة، تعديل يدوي (بلا إنشاء نسخة مكرّرة)، حذف بتأكيد نصّي.
 * وبعد أي تغيير نُبطل مسارات الصفحة المرتبطة حتى يرى الزوار النتيجة فورًا.
 */

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'matches:read');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  await loadManualDocument();

  const decoded = decodeURIComponent(id);
  const { rows } = queryAdminMatches({ limit: 500 });
  const row = rows.find((item) => item.id === decoded);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: 'NotFound', messageAr: 'لا توجد مباراة بهذا المعرّف في المخزن.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const duplicate = detectDuplicateMatch({
    id: row.id,
    competitionCode: row.competitionCode,
    cairoDate: row.cairoDate,
    homeNameAr: row.homeNameAr,
    awayNameAr: row.awayNameAr,
  });
  return NextResponse.json({ ok: true, match: row, duplicateOf: duplicate.duplicateOf }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'matches:write');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as MatchFormInput & { confirmation?: string };
  await loadManualDocument();

  const outcome = await updateManualMatch(decodeURIComponent(id), body, auth.identity);
  if (outcome.ok && outcome.data) {
    revalidatePublicPaths([
      `/matches/${outcome.data.id}`,
      `/live/${outcome.data.id}`,
      '/',
      '/sitemap.xml',
      ...cairoDatePagePaths(),
    ]);
  }
  return NextResponse.json(
    { ok: outcome.ok, messageAr: outcome.messageAr, data: outcome.data, warningsAr: outcome.warningsAr },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function DELETE(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'matches:write');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  const url = new URL(request.url);
  const confirmation = url.searchParams.get('confirmation') || '';
  await loadManualDocument();

  const decoded = decodeURIComponent(id);
  const outcome = await deleteManualMatch(decoded, confirmation, auth.identity);
  if (outcome.ok) {
    revalidatePublicPaths([`/matches/${decoded}`, `/live/${decoded}`, '/', '/sitemap.xml', ...cairoDatePagePaths()]);
  }
  return NextResponse.json(
    { ok: outcome.ok, messageAr: outcome.messageAr, data: outcome.data, warningsAr: outcome.warningsAr },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}
