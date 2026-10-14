import { NextRequest, NextResponse } from 'next/server';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { getDashboard } from '@/lib/admin/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * لوحة المؤشرات: الحالة الفعلية للنظام كما هي محسوبة من المخزن وسجلات المزامنة —
 * لا تقديرات ولا أرقام «مفترضة». وكل تحذير هنا مبني على فحص حقيقي (تقادم بيانات،
 * غياب تخزين دائم، تعطيل كل المصادر…).
 */
export async function GET(request: NextRequest) {
  const auth = requireAdminPermission(request, 'dashboard:read');
  if (isDenied(auth)) return auth.response;
  const dashboard = await getDashboard();
  return NextResponse.json(
    { ok: true, ...dashboard },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
