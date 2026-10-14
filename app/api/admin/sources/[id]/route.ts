import { NextRequest, NextResponse } from 'next/server';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { getSourceRows, saveSourceControl } from '@/lib/admin/service';
import { runGatewaySync } from '@/lib/sync/engine';
import type { SourceId } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * مصدر واحد: تفعيل/تعطيل + ترتيب الأولوية، وإعادة محاولة يدوية **لهذا المصدر فقط**
 * (بلا تشغيل بقية المصادر معه، فلا تُستهلك حصصها بلا داعٍ).
 *
 * التعطيل لا يحذف إعدادات المصدر ولا بياناته السابقة — فقط يوقف النداءات الجديدة.
 */

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'sources:read');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  await loadManualDocument();
  const sourceId = decodeURIComponent(id) as SourceId;
  const row = getSourceRows().find((item) => item.id === sourceId);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: 'NotFound', messageAr: 'مصدر غير معروف.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return NextResponse.json({ ok: true, source: row }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'sources:write');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    priority?: number | string | null;
    noteAr?: string | null;
  };
  await loadManualDocument();

  const outcome = await saveSourceControl(decodeURIComponent(id), body, auth.identity);
  return NextResponse.json(
    { ok: outcome.ok, messageAr: outcome.messageAr, data: outcome.data, warningsAr: outcome.warningsAr },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}

/** إعادة المحاولة اليدوية: تُشغّل جلبًا حقيقيًا من هذا المصدر وتُبلّغ بنتيجته الفعلية. */
export async function POST(request: NextRequest, context: Context) {
  const auth = requireAdminPermission(request, 'sync:run');
  if (isDenied(auth)) return auth.response;
  const { id } = await context.params;
  const sourceId = decodeURIComponent(id) as SourceId;
  await loadManualDocument();

  const before = getSourceRows().find((item) => item.id === sourceId);
  if (!before) {
    return NextResponse.json(
      { ok: false, error: 'NotFound', messageAr: 'مصدر غير معروف.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (!before.enabled) {
    return NextResponse.json(
      {
        ok: false,
        error: 'SourceDisabled',
        messageAr: 'المصدر معطّل من اللوحة — فعّله أولًا ثم أعد المحاولة، أو شغّل مصدرًا آخر.',
      },
      { status: 409, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const startedAt = Date.now();
  const log = await runGatewaySync({
    mode: 'manual',
    trigger: `إعادة محاولة يدوية من لوحة الإدارة (${sourceId})`,
    skipNews: sourceId !== 'google-news-rss',
    sources: [sourceId],
  });
  const result = log.sourceResults.find((item) => item.sourceId === sourceId) ?? null;
  const after = getSourceRows().find((item) => item.id === sourceId) ?? null;
  const ok = Boolean(result && result.matchesFetched + result.newsFetched + result.standingsFetched > 0) || after?.status === 'active';

  return NextResponse.json(
    {
      ok,
      messageAr:
        result?.messageAr ||
        `انتهت محاولة ${sourceId} دون نتيجة مسجّلة — راجع سجل الأخطاء. لم تُحذف أي بيانات سابقة.`,
      durationMs: Date.now() - startedAt,
      result,
      source: after,
      /** البيانات السابقة تبقى معروضة مع وقت آخر تحديث ناجح — لا بيانات وهمية عند الفشل. */
      lastGoodDataAt: after?.lastSuccessfulDataAt ?? null,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
