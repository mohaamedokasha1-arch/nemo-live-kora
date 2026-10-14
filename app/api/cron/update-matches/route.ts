import { NextResponse } from 'next/server';
import {
  flushDurableStore,
  getDurableStoreStatus,
  getGatewayDatabase,
  hydrateGatewayDatabase,
  isServerlessRuntime,
  type PersistenceState,
} from '@/lib/db/store';
import { ensureFreshMatches } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Public endpoint by design: GET and POST trigger a real sync without cron credentials.
 *
 * The synchronization only counts as a success when the resulting snapshot reaches storage that
 * outlives this instance (Turso/libSQL, Upstash Redis / Vercel KV, Vercel Blob, or an HTTP
 * snapshot endpoint — plus the local file on a host with a real disk). A lambda-local write is
 * reported as `degraded` with the exact reason — never as a plain "success". The durable write is
 * a single compressed snapshot with an 8s per-request timeout (configurable), so this handler
 * stays well inside the Vercel function limit even on a cold instance.
 */
async function updateMatches() {
  try {
    // Adopt the newest shared snapshot first so this instance never syncs from a stale bundle.
    await hydrateGatewayDatabase();

    const log = await ensureFreshMatches(0, 'API /api/cron/update-matches (live)');
    const result = getGatewayDatabase().meta.lastMatchesSyncResult;
    const persistence = await flushDurableStore({ force: true });
    const stored = persistence.ok && persistence.durable;
    const ok = Boolean(result?.ok && stored);

    console.info(
      '[cron:update-matches]',
      JSON.stringify({ runId: log?.id, ok, result, persistence })
    );

    return NextResponse.json(
      {
        status: ok ? 'ok' : 'degraded',
        ok,
        runId: log?.id,
        startedAt: log?.startedAt,
        finishedAt: log?.finishedAt,
        result,
        persistence,
        storage: getDurableStoreStatus(),
        durableStorageRequired: Boolean(isServerlessRuntime()),
        ...(stored ? {} : { storageReason: persistenceReason(persistence) }),
      },
      { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    console.error('[cron:update-matches] sync_execution_failed');
    return NextResponse.json({ ok: false, error: 'sync_execution_failed' }, { status: 500 });
  }
}

/** Short Arabic explanation so the 503 is self-diagnosing instead of looking like a random failure. */
function persistenceReason(persistence: PersistenceState): string {
  if (!persistence.durableConfigured) {
    return persistence.error === 'persistence_disabled'
      ? 'التخزين غير مهيأ في هذه البيئة (كتابة الملف المحلي معطّلة) ولا يوجد مخزن خارجي؛ أضف TURSO_DATABASE_URL وTURSO_AUTH_TOKEN أو KV_REST_API_URL وKV_REST_API_TOKEN أو BLOB_READ_WRITE_TOKEN أو NEMO_DURABLE_STORE_URL ثم أعد النشر.'
      : 'التخزين الدائم غير مهيأ: أضف TURSO_DATABASE_URL وTURSO_AUTH_TOKEN (Turso/libSQL) أو KV_REST_API_URL وKV_REST_API_TOKEN (Upstash Redis من Vercel Marketplace) أو BLOB_READ_WRITE_TOKEN (Vercel Blob) أو NEMO_DURABLE_STORE_URL ثم أعد النشر.';
  }
  switch (persistence.error) {
    case 'store_not_hydrated':
      return 'تعذّر قراءة النسخة المشتركة قبل الكتابة؛ أُلغيت الكتابة لمنع استبدال بيانات أحدث في المخزن الدائم.';
    case 'store_write_failed':
      return `فشل الحفظ في المخزن الدائم (${persistence.mode})؛ لم تُثبَّت البيانات المشتركة.`;
    case 'store_read_failed':
    case 'store_write_failed_timeout':
    case 'store_read_failed_timeout':
      return 'تعذّر الاتصال بالمخزن الدائم؛ المزامنة لم تُحفظ في تخزين مشترك.';
    case 'store_snapshot_invalid':
      return 'النسخة المخزّنة في المخزن الدائم غير صالحة ورفُض تحميلها؛ لم تُستبدل بيانات الإنتاج.';
    case 'persistence_disabled':
      return 'كتابة الملف المحلي معطّلة في هذه البيئة (NEMO_GATEWAY_STORE_PERSIST=off).';
    default:
      return 'لم تُثبَّت البيانات في تخزين دائم مشترك بعد.';
  }
}

export const GET = updateMatches;
export const POST = updateMatches;
