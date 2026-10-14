/**
 * Read-only check of the durable store wiring: reports which backend the environment resolves to
 * and whether the stored snapshot can actually be read back. It never writes, so it is safe to run
 * against production at any time.
 *
 * Usage:  npm run store:check
 */
import { getDurableStoreStatus, getPersistenceState, hydrateGatewayDatabase } from '../lib/db/store';

async function main() {
  const status = getDurableStoreStatus();
  if (!status.configured) {
    console.log(
      JSON.stringify(
        {
          configured: false,
          serverless: status.serverless,
          problem:
            'لا يوجد مخزن دائم مهيأ؛ على بيئة serverless تُعتبر البيانات مؤقتة والكرون يعيد 503.',
          howToFix: [
            'Upstash Redis (Vercel Marketplace): اضبط KV_REST_API_URL وKV_REST_API_TOKEN ثم أعد النشر.',
            'أو أي نقطة HTTP: اضبط NEMO_DURABLE_STORE_URL (و NEMO_DURABLE_STORE_TOKEN عند الحاجة).',
            'NEMO_DURABLE_STORE يمكن أن يحدد الخيار صراحة: redis أو http أو file.',
          ],
        },
        null,
        2
      )
    );
    return;
  }

  console.log(JSON.stringify({ ...status, ...getPersistenceState() }, null, 2));
  const startedAt = Date.now();
  const persistence = await hydrateGatewayDatabase();
  console.log(
    JSON.stringify(
      {
        hydrated: persistence.ok,
        mode: persistence.mode,
        durable: persistence.durable,
        error: persistence.error,
        readMs: Date.now() - startedAt,
      },
      null,
      2
    )
  );
  if (!persistence.ok) {
    console.error('تعذّر قراءة النسخة المشتركة؛ تحقق من متغيرات البيئة ومن وصول الشبكة.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
