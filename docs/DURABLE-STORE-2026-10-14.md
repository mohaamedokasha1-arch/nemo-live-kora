# تقرير التخزين الدائم — 2026-10-14

## 1. المشكلة المقاسة

طلب `GET /api/cron/update-matches` على بيئة النشر كان يعيد `503` مع:

```json
{
  "status": "degraded",
  "ok": false,
  "result": { "ok": true, "matchesFetched": 75, "sourcesOk": ["sportscore", "thesportsdb"], "matchesInserted": 0, "matchesUpdated": 0 },
  "persistence": { "mode": "memory", "ok": false, "error": "store_write_failed" },
  "durableStorageRequired": true
}
```

السبب ليس المصادر (جلبت 75 مباراة من مصدرين) وليس المصادقة (المسار عام بالفعل منذ 2026-10-14)، بل أن
`persistGatewayDatabase()` يكتب `data/gateway-store.json` داخل حزمة النشر، وملف نظام lambda هذا غير قابل
للكتابة على Vercel؛ فتُبتلع الكتابة (`store_write_failed`) ويبقى التحديث في ذاكرة العملية فقط، ثم يزول
مع أول إقلاع بارد. الرد كان صادقًا: لا يوجد تخزين دائم مشترك.

## 2. ما تغيّر

| الملف | التغيير |
| --- | --- |
| `lib/db/durable-store.ts` (جديد) | ناقل اللقطة: مظروف مضغوط (`v: 1`, `gzip+base64`) + محوّلا `redis` (Upstash Redis REST، بصيغة الأوامر مع تراجع إلى `GET /get/<key>`) و`http` (أي نقطة `GET`/`PUT`). لا حزم جديدة: `fetch` + `node:zlib` فقط. |
| `lib/db/store.ts` | حالة دوام غنية (`mode`, `ok`, `durable`, `durableConfigured`, `error`, `at`)، و`hydrateGatewayDatabase()`، و`flushDurableStore()`، و`scheduleDurableFlush()` عبر `after()`. منع الكتابة قبل قراءة النسخة المشتركة، ورفض تحميل أي قيمة تالفة. |
| `instrumentation.ts` (جديد) | قراءة اللقطة المشتركة مرة واحدة عند إقلاع كل عملية، قبل خدمة الطلبات. فشلها لا يمنع الإقلاع. |
| `lib/sync/engine.ts` | `ensureFreshMatches` و`ensureFreshNews` تقرآن المخزن المشترك قبل المزامنة، فلا تكتب نسخة قديمة فوق بيانات أحدث. |
| `app/api/cron/update-matches/route.ts` | يقرأ اللقطة المشتركة، يزامن، ثم **ينتظر** تأكيد الكتابة. `200/status: "ok"` فقط عند `result.ok && persistence.ok && persistence.durable`؛ وإلا `503` مع `storageReason` عربي يشرح الإعداد الناقص. بلا أي ترويسة أو سر. |
| `scripts/run-sync.ts` | `npm run sync` يقرأ المخزن المشترك أولًا، ثم يكتب مرة واحدة صريحة، ويُعيد رمز خروج `2` إن لم يُثبَّت الدوام. |
| `scripts/check-store.ts` (جديد) | `npm run store:check`: فحص قراءة فقط (لا يكتب) لمتغيرات البيئة ووصول المخزن. |
| `tests/durable-store.test.ts` (جديد) | 15 اختبارًا: المظروف، رفض القيم الغريبة، كشف المخزن، تنفيذا المحوّلين ضد خوادم HTTP حقيقية، ومسارات التخزين والرد. |
| `.env.example` / `README.md` | توثيق متغيرات التخزين الدائم وحدوده. |

## 3. الإثبات (ليس ادعاءً)

`npm test` = 86 اختبارًا ناجحًا (منها 15 جديدة)، و`npm run typecheck` و`npm run lint` و`npm run build` بلا أخطاء.

