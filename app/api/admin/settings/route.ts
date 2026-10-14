import { NextRequest, NextResponse } from 'next/server';
import { revalidatePublicPaths } from '@/lib/admin/revalidate';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { getSiteSettings, loadManualDocument } from '@/lib/admin/manual-store';
import { saveSiteSettings } from '@/lib/admin/service';
import { describeSettingEffects } from '@/lib/admin/setting-effects';
import type { ManualSiteSettings } from '@/lib/admin/manual-document';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * إعدادات الموقع: كل بند هنا له أثر حقيقي مقروء في وقت التشغيل، وليس حقلًا للعرض.
 * والتغييرات التي تمسّ الفهرسة أو المشاركة تُعاد مع تحذير صريح وتتطلب تأكيدًا.
 */
export async function GET(request: NextRequest) {
  const auth = requireAdminPermission(request, 'settings:read');
  if (isDenied(auth)) return auth.response;
  await loadManualDocument();
  return NextResponse.json(
    {
      ok: true,
      settings: getSiteSettings(),
      effectsAr: describeSettingEffects(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function PUT(request: NextRequest) {
  const auth = requireAdminPermission(request, 'settings:write');
  if (isDenied(auth)) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Partial<ManualSiteSettings> & { confirmSeo?: boolean };
  await loadManualDocument();

  const outcome = await saveSiteSettings(body, auth.identity, { confirmSeo: body.confirmSeo });
  if (outcome.ok) {
    revalidatePublicPaths(['/', '/news', '/contact', '/sitemap.xml']);
  }
  return NextResponse.json(
    {
      ok: outcome.ok,
      messageAr: outcome.messageAr,
      data: outcome.data,
      seoImpactAr: outcome.seoImpactAr,
      warningsAr: outcome.warningsAr,
    },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}
