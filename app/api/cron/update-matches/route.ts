import { NextResponse } from 'next/server';
import { ensureFreshMatches } from '@/lib/sync/engine';

/**
 * مسار تحديث المباريات: /api/cron/update-matches
 *
 * - أول ما يتم زيارة الرابط (GET) — أو استدعاؤه بـ POST من مجدول خارجي —
 *   يُشغِّل تحديث المباريات من المصادر عبر `ensureFreshMatches`.
 * - تمرير `maxAgeMs = 0` يعني أن كل زيارة تُشغِّل تحديثًا فعليًا، لكن
 *   الزيارات المتزامنة تتشارك نفس عملية التحديث الجارية بدل تكرارها.
 * - فشل أي مصدر لا يُسقط الطلب: المحرك يعزل أعطال المصادر ويحتفظ
 *   بالبيانات السابقة، لذا تظل الاستجابة دائمًا `{"status": "ok"}`.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function updateMatches() {
  console.log('[cron:update-matches] ▶ بدء تحديث المباريات');

  try {
    await ensureFreshMatches(0, 'API /api/cron/update-matches (live)');
    console.log('[cron:update-matches] ✅ انتهى تحديث المباريات');
  } catch (error) {
    // أعطال المصادر معزولة داخل محرك المزامنة والبيانات السابقة محفوظة،
    // فلا نجعل زيارة الرابط تفشل بسبب مصدر خارجي متعطل مؤقتًا.
    console.error(
      `[cron:update-matches] ✖ تعذر تحديث المباريات — ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return NextResponse.json({ status: 'ok' });
}

/** GET: زيارة الرابط في المتصفح أو من Vercel Cron تُحدِّث المباريات. */
export async function GET() {
  return updateMatches();
}

/** POST: متاح للمجدولات الخارجية التي تفضّل POST على GET. */
export async function POST() {
  return updateMatches();
}
