import { NextRequest, NextResponse } from 'next/server';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { getSourceRows, getDashboard } from '@/lib/admin/service';
import { resolveGithubConfig } from '@/lib/admin/manual-drivers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * المصادر: حالة كل مصدر الفعلية — آخر محاولة، آخر نجاح، زمن الاستجابة، آخر الأخطاء،
 * عدد السجلات، وهل بياناته متقادمة. كل الأرقام من سجلات المزامنة نفسها، لا تقديرات.
 */
export async function GET(request: NextRequest) {
  const auth = requireAdminPermission(request, 'sources:read');
  if (isDenied(auth)) return auth.response;
  await loadManualDocument();

  const dashboard = await getDashboard();
  return NextResponse.json(
    {
      ok: true,
      sources: getSourceRows(),
      staleThresholdHours: dashboard.settings.staleSourceWarningHours,
      warnings: dashboard.warnings,
      /** ما يمكن الاعتماد عليه فعلًا كتخزين دائم للتعديلات (بلا ادعاءات). */
      durability: {
        githubConfigured: Boolean(resolveGithubConfig()),
        storage: dashboard.storage,
      },
      /** مصادر احتياطية حقيقية فقط: المتصل منها فعلًا وما يوفّره. */
      redundancyAr:
        'الاحتياطي المتاح هو أي مصدر آخر من القائمة أعلاه حالته ليست فاشلة. لا نعدّ المصادر البديلة «جاهزة» إلا إذا نجحت آخر محاولة لها فعلًا.',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
