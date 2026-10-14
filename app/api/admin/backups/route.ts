import { NextRequest, NextResponse } from 'next/server';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { backupRetention, buildBackup, listBackups, persistBackup } from '@/lib/admin/backups';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * النسخ الاحتياطية: قائمة ما هو موجود فعلًا، وإنشاء نسخة كاملة عند الطلب.
 *
 * النسخة تحتوي: مستند الإدارة كاملًا + لقطة مخزن الموقع + ملخّص إعدادات بلا أسرار.
 * ولا تُعتبر ناجحة إلا إذا كُتبت على تخزين دائم (GitHub أو قرص دائم) — وإلا تُرفض
 * برسالة تشرح ما ينقص بدل إيهامك بنسخة ستضيع.
 */
export async function GET(request: NextRequest) {
  const auth = requireAdminPermission(request, 'backups:read');
  if (isDenied(auth)) return auth.response;
  await loadManualDocument();
  const items = await listBackups();
  return NextResponse.json(
    {
      ok: true,
      backups: items,
      retention: backupRetention(),
      noteAr:
        'النسخة الكاملة تشمل: مباريات اللوحة وتثبيتاتها وأخبارها وفرقها وإعداداتها + لقطة مخزن الموقع (المباريات والأخبار والترتيب وحالة كل مصدر) + ملخّص الإعدادات بلا أي مفتاح سري.',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  const auth = requireAdminPermission(request, 'backups:write');
  if (isDenied(auth)) return auth.response;
  await loadManualDocument();
  const record = await buildBackup({
    kind: 'manual',
    createdBy: auth.identity.username,
    labelAr: `نسخة يدوية أنشأها ${auth.identity.displayNameAr}`,
  });
  const outcome = await persistBackup(record);
  return NextResponse.json(
    {
      ok: outcome.ok,
      messageAr: outcome.messageAr,
      summary: outcome.summary,
      warningsAr: outcome.warningsAr,
    },
    { status: outcome.ok ? 201 : 409, headers: { 'Cache-Control': 'no-store' } }
  );
}
