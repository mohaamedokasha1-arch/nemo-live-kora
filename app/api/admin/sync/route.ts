import { NextRequest, NextResponse } from 'next/server';
import { revalidatePublicPaths } from '@/lib/admin/revalidate';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { getSourceRows } from '@/lib/admin/service';
import { runGatewaySync, runNewsSync } from '@/lib/sync/engine';
import { verifyStorageRoundTrip } from '@/lib/db/store';
import type { SourceId } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * التحكّم في المهام التلقائية وإعادة المحاولة.
 *
 * ما لا نفعله هنا: لا نُعطّل الكرون ولا نستبدله بنظام يدوي. المهمة المجدولة تبقى على
 * Vercel كما هي، وهذه الصفحة تُشغّل **نفس** المحرّك فورًا عند الحاجة (وضع الطوارئ).
 */
export async function GET(request: NextRequest) {
  const auth = requireAdminPermission(request, 'sources:read');
  if (isDenied(auth)) return auth.response;
  await loadManualDocument();
  // جدول الكرون يُقرأ من ملف الإعداد إن أمكن — وإن تعذّر نعرض الوصف الموثّق نفسه.
  let cronJobs: Array<{ path: string; schedule: string }> | null = null;
  try {
    const raw = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../../../vercel.json', import.meta.url), 'utf-8')
    );
    const parsed = JSON.parse(raw) as { crons?: Array<{ path: string; schedule: string }> };
    cronJobs = parsed.crons ?? null;
  } catch {
    cronJobs = null;
  }
  return NextResponse.json(
    {
      ok: true,
      sources: getSourceRows(),
      cronAr: [
        '05:00 UTC يوميًا → /api/cron/sync — مزامنة كاملة (المباريات + الأخبار) ثم نسخة احتياطية مجدولة.',
        '16:00 UTC يوميًا → /api/cron/update-matches — تحديث النتائج والمواعيد مساءً (بلا مصادقة).',
        'وبين المهمتين يتجدّد المحتوى عند الطلب (نافذة قابلة للضبط من إعدادات الموقع).',
      ],
      cronJobs,
      jobs: [
        { id: 'full', labelAr: 'مزامنة كاملة الآن (كل المصادر + الأخبار)', permission: 'sync:run' },
        { id: 'matches', labelAr: 'تحديث المباريات فقط الآن', permission: 'sync:run' },
        { id: 'news', labelAr: 'تحديث الأخبار فقط الآن', permission: 'sync:run' },
      ],
      noteAr:
        'إعادة المحاولة من هنا حقيقية: تُشغّل نفس محرّك المزامنة وتعود بنتيجة كل مصدر وحدّته الزمنية. أي مصدر معطّل من اللوحة لا يُنادى إطلاقًا.',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  const auth = requireAdminPermission(request, 'sync:run');
  if (isDenied(auth)) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { job?: string; sources?: SourceId[] };
  const job = body.job || 'full';
  await loadManualDocument();

  const startedAt = Date.now();
  const roundTripBefore = await verifyStorageRoundTrip();

  if (job === 'news') {
    const record = await runNewsSync('تشغيل يدوي من لوحة الإدارة');
    revalidatePublicPaths(['/news', '/']);
    return NextResponse.json(
      {
        ok: record.ok,
        job,
        messageAr: record.messageAr,
        durationMs: Date.now() - startedAt,
        news: {
          fetched: record.fetchedCount,
          imported: record.importedCount,
          published: record.publishedCount,
          rejected: record.rejectedCount,
          duplicates: record.duplicateCount,
        },
        storageRoundTripOk: roundTripBefore.ok,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const log = await runGatewaySync({
    mode: job === 'matches' ? 'live' : 'daily',
    trigger: job === 'matches' ? 'تحديث مباريات يدوي من اللوحة' : 'مزامنة كاملة يدوية من اللوحة',
    skipNews: job === 'matches',
    sources: body.sources && body.sources.length > 0 ? body.sources : undefined,
  });

  revalidatePublicPaths(['/', '/news', '/sitemap.xml']);

  const totalFetched = log.sourceResults.reduce(
    (sum, result) => sum + result.matchesFetched + result.newsFetched,
    0
  );
  return NextResponse.json(
    {
      ok: log.sourceResults.some((result) => !result.usedCachedSnapshot),
      job,
      messageAr:
        totalFetched > 0
          ? `اكتملت المحاولة: جُلب ${totalFetched} سجلًا، وحُدِّث المخزن.`
          : 'اكتملت المحاولة بلا أي سجل جديد من المصادر — البيانات السابقة محفوظة ولم تُحذف. راجع قسم المصادر أدناه.',
      durationMs: Date.now() - startedAt,
      totalMatchesInStore: log.totalMatchesInStore,
      totalNewsInStore: log.totalNewsInStore,
      sources: log.sourceResults.map((result) => ({
        sourceId: result.sourceId,
        status: result.status,
        httpStatus: result.httpStatus,
        latencyMs: result.latencyMs,
        matchesFetched: result.matchesFetched,
        newsFetched: result.newsFetched,
        usedCachedSnapshot: result.usedCachedSnapshot,
        messageAr: result.messageAr,
      })),
      storageRoundTripOk: roundTripBefore.ok,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
