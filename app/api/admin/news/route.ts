import { NextRequest, NextResponse } from 'next/server';
import { revalidatePublicPaths } from '@/lib/admin/revalidate';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { saveManualNews, queryAdminNews, type NewsFormInput } from '@/lib/admin/service';
import { newsArticleUrl, notifyGoogleIndexingAfterResponse } from '@/lib/seo/google-indexing';
import { SOURCE_CAPABILITIES } from '@/lib/news/capabilities';
import { getNewsAdminStats } from '@/lib/news/query';
import { hydrateStore } from '@/lib/db/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * الأخبار: قائمة كاملة (من المصادر + ما كتبه المدير)، وإنشاء/تعديل خبر يدوي.
 *
 * سياسة النشر: خبر المصدر لا يُنشر إلا بعد اجتياز فحوص `lib/news/validate.ts`
 * (رابط مقال حقيقي + ناشر معروف)، وخبر المدير مسؤوليته ويُسجَّل باسمه. الصفحات
 * المنشورة تبقى على مساراتها نفسها فلا تتأثّر الفهرسة.
 */
export async function GET(request: NextRequest) {
  const auth = requireAdminPermission(request, 'news:read');
  if (isDenied(auth)) return auth.response;
  await hydrateStore();
  await loadManualDocument();

  const url = new URL(request.url);
  const db = await hydrateStore();
  const result = queryAdminNews({
    search: url.searchParams.get('search') || undefined,
    status: url.searchParams.get('status') || undefined,
    origin: (url.searchParams.get('origin') as 'source' | 'manual' | 'all' | null) || 'all',
    limit: Math.min(200, Number(url.searchParams.get('limit') || 60) || 60),
  });

  return NextResponse.json(
    {
      ok: true,
      ...result,
      stats: getNewsAdminStats(db.news),
      meta: {
        lastNewsSyncAt: db.meta.lastNewsSyncAt,
        lastSuccessfulNewsSyncAt: db.meta.lastSuccessfulNewsSyncAt,
      },
      sources: Object.values(db.sources)
        .filter((source) => source.providesNews)
        .map((source) => ({
          id: source.id,
          nameAr: source.nameAr,
          status: source.status,
          statusLabelAr: source.statusLabelAr,
          lastSuccessfulNewsSyncAt: source.lastSuccessfulNewsSyncAt,
          newsImportedCount: source.newsImportedCount,
          newsPublishedCount: source.newsPublishedCount,
          errorCount: source.errorCount,
          /** شرط استخدام المحتوى المعلن لكل مصدر — يُعرض قبل النشر. */
          accessNoteAr: SOURCE_CAPABILITIES[source.id]?.newsAccessNoteAr ?? '',
        })),
      latestSyncs: db.newsSourceSyncs.slice(0, 10),
      importErrors: db.newsImportErrors.slice(0, 10),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  const auth = requireAdminPermission(request, 'news:write');
  if (isDenied(auth)) return auth.response;
  const body = (await request.json().catch(() => ({}))) as NewsFormInput;
  await loadManualDocument();

  const outcome = await saveManualNews(body, auth.identity);
  if (outcome.ok && outcome.data) {
    revalidatePublicPaths(['/news', '/news/archive', `/news/${outcome.data.slug}`, '/', '/sitemap.xml']);
    // إشعار Google Indexing بصفحة الخبر الجديدة في الخلفية فور نجاح الحفظ.
    notifyGoogleIndexingAfterResponse([newsArticleUrl(outcome.data.slug)], {
      contextAr: 'admin/news — إنشاء',
    });
  }
  return NextResponse.json(
    {
      ok: outcome.ok,
      messageAr: outcome.messageAr,
      data: outcome.data,
      warningsAr: outcome.warningsAr,
      publicPath: outcome.data ? `/news/${outcome.data.slug}` : null,
    },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}
