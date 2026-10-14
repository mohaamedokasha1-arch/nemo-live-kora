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
            'Turso/libSQL: اضبط TURSO_DATABASE_URL وTURSO_AUTH_TOKEN ثم أعد النشر.',
            'Upstash Redis (Vercel Marketplace): اضبط KV_REST_API_URL وKV_REST_API_TOKEN ثم أعد النشر.',
            'Vercel Blob: اضبط BLOB_READ_WRITE_TOKEN ثم أعد النشر.',
            'أو أي نقطة HTTP: اضبط NEMO_DURABLE_STORE_URL (و NEMO_DURABLE_STORE_TOKEN عند الحاجة).',
            'NEMO_DURABLE_STORE أو NEMO_STORAGE_DRIVER يمكن أن يحددا الخيار صراحة: turso أو redis/upstash أو blob/vercel-blob أو http أو file.',
            'على خادم بديسك حقيقي لا حاجة لمخزن سحابي: ملف JSON المحلي دائم، ويمكن إعلان مجلد مثبّت عبر NEMO_DATA_DIR وNEMO_STORAGE_FILE_DURABLE=true.',
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
