# NEMO Live Kora — تقرير الإصلاح النهائي (التخزين الدائم · المصادر · أخبار Google News · روابط المباريات)

تاريخ التقرير: 2026-10-13 (UTC)
الفرع: `arena/afe94f2f-nemo-live-kora` — نقطة البداية `f7b2440`
الحالة: **لم يُدفع ولا دُمج ولا نُشر.** كل ما يلي مُثبت بأمر نُفِّذ فعليًا في هذه الجلسة.

---

## 0. نتيجة التحقق النهائية (أرقام حقيقية من تنفيذ فعلي)

| الفحص | الأمر | النتيجة |
|---|---|---|
| الأنواع | `npx tsc --noEmit` | **نظيف — بدون أي مخرج** |
| الاختبارات | `npm test` | **146 اختبار / 146 نجاح / 0 فشل** |
| التحذيرات | `npm run lint` | **0 مشاكل (0 خطأ، 0 تحذير)** |
| البناء | `npm run build` | **نجح — بدون أي تحذير** (كان هناك تحذير Turbopack عن تتبع المشروع كاملًا؛ أُزيل) |
| الثغرات (إنتاج) | `npm audit --omit=dev` | **found 0 vulnerabilities** |
| الثغرات (كل) | `npm audit` | **5 high** — كلها في أدوات التطوير فقط، وتفاصيلها في القسم 6 |
| بوابة الأمان | `node --import tsx scripts/security-check.ts` | **ok: true، 0 findings** |
| ترحيل المخزن | `node --import tsx scripts/storage-migrate.ts --dry-run` | **dry_run_ok** — 37 مباراة، 3 جداول ترتيب، 0 أخطاء سلامة روابط |
| الاتصال الحي بالمزوّدات | `node fetch` إلى 4 نطاقات مزوّدين | **فشل — `fetch failed`** (الحجر الرملي يمنع الخروج إلى غير github/npm/pypi) |

> ما لم يُثبَت: **لم يُنفَّذ أي جلب حقيقي من SportScore أو TheSportsDB أو Football-Data أو API-Football أو Google News من هذه البيئة**، لأن الخروج الشبكي محجوب. الاختبارات تُثبت منطق الربط والتحليل والتخزين مقابل استجابات مُصطنعة مطابقة للأشكال الموثّقة، ولا تُغني عن تشغيل `npm run security` + `scripts/audit-connectivity.ts` مرة واحدة على خادم يملك وصولًا للشبكة.

---

## 1. التخزين الدائم — إزالة الاعتماد على الذاكرة المؤقتة

### المشكلة كما كانت
`lib/db/store.ts` كان يحتفظ بقاعدة البيانات في متغيّر داخل الذاكرة، ويكتب ملف JSON محليًا بشكل غير ذرّي وبدون قراءة تحقق. على Vercel كل دالة lambda لها قرص مؤقت خاص، فالمزامنة تضيع بين الطلبات وبين النشر وإعادة التشغيل.

### ما نُفِّذ
طبقة تخزين قابلة للاستبدال في `lib/storage/`:

| الملف | الدور |
|---|---|
| `types.ts` | `StorageDriver` + `GatewayDatabase` shape guard (`isGatewayDatabaseShape`) |
| `file-driver.ts` | كتابة ذرّية (temporary + `rename`)، قراءة مع تحقق، تصريح دوام |
| `turso-driver.ts` | Turso/libSQL عبر HTTP: إنشاء الجداول، `ON CONFLICT(id) DO UPDATE`، جداول مرآة `gateway_matches` / `gateway_news` / `gateway_standings` |
| `upstash-driver.ts` | Upstash Redis / Vercel KV عبر REST مع `/ping` |
| `vercel-blob-driver.ts` | Vercel Blob (put/list/get) |
| `index.ts` | `selectStorageDriver()` + `describeStorage()` |

