import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runMatchesUpdatePipeline } from '@/lib/sync/engine';

/**
 * Vercel Cron endpoint: /api/cron/update-matches
 *
 * - محمي بـ `Authorization: Bearer ${process.env.CRON_SECRET}` فقط.
 * - أي طلب بدون السر الصحيح يحصل على `401 Unauthorized`.
 * - يستدعي Database Pipeline الحقيقي (`runMatchesUpdatePipeline`) لتحديث المباريات.
 * - يسجّل console.log عند بداية ونهاية التحديث، ويرجع JSON فيه عدد المباريات المحدَّثة.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPPORTED_MODES = ['live', 'daily', 'standings', 'manual'] as const;
type SyncMode = (typeof SUPPORTED_MODES)[number];

function parseMode(value: string | null | undefined): SyncMode {
  return SUPPORTED_MODES.includes(value as SyncMode) ? (value as SyncMode) : 'live';
}

/** مقارنة ثابتة الزمن لتفادي هجمات التوقيت (Timing Attacks). */
function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf-8');
  const bufferB = Buffer.from(b, 'utf-8');
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

function unauthorizedResponse(messageAr: string) {
  return NextResponse.json(
    {
      ok: false,
      success: false,
      error: 'Unauthorized',
      messageAr,
    },
    {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="cron"' },
    }
  );
}

/** يتحقق من ترويسة `Authorization: Bearer <CRON_SECRET>`. */
function isAuthorizedCronRequest(request: NextRequest): boolean {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (!cronSecret) return false;

  const authHeader = (request.headers.get('authorization') || '').trim();
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!bearerMatch) return false;

  return safeCompare(bearerMatch[1].trim(), cronSecret);
}

async function handleUpdateMatches(request: NextRequest) {
  const receivedAt = new Date().toISOString();

  // السر غير مضبوط في البيئة => لا نفتح المسار للعامة، بل نرجّع خطأ إعدادات واضحًا
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (!cronSecret) {
    console.error(
      '[cron:update-matches] ✖ CRON_SECRET غير مضبوط في متغيرات البيئة — تم رفض الطلب (لن يعمل المسار بدون السر).'
    );
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: 'CRON_SECRET is not configured on the server',
        messageAr:
          'المتغير البيئي CRON_SECRET غير مضبوط على الخادم. أضفه في Vercel › Project › Settings › Environment Variables ثم أعد النشر.',
      },
      { status: 500 }
    );
  }

  if (!isAuthorizedCronRequest(request)) {
    console.warn(
      `[cron:update-matches] ✖ طلب غير مصرح به تم رفضه — ${receivedAt} — IP: ${
        request.headers.get('x-forwarded-for') || 'unknown'
      }`
    );
    return unauthorizedResponse(
      'غير مصرح — يجب تمرير ترويسة: Authorization: Bearer <CRON_SECRET>'
    );
  }

  const { searchParams } = new URL(request.url);
  let mode = parseMode(searchParams.get('mode'));

  // دعم تمرير الـ mode داخل جسم الطلب في POST
  if (request.method === 'POST') {
    try {
      const body = (await request.json()) as { mode?: string } | null;
      if (body?.mode) mode = parseMode(body.mode);
    } catch {
      // جسم فارغ أو غير JSON: نكتفي بـ query string
    }
  }

  console.log(
    `[cron:update-matches] ▶ بدء عملية تحديث المباريات — ${receivedAt} — mode=${mode}`
  );

  const startedAt = Date.now();
  try {
    const result = await runMatchesUpdatePipeline({
      mode,
      trigger: `Cron /api/cron/update-matches (${mode})`,
    });

    console.log(
      `[cron:update-matches] ✅ انتهى تحديث المباريات — تم تحديث ${result.matchesUpdated} مباراة ` +
        `(جديدة: ${result.matchesAdded}، معدّلة: ${result.matchesChanged}) ` +
        `من أصل ${result.matchesProcessed} مباراة واردة من المصادر ` +
        `— الإجمالي في قاعدة البيانات: ${result.totalMatchesInStore} ` +
        `— المدة: ${Date.now() - startedAt}ms`
    );

    return NextResponse.json(
      {
        ok: true,
        success: true,
        message: 'Matches update completed successfully',
        messageAr: `تم تحديث المباريات بنجاح — ${result.matchesUpdated} مباراة محدَّثة.`,
        updatedMatches: result.matchesUpdated,
        matchesUpdated: result.matchesUpdated,
        matchesAdded: result.matchesAdded,
        matchesChanged: result.matchesChanged,
        matchesProcessed: result.matchesProcessed,
        totalMatches: result.totalMatchesInStore,
        standingsUpdated: result.standingsUpdated,
        newsUpdated: result.newsUpdated,
        mode: result.mode,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        sources: result.sources,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      `[cron:update-matches] ✖ فشل تحديث المباريات بعد ${
        Date.now() - startedAt
      }ms — ${error instanceof Error ? error.message : String(error)}`
    );

    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: 'Matches update failed',
        messageAr: 'فشل تحديث المباريات. راجع سجلات الوظيفة (Function Logs) للتفاصيل.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/** Vercel Cron يستدعي المسار بطلب GET */
export async function GET(request: NextRequest) {
  return handleUpdateMatches(request);
}

/** POST متاح للتشغيل اليدوي (مثل GitHub Actions أو خدمة cron خارجية) */
export async function POST(request: NextRequest) {
  return handleUpdateMatches(request);
}
