import { NextRequest, NextResponse } from 'next/server';
import { revalidatePublicPaths } from '@/lib/admin/revalidate';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { deleteManualNews, saveManualNews, type NewsFormInput } from '@/lib/admin/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** خبر يدوي واحد: تعديل (ونشر/أرشفة بتغيير الحالة) أو حذف بتأكيد. */
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'news:write');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as NewsFormInput;
  await loadManualDocument();

  const outcome = await saveManualNews(body, auth.identity, decodeURIComponent(id));
  if (outcome.ok && outcome.data) {
    revalidatePublicPaths(['/news', '/news/archive', `/news/${outcome.data.slug}`, '/sitemap.xml']);
  }
  return NextResponse.json(
    { ok: outcome.ok, messageAr: outcome.messageAr, data: outcome.data, warningsAr: outcome.warningsAr },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function DELETE(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'news:write');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  const url = new URL(request.url);
  const confirmation = url.searchParams.get('confirmation') || '';
  await loadManualDocument();

  const decoded = decodeURIComponent(id);
  if (confirmation.trim() !== decoded) {
    return NextResponse.json(
      {
        ok: false,
        error: 'ConfirmationRequired',
        messageAr: `تأكيد الحذف مطلوب: اكتب معرّف الخبر «${decoded}» حرفًا بحرف. لم يُحذف شيء.`,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const outcome = await deleteManualNews(decoded, auth.identity);
  if (outcome.ok) {
    revalidatePublicPaths(['/news', '/news/archive', '/sitemap.xml']);
  }
  return NextResponse.json(
    { ok: outcome.ok, messageAr: outcome.messageAr, data: outcome.data },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}
