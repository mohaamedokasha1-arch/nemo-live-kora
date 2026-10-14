import { NextRequest, NextResponse } from 'next/server';
import { cairoDatePagePaths, revalidatePublicPaths } from '@/lib/admin/revalidate';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { restoreBackup } from '@/lib/admin/backups';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * الاستعادة: تتطلب دور المالك + تأكيدًا نصيًا بمعرّف النسخة، وتُنشئ نسخة وقائية
 * من الحالة الحالية قبل أي كتابة. لو تعذّرت النسخة الوقائية نُوقف الاستعادة.
 */
type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'backups:restore');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { confirmation?: string };
  await loadManualDocument();

  const outcome = await restoreBackup({
    id: decodeURIComponent(id),
    confirmation: body.confirmation || '',
    actor: auth.identity,
  });
  if (outcome.ok) {
    revalidatePublicPaths(['/', '/news', '/news/archive', '/sitemap.xml', ...cairoDatePagePaths()]);
  }
  return NextResponse.json(
    {
      ok: outcome.ok,
      messageAr: outcome.messageAr,
      preRestoreBackupId: outcome.preRestoreBackupId,
      warningsAr: outcome.warningsAr,
    },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}
