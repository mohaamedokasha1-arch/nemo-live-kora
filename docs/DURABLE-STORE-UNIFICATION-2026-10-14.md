# توحيد طبقة التخزين الدائم — 2026-10-14

## 1. المشكلة كما ظهرت في الإنتاج

على Vercel كانت سجلات كل مزامنة تطبع `store_write_failed: updates are memory-only`، وكان
`/api/cron/update-matches` يعيد `503` رغم نجاح جلب المباريات. الفحص وجد ثلاث علل متراكبة:

1. **كتابة داخل حزمة مقروءة فقط.** `persistGatewayDatabase()` كان يكتب دائمًا إلى
   `process.cwd()/data/gateway-store.json`، وهو مسار داخل حزمة النشر على Vercel؛ فتفشل الكتابة
   المحلية وتُطبع كخطأ في كل تعديل — حتى عندما تنجح الكتابة الدائمة لاحقًا.
2. **طبقتا تخزين متوازيتان لا تتفقان.** المسار الحي (`lib/db/durable-store.ts`) كان يعرف فقط
   Redis/HTTP (`KV_REST_API_*` أو `NEMO_DURABLE_STORE_URL`)، بينما طبقة الأدوات
   (`lib/storage/`) — الموثّقة في `.env.example` بوصفها الخيار الموصى به — كانت تعرف
   Turso وUpstash وVercel Blob ولا يستخدمها أي طلب. فمن ضبط `TURSO_DATABASE_URL` كما نصحته
   الوثائق بقي الكرون يرد `503 durable_store_not_configured`، وكانت `/api/health` و`/sources`
   يصفان مخزنًا مختلفًا عمّا يقرأه الكرون. وحتى داخل Redis اختلف مفتاح اللقطة
   (`nemo-live-kora:gateway-store`) عن مفتاح الأدوات (`nemo:gateway`).
3. **مسارات كرون بلا انتظار للحفظ.** `/api/cron/sync` و`/api/cron/sync-news` ومزامنة الإدارة
   كانت تعتمد على كتابة خلفية بعد الرد (`after()`) دون تأكيد، ومزامنة الأخبار لم تكن تقرأ
   النسخة المشتركة قبل التعديل أصلًا. كما أن كتابة دائمة بدأت قبل اكتمال تعديلات المزامنة
   نفسها كان يمكن أن تؤكد الكرونَ نجاحُها على لقطة أقدم من بياناته.

## 2. ما تغيّر

