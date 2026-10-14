import { NextRequest, NextResponse } from 'next/server';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { getBackupForDownload, listBackups, verifyBackupRecord } from '@/lib/admin/backups';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * نسخة واحدة: فحص السلامة (يعيد حساب البصمة فعلًا) أو تنزيل الملف.
 * التنزيل يرفض نسخة تالفة بدل تسليم ملف لا يمكن الاعتماد عليه.
 */
type Context = { params: Promise<{ id: string }> };

async function readRecord(id: string) {
  return getBackupForDownload(id);
}

export async function GET(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'backups:read');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  await loadManualDocument();

  const decoded = decodeURIComponent(id);
  const url = new URL(request.url);
  const items = await listBackups();
  const item = items.find((entry) => entry.id === decoded);

  if (url.searchParams.get('download') === '1') {
    const file = await readRecord(decoded);
    if (!file.ok || !file.raw) {
      return NextResponse.json({ ok: false, messageAr: file.messageAr }, { status: 404 });
    }
    return new NextResponse(file.raw, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${decoded}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const record = await readBackupRecordForVerification(decoded);
  if (!record) {
    return NextResponse.json(
      { ok: false, error: 'NotFound', messageAr: item ? 'تعذّرت قراءة محتوى النسخة.' : 'النسخة غير موجودة.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const verification = verifyBackupRecord(record);
  return NextResponse.json(
    { ok: true, summary: item ?? null, verification },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/** نقرأ النسخة كاملة للتحقق من البصمة — وهي العملية نفسها المستخدمة في الاستعادة. */
async function readBackupRecordForVerification(id: string) {
  const { getBackupForDownload } = await import('@/lib/admin/backups');
  const file = await getBackupForDownload(id);
  if (!file.ok || !file.raw) return null;
  try {
    return JSON.parse(file.raw) as Parameters<typeof verifyBackupRecord>[0];
  } catch {
    return null;
  }
}

/**
 * حذف نسخة: دور المالك فقط، ولا تُحذف أحدث نسخة (حماية من الحذف بالخطأ).
 */
export async function DELETE(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'backups:write');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  await loadManualDocument();
  const { deleteBackup } = await import('@/lib/admin/backups');
  const outcome = await deleteBackup(decodeURIComponent(id), auth.identity);
  return NextResponse.json(
    { ok: outcome.ok, messageAr: outcome.messageAr },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}