ثم تشغيل حقيقي لـ `next start` (بناء إنتاج، `VERCEL=1`) مع مخزن KV وهمي على `127.0.0.1` ومصادر مزوّدين موهومة:

1. **الكرون:** `GET /api/cron/update-matches` → `HTTP 200`، `status: "ok"`،
   `persistence: { mode: "redis", ok: true, durable: true }`، و`matchesInserted: 1`.
2. **الكتابة الفعلية:** المخزن استلم لقطة واحدة بطول 24,665 حرفًا، فُكّت إلى 134,147 بايت (38 مباراة،
   6 أخبار) — أي أن الضغط خفّض الحجم إلى ~18%.
3. **مسار الصفحة لا الكرون فقط:** طلب `/` على نسخة نظيفة تسبب في مزامنة عند الطلب، ووصلت اللقطة إلى
   المخزن عبر `after()` بعد إرسال الرد (`sets: 1`) واحتوت المباراة الجديدة.
4. **الإقلاع البارد:** أُعيد ملف `data/gateway-store.json` المضمّن إلى نسخته الأصلية (**37 مباراة،
   بلا المباراة الموسومة**) ثم أُعيد تشغيل الخادم. سجّل `[instrumentation] durable_store_ready`، وردّ
   `/api/matches?date=2026-10-12` بـ `totalInStore: 38` **والمباراة الموسومة موجودة** — أي أن البيانات
   جاءت من المخزن المشترك لا من الحزمة.

الأرقام الخام في [`docs/evidence/durable-store-e2e-2026-10-14.json`](evidence/durable-store-e2e-2026-10-14.json).

اختبار سلبي أيضًا: مع `VERCEL=1` وبلا مخزن مهيأ، يعيد المسار `503` مع
`persistence.durableConfigured: false` و`storageReason` يذكر `KV_REST_API_URL`؛ وكتابة ملف محلي ناجحة
داخل lambda لا تُحتسب دوامًا.

## 4. كيف تُهيَّأ في الإنتاج

1. Vercel → المشروع → **Storage** → ربط **Upstash Redis** (تُضاف `KV_REST_API_URL` و`KV_REST_API_TOKEN`
   تلقائيًا)، أو استخدم أي نقطة HTTP: `NEMO_DURABLE_STORE_URL` (+ `NEMO_DURABLE_STORE_TOKEN`).
2. أعد النشر (تُقرأ المتغيرات عند الإقلاع فقط).
3. تحقق: `npm run store:check` محليًا بذات المتغيرات، ثم `curl -i https://<domain>/api/cron/update-matches`
   وانتظر `200` مع `persistence.durable: true`.

بدون هذه الخطوة يبقى السلوك صادقًا: `503` مع سبب واضح، ولا نجاح وهمي. لم يُنشأ أي حساب ولا اشتراك ولا
تغيير في إعدادات الاستضافة من داخل هذا المستودع؛ الخطوة 1 وحدها تحتاج صاحب الحساب.

## 5. حدود متبقية (لم تُنفَّذ عمدًا)

- **لا قفل موزع ولا معاملات:** تسابُق نسختين يُبقي «الكتابة الأخيرة تفوز». الواجهة الحالية متزامنة
  وتحتاج إعادة هيكلة قبل أي CAS/lease حقيقي.
- **لا مهاجرة بيانات تاريخية من حزمة النشر:** أول كتابة ناجحة هي التي تنقل الحالة المضمّنة إلى المخزن.
- **لا ادعاء عن حصص المزوّدين أو جدولة Vercel:** `vercel.json` لم يتغير (`0 5 * * *`)، ولا سجل إنتاج
  متاح هنا يثبت تنفيذ الجدولة، والاختبارات المحلية لا تعوّض ذلك.
- **`http` adapter يخزّن نفس المظروف المضغوط:** أي خدمة تُستخدم يجب أن تُعيد الجسم كما هو.
- **الكلفة والحدود** (حجم القيمة، الطلبات/الدقيقة) تعتمد على الخطة المختارة ويلزم التحقق منها عند الربط.