| الملف | التغيير |
| --- | --- |
| `lib/db/durable-store.ts` | مخزنان جديدان على المسار الحي: `turso` (جدول `nemo_kv_store` + مرآة خام متزامنة في `gateway_documents` بنفس pipeline، وقراءة احتياطية من `gateway_documents` المُرحّلة) و`blob` (Vercel Blob بمسار ثابت). توحيد المحدّدين: `NEMO_DURABLE_STORE` ثم `NEMO_STORAGE_DRIVER` يقودان نفس المخازن، والكشف التلقائي بالترتيب Turso ← Redis/KV ← Blob ← HTTP. تحويل `libsql://`/`wss://` إلى `https://`. قراءة احتياطية لمفتاح Redis القديم `nemo:gateway`. ودالة `decodeStoredSnapshot` تقبل المظروف المضغوط أو مستند `GatewayDatabase` خامًا (بفحص شكل صارم) فتُتبنّى بيانات الأدوات بدل رفضها. |
| `lib/db/store.ts` | مسارات ملف محلي ديناميكية: `NEMO_DATA_DIR` ← `/tmp/nemo-gateway/` على serverless ← `data/` على خادم عادي، والحزمة المدمجة للقراءة كبذرة فقط. لا كتابة داخل الحزمة المقروءة، وفشل الملف المحلي يُسجَّل مرة واحدة كتحذير لا كخطأ مكرر. `flushDurableStore` يصرّف بحلقة محدودة (3 تمريرات) حتى تشمل الكتابةُ المؤكدة أيَّ تعديل وصل أثناءها. `PersistenceMode` يشمل `turso`/`blob`، و`verifyStorageRoundTrip` يتحقق أيضًا من ملف محلي دائم فعليًا على خادم بديسك. |
| `lib/storage/` | محرك `http` جديد بنفس مظروف اللقطة؛ `selectStorageDriver` يكتشف المخازن الأربعة بنفس ترتيب الطبقة الحية ويراعي المحدّد الصريح، ويبني Upstash بمفتاح اللقطة نفسه. محلّل مشترك `parseStoredGatewayDocument` يقرأ الصيغتين (خام/مظروف) في محركات Turso وUpstash وBlob، وتحويل عناوين `libsql://` في محرك Turso. |
| `app/api/cron/update-matches/route.ts` | كما كان (قراءة مشتركة ← مزامنة ← انتظار الحفظ ← `200` فقط عند الدوام) مع إرفاق `storage` التشخيصي و`Cache-Control: no-store` ورسائل سبب تذكر كل الخيارات. |
| `app/api/cron/sync/route.ts`، `app/api/cron/sync-news/route.ts`، `app/api/admin/news/sync/route.ts` | تنتظر `flushDurableStore({ force: true })` قبل الرد وتُرفق `persistence`؛ فلا `200` على serverless إلا بعد حفظ مشترك مؤكد. |
| `lib/sync/engine.ts` | مزامنة الأخبار تقرأ النسخة المشتركة (`hydrateStore`) قبل التعديل كمزامنة المباريات. |
| `instrumentation.ts` | تحذير إقلاع واحد قابل للتنفيذ عند غياب مخزن دائم على serverless، بدل صمت يتبعه `503` بلا سياق. |
| `scripts/check-store.ts`، `.env.example`، `README.md` | توثيق موحّد: واحد من Turso/KV/Blob/HTTP يكفي، مع خطوة إعادة النشر بعد ضبط المتغيرات. |
| `tests/durable-store-unified.test.ts` (جديد) | 7 اختبارات: توحيد المحدّدين، فك الصيغتين ورفض الفاسد، Turso ضد خادم pipeline حقيقي (مظروف + مرآة + إقلاع بارد)، Blob بمسار ثابت، ملف `/tmp` على serverless بلا ادعاء دوام وبلا خطأ `memory-only`، وتصريف سباق الكتابة. |

## 3. حدود لم تتغير (بقصد)

- **لا نجاح وهمي:** بدون مخزن سحابي مضبوط على Vercel يبقى الرد `503` مع `storageReason`، لأن
  `/tmp` ذاكرة دافئة لنسخة واحدة ولا توجد وسيلة برمجية لإنشاء حساب/مخزن سحابي من داخل الكود.
  الخطوة الوحيدة خارج هذا المستودع: ربط Upstash أو Turso أو Blob من لوحة Vercel (أو ضبط أي
  نقطة HTTP) ثم إعادة النشر، وبعدها يكتشف الكود المخزن تلقائيًا.
- **لا قفل موزّع:** الكتابة الأخيرة ما زالت تفوز عند تزامن نسختين.
- **حماية النسخة الأحدث باقية:** رفض الكتابة قبل القراءة (`store_not_hydrated`) ليس قيدًا على
  المسار المهيأ — كل مسارات الكرون تقرأ أولًا — بل منعٌ لاستبدال بيانات إنتاج أحدث ببذرة الحزمة.

## 4. التحقق

- `npm test`: كل الاختبارات ناجحة (منها 7 جديدة هنا)، و`npm run typecheck` و`npm run lint`
  و`npm run build` بلا أخطاء.
- تشغيل إنتاجي محلي (`next start` مع `VERCEL=1`) ومخزن HTTP مشترك محلي: للكرون والصحة وما بعد إعادة التشغيل — انظر `docs/evidence/durable-store-unification-e2e-2026-10-14.json`.
