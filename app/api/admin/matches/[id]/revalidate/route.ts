import { NextRequest, NextResponse } from 'next/server';
import { cairoDatePagePaths, revalidatePublicPaths } from '@/lib/admin/revalidate';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { getGatewayDatabase, persistGatewayDatabase } from '@/lib/db/store';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { findServedCatalogEntryForMatch, getServedCatalogEntries } from '@/lib/admin/served-catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * «نشر التعديل على الموقع»: يعيد بناء مسارات الصفحة المرتبطة بالمباراة (الهبوط والبث
 * والصفحة الرئيسية والخريطة) في نفس النسخة — بلا انتظار إعادة النشر الكاملة.
 * ويُعيد قائمة المسارات التي أُبطلت فعلًا، فلا ندّعي نشرًا لم يحدث.
 */
type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'matches:write');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  await loadManualDocument();

  const decoded = decodeURIComponent(id);
  const db = getGatewayDatabase();
  const match = db.matches.find((item) => item.id === decoded);
  const manualEntry = getServedCatalogEntries().find((entry) => entry.id === decoded);
  const linkedEntry = match ? findServedCatalogEntryForMatch(match) : manualEntry;
  if (!match && !linkedEntry) {
    return NextResponse.json(
      { ok: false, error: 'NotFound', messageAr: 'لا توجد مباراة بهذا المعرّف — لم يُبطل أي مسار.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const paths = new Set<string>(['/', '/sitemap.xml', ...cairoDatePagePaths()]);
  if (linkedEntry) paths.add(`/matches/${linkedEntry.id}`);
  paths.add(`/live/${linkedEntry?.id ?? decoded}`);
  paths.add(`/live/${decoded}`);
  paths.add(`/matches/${decoded}`);
  const revalidated = revalidatePublicPaths(Array.from(paths));

  // نضمن أيضًا أن لقطة المخزن مكتوبة بعد التعديل، فلا يقرأ طلب آخر حالة قديمة.
  persistGatewayDatabase(db);

  return NextResponse.json(
    {
      ok: true,
      messageAr: `نُشر التعديل: أُبطلت ${revalidated.length} مسارًا في نفس النسخة، وسيُعاد بناء الباقي عند أول زيارة.`,
      revalidated,
      matchId: decoded,
      landingPath: linkedEntry ? `/matches/${linkedEntry.id}` : null,
      livePath: `/live/${linkedEntry?.id ?? decoded}`,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
