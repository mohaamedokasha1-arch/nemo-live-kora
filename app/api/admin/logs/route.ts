import { NextRequest, NextResponse } from 'next/server';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { getAdminLogs, getAuditStats } from '@/lib/admin/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * سجل الأخطاء وسجل العمليات الإدارية في مكان واحد:
 *  • تدقيق الإدارة: من فعل ماذا ومتى وبنيتيجة أي عملية (نجاح/فشل).
 *  • أخطاء المصادر: حالة HTTP والنقطة الزمنية والرسالة العربية.
 *  • سجل المزامنات: الوضع والمُشغِّل وعدد المباريات في المخزن بعد كل مزامنة.
 */
export async function GET(request: NextRequest) {
  const auth = requireAdminPermission(request, 'logs:read');
  if (isDenied(auth)) return auth.response;
  await loadManualDocument();

  const url = new URL(request.url);
  const limit = Math.min(200, Number(url.searchParams.get('limit') || 50) || 50);
  return NextResponse.json(
    {
      ok: true,
      ...getAdminLogs(limit),
      auditStats: getAuditStats(),
      generatedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