ترتيب الاختيار: `NEMO_STORAGE_DRIVER` (إن ضُبط) ← أول زوج مفاتيح سحابي مضبوط ← الملف المحلي.

**حماية جوهرية:** على Vercel يُبلّغ الملف المحلي عن `durable: false`، لأن القرص مؤقت. ولذلك:
- `/api/cron/update-matches` يعيد **503** ما لم تثبت كتابة ← قراءة (`verifyStorageRoundTrip`) — لا يدّعي نجاحًا لا يمكن قراءته.

> **قرار مدموج من `main` (PR #13):** `/api/cron/update-matches` **عام بدون سر** — أي طلب `GET`/`POST` يشغّل محاولة مزامنة.
> `CRON_SECRET` ما زال يحمي `/api/cron/sync` و`/api/cron/sync-news` ولوحة الإدارة. أُبقي هذا القرار كما هو عند دمج `main`،
> وأُضيفت فوقه بوابة دوام التخزين فقط. الثمن المعلوم: يمكن لأي جهة تكرار استدعاء المسار واستهلاك حصص المزوّدين،
> والنافذة الزمنية للتحديث داخل المحرّك هي ما يحدّ من إعادة الجلب الفعلية.
- `/api/health` يعيد الحالة نفسها للتشغيل والمراقبة.
- `/sources` يعرض المخزن الفعلي وحالة آخر كتابة وعبارة صريحة بما يلزم ضبطه.

الترحيل: `scripts/storage-migrate.ts` يقرأ `data/gateway-store.json`، يمرّره عبر `migrateGatewayDatabase`، **يرفض الترحيل إذا كانت هناك أخطاء سلامة روابط** (`auditMatchLinkIntegrity`)، يكتب، ثم **يقرأ ما كتبه ويقارن الأعداد** ويرفض إنهاء العملية عند أي اختلاف (`readback_mismatch`). يدعم `--dry-run` و `--force` و `--from=`.

### المتغيرات
`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (أو `LIBSQL_URL` + `LIBSQL_AUTH_TOKEN`) — الخيار الموصى به.
بدائل: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (أو `KV_REST_API_URL` + `KV_REST_API_TOKEN`)، أو `BLOB_READ_WRITE_TOKEN`.
ضبط: `NEMO_STORAGE_DRIVER`، `NEMO_DATA_DIR`، `NEMO_STORAGE_FILE_DURABLE`، `NEMO_GATEWAY_STORE_PERSIST`.

---

## 2. المصادر الأربعة للمباريات — حالة كل مفتاح وكل نقطة نهاية

المفاتيح تُقرأ عبر `lib/config/env.ts` الذي يزيل المسافات وعلامات الاقتباس ويعتبر القيم الوهمية (`your_api_key`, `changeme`, `xxx`…) **غير مضبوطة** بدل تمريرها للمزوّد. حالة كل مفتاح: `missing | configured | placeholder`.

| المصدر | المفتاح | ملاحظات مُثبتة |
|---|---|---|
| **SportScore** | لا يحتاج | `SPORTSCORE_BASE_URL` هو **أصل الموقع فقط** (`https://sportscore.com`) وليس مسار `/api/widget`. كانت المسارات تُبنى بشكل مضاعف؛ أُصلحت. تُبنى الآن: `/api/widget/matches/?sport=football&limit=50&src=nemo-live-kora`، `/api/v1/matches/`، `/api/v1/fixtures/?sport=football&date=<YYYY-MM-DD>`، `/api/widget/standings/?sport=football&slug=<slug>`، مع `?src=` اختياري عبر `SPORTSCORE_SRC` |
| **TheSportsDB** | `THESPORTSDB_API_KEY` (المجاني العام `123`، و`3` يعمل تاريخيًا) | **مُثبت من وثائق المزوّد:** v1 يضع المفتاح في المسار، وv2 (`X-API-KEY`) **للمشتركين المدفوعين فقط**، و`eventsround.php` يعيد **404 للمفاتيح المدفوعة**. لذلك أُضيف تسلسل مفاتيح (`thesportsdbKeyCandidates`) يسقط تلقائيًا إلى `123` ثم `3` عند رفض المفتاح، مع تسجيل المحاولات مُقنّعة |
| **Football-Data.org v4** | `FOOTBALL_DATA_API_KEY` | `/v4/competitions` يعمل بلا مفتاح؛ `/v4/matches` و `/v4/competitions/{code}/standings` تحتاج مفتاحًا. بدون مفتاح: `partial_keyless` مع رسالة عربية صريحة بدل نجاح كاذب |
| **API-Football v3** | `API_FOOTBALL_KEY` (+ `API_FOOTBALL_HOST` لطريق RapidAPI) | الترويسة `x-apisports-key` للنقل المباشر، و`x-rapidapi-key` + `x-rapidapi-host` لطريق RapidAPI. أُضيف جلب **الترتيب** (`fetchApiFootballStandings`) بعد أن كان يُجلب fixtures فقط. **معرّف الدوري المصري `302` غير مُثبت من المزوّد** (مصدره مزوّد مختلف)، ولذلك هو قابل للتجاوز بـ `API_FOOTBALL_EGYPT_LEAGUE_ID` |

`scripts/audit-connectivity.ts` أُعيدت كتابته: يفحص 6 مسارات (منها `/api/v1/fixtures/` و Google News)، ويطبع حالة المفاتيح والمخزن وعدد الروابط الوسيطة التي حُلَّت، ويكتب ملف دليل عبر `--out=`، ويعيد رمز خروج غير صفري إذا لم ينجح أي مصدر مباريات أو لم ينجح مصدر الأخبار.

---

## 3. Google News RSS — من «0 أخبار منشورة» إلى روابط ناشرين حقيقية

### سبب العطل
روابط الخلاصة وسيطة (`news.google.com/rss/articles/…`)، ومرشّح الصحة كان يرفضها باعتبارها ليست رابط ناشر. وطريقة «اتبع إعادة التوجيه» **لم تعد تعمل**: Google يعيد صفحة JavaScript/موافقة برمز 200 بدل 302.

### الحل المنفَّذ (أربع استراتيجيات متتالية، بلا نسخ للمقالات)
1. **فك محلي بدون شبكة** للرموز القديمة `CBMi…`: base64url ثم إزالة البادئة `\x08\x13"` ثم قراءة النص بطول مسبوق، مع قصّ عند `\xd2\x01\x00`.
2. **`batchexecute`** للرموز المعتمة الحديثة (`AU_yqL…`): `POST https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je` بجسم `f.req` مُرمَّز، ثم البحث العودي في الاستجابة عن سلسلة تُحلَّل إلى مصفوفة عنصرها `[1]` رابط `http(s)`. **طلب واحد فقط لكل رابط.**
3. **قفزة 302 واحدة** عند توفّرها.
4. **صفحة HTML وسيطة**: استخراج `data-n-au` أو `window.location.replace`.

**ضمانات ضد الأخطاء القديمة:**
- الرابط الناتج **يُتحقق من نطاقه مقابل ناشر العنصر** (`samePublisherHost` على `registrableDomain`)، فلا يُنشر رابط Google أو منصة تواصل بدل الناشر.
- العنوان الذي هو نتيجة مباراة فقط (`الأهلي 2-0 الزمالك`) يُرفض برمز `match_score_only` ولا يُنشر كخبر.
- الفهرسة تتطلب **ملخصًا ≥ 160 حرفًا** ورابطًا أصليًا غير Google؛ الملخص يُستخرج من صفحة الناشر (`og:description` ثم الفقرات) عبر `lib/news/article-enrichment.ts` عند `NEMO_NEWS_ENRICH=on`.
- فشل المزامنة **لا يمحو الأخبار المنشورة سابقًا**، ويُخزَّن سبب الفشل بالعربية مع تقرير الحلّ (كم رابطًا حُوِّل، كم نجح، بأي استراتيجية).

---

## 4. روابط المباريات — لا زائر يُوجَّه إلى مباراة قديمة

`lib/match-identity.ts`:
- `getStableMatchId` يبني الهوية من معرّف المزوّد الموثوق (API-Football أولًا)، ويربط معرّفات TheSportsDB بها (`2561121 → match-api-football-1612250`).
- `buildMatchDedupKey` يشترط **الموسم + وقت بداية مؤكد + ترتيب الفريقين** — فلا تُدمج نسختان لمجرد تشابه الاسم، ولا يُدمج وقت غير مؤكد بالتخمين.
- `lib/nemo-resolver.ts` يحتفظ بجدول تحقق (`VERIFIED_NEMO_MAPPING_TABLE`)؛ **المعرّف وحده لا يكفي** — يجب تطابق التاريخ والفريقين والبطولة.

**`auditMatchLinkIntegrity`** (مُضاف) يفحص كل سجل مباراة ويبلّغ عن: رابط مخزّن لا يطابق تاريخ/فريق/بطولة المباراة (`link_date_mismatch`)، مباراة قادمة قديمة (`stale_upcoming`)، مباراة جارية خارج النافذة الزمنية (`live_outside_window`)، هوية مكررة (`duplicate_identity`)، ومعرّف مزوّد مفقود (`missing_provider_id`). `blockingLinkIssues` يعيد ما يمنع النشر فقط.

**نتيجة الفحص على المخزن الملتزم فعليًا:** 37 مباراة مفحوصة، 2 مرتبطة (`zamalek-sc-vs-al-ahly-fc` / `olympic-el-qanal-vs-al-masry`)، **0 أخطاء تمنع النشر**. الباقي يُظهر «لا يوجد رابط بث مطابق موثّق» بدل تخمين رابط.

---

## 5. الاختبارات (146 اختبارًا)

| الملف | العدد | ماذا يُثبت |
|---|---|---|
| `tests/persistent-storage.test.ts` | 25 | كتابة/قراءة ذرّية، عدم بقاء ملفات `.tmp`، جداول Turso ومنع الحذف الجماعي، عدم تسريب التوكن، رفض الحمولة التالفة، إظهار 401، Upstash/Blob، ترتيب اختيار المخزن، `describeStorage` بلا سر، الترطيب من `data/gateway-store.json` |
| `tests/google-news-resolver.test.ts` | 9 | فك `CBMi` محليًا، `AU_yqL` → `opaque_token`، معاملات `batchexecute` وتحليل الاستجابة، قفزة 302، رفض وجهات Google/التواصل، `registrableDomain`، `match_score_only` |
| `tests/source-endpoints.test.ts` | 18 | حالات المفاتيح، قناع السر (`abcdef123456789` → `abc*789`)، مسارات TheSportsDB وعدم طلب `id=4830`، السقوط من مفتاح مدفوع مرفوض، مسارات SportScore بلا تضاعف، ترويسات API-Football المباشرة وRapidAPI، `apiFootballSeasonFor`، Football-Data بلا مفتاح ومع مفتاح |
| `tests/match-identity-links.test.ts` | 15 | الزمالك/الأهلي والقناة/المصري، تميّز معرّفات الجولة 6، الموسم الجديد → معرّف جديد، رفض التطابق الجزئي، تدقيق المخزن الملتزم |
| `tests/news-live-pipeline.test.ts` | 6 | **من طرف لطرف**: خلاصة RSS مُصطنعة → `runNewsSync` ينشر أخبارًا بروابط ناشرين وملخصات ≥160 حرفًا، يرفض النتيجة المجرّدة، ينجو من إعادة تشغيل باردة عبر المخزن، ويحفظ الأخبار السابقة عند فشل الشبكة |
| اختبارات سابقة | 72 | محرّك المباريات والأخبار و SEO والعرض |

**درس تقني موثّق:** لا تضع `assert` داخل جسم `fetch` مُستنسخ — الاستثناء يرفض الوعد، و`try/catch` في كود الإنتاج يحوّله إلى نتيجة فارغة فيبدو العطل وكأنه في المُحلِّل.

---

## 6. الاعتماديات والثغرات

`npm audit --omit=dev` = **0 ثغرات**. `npm audit` (الكامل) = **5 high**، وكلها في سلسلة أدوات التطوير فقط:

```
eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces
```

- الاستشارة `GHSA-vfj7-8cjw-p6xm` (CVE-2026-93687): `braces <= 3.0.3`، **`first_patched_version: null`** — أي **لا توجد نسخة مُصلحة منشورة** (آخر إصدار على registry هو `3.0.3`). رُوجِع ذلك مباشرة عبر `api.github.com/advisories/GHSA-vfj7-8cjw-p6xm`.
- `npm audit fix --force` **لا يُصلح شيئًا**: يقترح تنزيل `eslint-config-next` إلى `14.2.35` (كسر توافق) ويبقى `braces` كما هو. لذلك **لم يُنفَّذ**.
- **إثبات أن الإنتاج غير متأثر:** `braces`/`micromatch`/`fast-glob` ليست ضمن `dependencies` (الإنتاجية: `@fontsource/cairo`, `next`, `react`, `react-dom`)، ولا يظهر أي منها في أي ملف `.js` داخل `.next` (الوحيدة المطابقة كانت نص تحذير داخلي في Next داخل خريطة مصدر، لا كود المكتبة).
- **الإجراء المتخذ:** تثبيت السلسلة عبر `overrides` (`braces 3.0.3`, `micromatch 4.0.8`, `fast-glob 3.3.1`) لمنع أي تنزيل عرضي ولجعل الشجرة قابلة للتكرار، وبوابة `scripts/security-check.ts` تفشل إذا ظهر أي منها في شجرة الإنتاج أو إذا نزل التثبيت عن نسخة مُصلحة. الحالة مُبلَّغة كتحذير صريح: `no_upstream_fix_available`.

---

## 7. أوامر التشغيل

```bash
npm run verify        # lint + typecheck + test + build + audit:prod
npm run security      # audit:prod + بوابة الأمان دون شبكة
npm run audit:prod    # ثغرات الإنتاج فقط (يفشل عند أي ثغرة)
npm run audit:all     # كل الثغرات بما فيها أدوات التطوير

# ترحيل المخزن إلى قاعدة سحابية (بعد ضبط TURSO_*)
node --import tsx scripts/storage-migrate.ts --dry-run
TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… node --import tsx scripts/storage-migrate.ts

# فحص حي للمصادر (يتطلب خادمًا يملك وصولًا للشبكة)
node --import tsx scripts/audit-connectivity.ts --out=docs/evidence/connectivity.json
```

كل المتغيرات موثّقة بالعربية في `.env.example`، مقسّمة إلى: التخزين الدائم، روابط الموقع، المصادر الخمسة، حماية الكرون، و SEO/الإعلانات.

---

## 8. ما تبقى مفتوحًا بصراحة

1. **تشغيل حي واحد على خادم يملك شبكة** لتشغيل `scripts/audit-connectivity.ts` وتأكيد `matchesFetched > 0` و`resolved > 0` بأرقام حقيقية، ثم حفظ المخرج في `docs/evidence/`.
2. **تأكيد معرّف الدوري المصري لدى API-Football** (`API_FOOTBALL_EGYPT_LEAGUE_ID`) من حساب حقيقي — القيمة الحالية `302` غير مُثبتة من هذا المزوّد.
3. **ضبط مخزن سحابي على Vercel** (`TURSO_*`). بدونه يعيد `/api/cron/update-matches` و`/api/health` **503** عن قصد — وهذا سلوك مطلوب لا عطل.
4. `braces` بلا إصلاح من المصدر؛ يُعاد الفحص عند صدور نسخة.
