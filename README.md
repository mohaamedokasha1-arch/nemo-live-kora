> **تدقيق 2026-10-13:** الادعاءات التاريخية أدناه عن اتصال المصادر ليست إثباتًا حاليًا.
> راجع [التقرير المقاس وحدود الإنجاز](docs/DATA-REPAIR-2026-10-13.md).
> مسارا `/api/cron/sync` و`/api/cron/sync-news` ما زالا محميين؛ أما `/api/cron/update-matches` فأصبح متاحًا دون مصادقة. لم يُنشر هذا التغيير إلى الإنتاج.
> **تغيير 2026-10-14:** صار للمخزن طبقة تخزين دائم خارجي (Redis REST أو أي نقطة HTTP)، والكرون لا يعلن النجاح إلا بعد تأكيد الكتابة فيه. التفاصيل في [docs/DURABLE-STORE-2026-10-14.md](docs/DURABLE-STORE-2026-10-14.md).

# بوابة مباريات NEMO Sports (`nemo-live-kora`)

بوابة مباريات عربية مستقلة (`RTL`) تعرض جدول كرة القدم حسب التاريخ بتوقيت القاهرة (`Africa/Cairo`)، مع **أولوية للكرة المصرية** ثم البطولات الأفريقية والعربية والأوروبية والعالمية. تُربط المباراة بصفحة NEMO Sports المباشرة فقط عند مطابقة هوية مصدرها بوجهة تم التحقق منها؛ وإلا يبقى السجل بلا رابط خارجي بدل تحويل الزائر إلى بطولة أو تاريخ عام.

---

## 1. المزايا الرئيسية

- **أولوية الكرة المصرية (`🇪🇬`)**: تصدُّر مباريات الدوري المصري الممتاز وكأس مصر وكأس الرابطة والأندية المصرية في البطولات القارية دائمًا في أعلى الجدول اليومي.
- **التوقيت والتنقل اليومي الذكي**: عرض المواعيد بتوقيت القاهرة (`Africa/Cairo`) مع أزرار **أمس / اليوم / غدًا** ومُنتقي تاريخ يحدّث المسار والـ Canonical URL (`/matches/YYYY-MM-DD`).
- **تصفية مبنية على البيانات الفعلية فقط**: قوائم تصفية حسب البطولة والدولة والبحث الفوري، مع التزام صارم بعدم إظهار أي خيار تصفية لا توجد له مباريات حقيقية في التاريخ المحدد.
- **دقة الحالة والنتيجة**:
  - عرض الحالة الفعلية من المصدر (`لم تبدأ`، `جارية`، `انتهت`، `مؤجلة`، `أُلغيت`، `متوقفة`، `غير مؤكدة أو غير متاحة من المصدر`).
  - **عدم تحويل النتيجة غير المتوفرة إلى `0-0` إطلاقًا**.
  - **عدم افتراض انتهاء المباراة من الوقت المنقضي وحده** دون تأكيد المصدر.
- **محرك أخبار تلقائي (`lib/news/`)**: جلب من Google News RSS، التحقق، منع التكرار، وحالات النشر لصفحات `/news` و`/news/[slug]`. قد تُعرض مباريات ذات صلة كنص فقط؛ لا يُرفق الخبر برابط NEMO Sports غير متحقق.
- **روابط NEMO Sports لا تُنشأ بالتخمين (`lib/nemo-resolver.ts`)**:
  1. لا تفتح بطاقة المباراة رابطًا إلا بعد تطابق معرّف مصدر موثوق، البطولة، ترتيب الفريقين، وتاريخ القاهرة مع سجل سماح موثّق؛ الرابط يذهب إلى صفحة المباراة المطابقة ومرساة `#live-stream` فقط.
  2. السجلّان الوحيدان المسموح بهما حاليًا هما الزمالك–الأهلي والقناة–المصري بتاريخ 11 أكتوبر 2026. الصفحتان المطابقتان تعرضان حاليًا «لا يوجد بث موثّق لهذه المباراة»، لذا الرابط يثبت هوية الصفحة ولا يدّعي وجود بث نشط.
  3. كل مباراة غير مطابقة تظهر كعنصر غير قابل للنقر مع «لا يوجد رابط بث مطابق موثّق»؛ لا يُستخدم `/watch` العام أو رابط بطولة أو مباراة أخرى بديلًا.
  4. الموعد لا يُعرض إلا إذا أكّد المصدر توقيت الانطلاق؛ السجلات القديمة غير المثبتة تُعامل كمواعيد غير مؤكدة.
- **تحديث المباريات عند الطلب (`ensureFreshMatches` في `lib/sync/engine.ts`)**: الصفحة الرئيسية وصفحات التواريخ و`/api/matches` تجلب SportScore + TheSportsDB إذا مرّت 10 دقائق على آخر محاولة (ناجحة أو فاشلة)، بمهلة قصيرة وطلب واحد مشترك بين الزوار المتزامنين. يُسجَّل آخر وقت محاولة وآخر نجاح ونتيجة المحاولة في `meta.lastMatchesSyncResult` وتُعرض أعلى الجدول؛ الفشل يُبقي البيانات السابقة دون حذف.
- **منع تكرار المباراة عبر المصادر (`buildMatchDedupKey`)**: المباراة نفسها الواردة من SportScore وTheSportsDB بمعرّفين مختلفين تُدمج في سجل واحد (نفس البطولة والتاريخ بالقاهرة والفريقين) مع توحيد المعرّفات الخارجية.
- **حارس الحالة القديمة (`guardStaleLiveStatus`)**: سجل «جارية» يُعرض «غير مؤكدة» إذا لم يُحدَّث منذ أكثر من 20 دقيقة، أو إذا تجاوز موعد بدايته 180 دقيقة. سجل «لم تبدأ بعد» يُعرض «بانتظار تأكيد الحالة» بعد موعد بدايته بـ15 دقيقة دون تحديث من المصدر.

---

## 2. المصادر الخمسة المعتمدة (`lib/sources/`)

| # | المصدر | المحول البرمجي | نوع البيانات | المفتاح المطلوب |
|---|---|---|---|---|
| 1 | **SportScore** | `lib/sources/sportscore.ts` | المباريات الحية، النتائج، وجداول الترتيب (`/api/widget/matches/`، `/api/v1/matches/`، `/api/v1/fixtures/?date=`، `/api/widget/standings/`) | لا يحتاج (`SPORTSCORE_SRC` اختياري للتعريف بالنفس) |
| 2 | **Football-Data.org v4** | `lib/sources/football-data.ts` | فهرس البطولات والمواسم، والمباريات والترتيب عند ضبط المفتاح | `FOOTBALL_DATA_API_KEY` (اختياري — بدونه `partial_keyless`) |
| 3 | **TheSportsDB v1** | `lib/sources/thesportsdb.ts` | جولات الدوري المصري الممتاز (`4829`)، كأس الرابطة (`5185`)، الكونفدرالية (`5057`)، وقائمة اليوم. `4830` مستبعد لأنه دوري بيسبول (KBO) | `THESPORTSDB_API_KEY` — المجاني العام `123` (و`3` تاريخيًا). المفاتيح المدفوعة ترفض `eventsround.php` بـ 404، فيسقط الكود تلقائيًا إلى `123` ثم `3` |
| 4 | **API-Football v3** | `lib/sources/api-football.ts` | fixtures + **الترتيب** + ربط معرّفات `idAPIfootball` | `API_FOOTBALL_KEY` (+ `API_FOOTBALL_HOST` لطريق RapidAPI). بدون مفتاح: `requires_api_key` |
| 5 | **Google News RSS** | `lib/sources/google-news-rss.ts` | **مصدر الأخبار الوحيد**: عناوين وناشرون حقيقيون بعد فك الروابط الوسيطة | لا يحتاج |

> **حالة الاتصال الحي لا تُدّعى هنا.** الحالة الفعلية لكل مصدر ومفتاح تُقرأ وقت التشغيل من `/api/health` وصفحة `/sources`،
> أو من `node --import tsx scripts/audit-connectivity.ts`. لا تُعدّ أي قيمة `200 OK` مكتوبة في التوثيق دليلًا على اتصال حالي.

### التخزين الدائم (`lib/storage/`)

البيانات (المباريات، الترتيب، الأخبار) تُكتب في مخزن قابل للاستبدال يُختار تلقائيًا:

1. `NEMO_STORAGE_DRIVER` إن ضُبط (`auto | turso | upstash | vercel-blob | file | memory`)
2. أول زوج مفاتيح سحابي مضبوط: `TURSO_DATABASE_URL`+`TURSO_AUTH_TOKEN` ← `UPSTASH_REDIS_REST_URL`+`UPSTASH_REDIS_REST_TOKEN` ← `BLOB_READ_WRITE_TOKEN`
3. الملف المحلي `data/gateway-store.json` (كتابة ذرّية عبر temporary + rename)

على Vercel يُبلّغ الملف المحلي عن `durable: false` لأن قرص كل lambda مؤقت، ولذلك يعيد `/api/cron/update-matches`
و`/api/health` الرمز **503** حتى يُضبط مخزن سحابي — لا يدّعي المسار نجاحًا لا يمكن قراءته.
الترحيل: `node --import tsx scripts/storage-migrate.ts --dry-run` ثم بدونها؛ الترحيل يرفض الإنهاء إذا اختلفت
أعداد القراءة عن الكتابة (`readback_mismatch`) أو وُجدت أخطاء سلامة روابط مباريات.

---

## 3. هيكل المشروع في الجذر مباشرة (`./`)

جميع ملفات المشروع موضوعة في جذر المستودع مباشرةً دون أي مجلد فرعي وسيط، لضمان عمل النشر التلقائي على Vercel فور ربط المستودع:

```text
.
├── app/
│   ├── api/
│   │   ├── cron/sync/route.ts      # نقطة المزامنة الخلفية اليدوية أو المجدولة خارجيًا
│   │   ├── cron/update-matches/route.ts # زيارته (GET/POST) تُحدِّث المباريات وترد {"status": "ok"}
│   │   ├── matches/route.ts        # واجهة JSON للمباريات والتصفية حسب التاريخ والبطولة
│   │   └── sources/route.ts        # واجهة JSON لحالة المصادر الخمسة وسجل المزامنة
│   ├── news/page.tsx               # قائمة الأخبار المحققة
│   ├── news/[slug]/page.tsx        # تفاصيل خبر؛ تُفهرس فقط مع رابط ناشر ومقتطف كافيين
│   ├── news/archive/page.tsx       # أرشيف الأخبار السابقة
│   ├── admin/news/page.tsx         # لوحة مراقبة الأخبار المحمية
│   ├── matches/[id]/page.tsx       # مسار موحّد: جدول تاريخ (/matches/YYYY-MM-DD) أو صفحة هبوط مباراة (/matches/[id])
│   ├── live/[matchId]/page.tsx     # صفحة البث الداخلية المحوَّل إليها من صفحة الهبوط (noindex, follow)
│   ├── ads.txt/route.ts            # ملف ads.txt الديناميكي لأكواد الناشرين
│   ├── about/page.tsx              # من نحن (متطلبات قبول الإعلانات)
│   ├── contact/page.tsx            # اتصل بنا
│   ├── privacy-policy/page.tsx     # سياسة الخصوصية (كوكيز وإعلانات الطرف الثالث)
│   ├── terms/page.tsx              # شروط الاستخدام
│   ├── sources/page.tsx            # لوحة الشفافية لحالة المصادر الخمسة وجدول الربط
│   ├── globals.css                 # تنسيقات RTL الفاتحة/الكلاسيكية والوضع الداكن
│   ├── layout.tsx                  # التخطيط العام والبيانات الوصفية العربية
│   ├── page.tsx                    # الصفحة الرئيسية (مباريات اليوم بتوقيت القاهرة)
│   ├── robots.ts                   # ملف robots.txt الديناميكي
│   └── sitemap.ts                  # ملف sitemap.xml الديناميكي للتواريخ غير الفارغة
├── components/
│   ├── AdSlot.tsx                  # مساحات إعلانية جاهزة بحجز ارتفاع ثابت (بدون CLS)
│   ├── FeaturedMatches.tsx         # بوابة المباريات في الصفحة الرئيسية
│   ├── LiveBroadcastView.tsx       # واجهة صفحة البث الداخلية
│   ├── MatchLandingView.tsx        # واجهة صفحة هبوط المباراة + زر التحويل للبث
│   ├── SportsEventJsonLd.tsx       # مكوّن JSON-LD المخصص لـ SportsEvent
│   ├── StreamCta.tsx               # زر التحويل الأساسي إلى /live/[match-id]
│   ├── TeamCrest.tsx               # شعار الفريق + بديل SVG موحّد
│   ├── Footer.tsx
│   ├── Header.tsx
│   ├── MatchCard.tsx
│   ├── MatchGatewayClient.tsx
│   ├── NewsSection.tsx
│   └── StandingsSection.tsx
├── data/
│   ├── matches.ts                  # ⭐ ملف المباريات المركزي (Automated Match Engine): أضف مباراة ← تُنتج كل شيء
│   └── gateway-store.json          # قاعدة البيانات الموحدة الموثقة من المصادر الخمسة
├── lib/
│   ├── matches/
│   │   ├── types.ts                # أنواع سجل المباراة والرؤية المدمجة
│   │   ├── match-links.ts          # مسارات صفحة الهبوط/البث وربط البطاقات (client-safe)
│   │   └── match-catalog.ts        # دمج الكتالوج مع المصادر + التحقق + مدخلات sitemap
│   ├── seo/
│   │   ├── sports-event.ts         # مولّد SportsEvent كامل الحقول + BreadcrumbList
│   │   ├── metadata.ts             # الوسوم المعيارية ووسوم المشاركة لكل نوع صفحة
│   │   └── match-structured-data.ts# ItemList لصفحات الجداول
│   ├── db/
│   │   ├── durable-store.ts        # نقل اللقطة إلى مخزن خارجي (Redis REST أو HTTP) + مظروف مضغوط
│   │   ├── seed-data.ts
│   │   └── store.ts
│   ├── sources/
│   │   ├── api-football.ts
│   │   ├── football-data.ts
│   │   ├── google-news-rss.ts
│   │   ├── http-client.ts
│   │   ├── sportscore.ts
│   │   └── thesportsdb.ts
│   ├── sync/
│   │   └── engine.ts
│   ├── cairo-time.ts
│   ├── catalog.ts
│   ├── nemo-resolver.ts
│   └── types.ts
├── scripts/
│   ├── check-store.ts              # فحص قراءة فقط لجاهزية التخزين الدائم (npm run store:check)
│   └── run-sync.ts
├── tests/
│   ├── durable-store.test.ts
│   ├── gateway.test.ts
│   └── update-matches.test.ts
├── .env.example
├── instrumentation.ts             # قراءة اللقطة المشتركة عند إقلاع كل عملية قبل خدمة الطلبات
├── next.config.mjs
├── package.json
└── tsconfig.json
```

---

## 4. محرّك المباريات التلقائي والبيانات المنظمة و SEO والإعلانات

كل مباراة تُضاف إلى ملف واحد فقط — `data/matches.ts` — ينتج عنها تلقائيًا:

| المخرج | المسار |
| --- | --- |
| صفحة هبوط كاملة (تفاصيل + كلمات مفتاحية + زر المشاهدة) | `/matches/[id]` |
| صفحة بث داخلية (بوابة المشاهدة + مساحات إعلانية) | `/live/[id]` |
| بيانات `SportsEvent` منظمة كاملة الحقول | داخل صفحة الهبوط |
| رابط في خريطة الموقع مع توقيت آخر تحديث | `/sitemap.xml` |
| بطاقة وروابط داخلية في الصفحة الرئيسية والجداول | `/` و`/matches/YYYY-MM-DD` |

- **البيانات المنظمة:** `location` (Place/VirtualLocation) • `description` ديناميكي فريد •
  `performer` (الفريقان) • `organizer` (البطولة) • `startDate`/`endDate` بصيغة ISO 8601 مع إزاحة
  القاهرة • `offers` (سعر `0` + `InStock` + رابط المشاهدة) • `eventStatus` بقيم Schema.org المعتمدة.
- **قاعدة صريحة:** لا يُنشر أي رابط بث قبل التحقق منه (`broadcast.status = verified_*`)،
  والحالة لا تدّعي «جارية الآن» بدون سجل مصدر — والاختبارات تفرض ذلك.
- **الوسوم المعيارية:** canonical لكل صفحة على حدة (لا canonical عام في التخطيط)،
  وصفحات البث `noindex, follow` لتجنّب تكرار المحتوى.
- **الإعلانات:** `app/ads.txt/route.ts` يُبنى تلقائيًا من `NEXT_PUBLIC_ADSENSE_CLIENT`،
  و`components/AdSlot.tsx` مساحات بحجز ارتفاع ثابت، والصفحات القانونية الأربع جاهزة
  (`/privacy-policy`, `/terms`, `/about`, `/contact`) ومربوطة في التذييل.

📘 التفاصيل الكاملة، وجدول الحقول، وخطوات التحقق قبل النشر في
[`docs/MATCH-ENGINE-AND-SEO.md`](docs/MATCH-ENGINE-AND-SEO.md).

## 5. التشغيل المحلي والاختبار والبناء

```bash
# 1. تثبيت الحزم
npm install

# 2. تشغيل المزامنة وتحديث قاعدة البيانات الموحدة
npm run sync

# 3. تشغيل الاختبارات الآلية
npm test

# 4. بناء نسخة الإنتاج للتأكد من خلو المشروع من أي أخطاء
npm run build

# 5. تشغيل خادم التطوير المحلي
npm run dev
```

---

## 6. إعدادات النشر على Vercel

- **Framework Preset**: `Next.js`
- **Root Directory**: `./` (الجذر مباشرة)
- **Build Command**: `npm run build`
- **Output Directory**: `.next` (الافتراضي لـ Next.js)
- يوجد `vercel.json` بمهمة Cron واحدة يوميًا (`0 5 * * *`) تستدعي `/api/cron/update-matches`. خطة Hobby تسمح بمهمة واحدة يوميًا فقط؛ صفحة الأخبار تحاول التحديث عند الطلب إذا مرّ 15 دقيقة على آخر محاولة مزامنة، بما فيها المحاولة الفاشلة. الصفحة الرئيسية لا تنتظر مصدر الأخبار.
- **المتغيرات البيئية** (كلها موثّقة بالعربية في `.env.example`):
  - **التخزين الدائم (مطلوب لنجاح الكرون على Vercel):** `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash Redis عبر Vercel Marketplace) أو `NEMO_DURABLE_STORE_URL` (+ `NEMO_DURABLE_STORE_TOKEN`) لأي نقطة HTTP. معها `NEMO_DURABLE_STORE` و`NEMO_DURABLE_STORE_KEY` و`NEMO_DURABLE_STORE_TIMEOUT_MS` اختيارية. الفحص: `npm run store:check`.
  - **مفاتيح المصادر:** `API_FOOTBALL_KEY` (مطلوب لـ API-Football)، `FOOTBALL_DATA_API_KEY` (اختياري)، `THESPORTSDB_API_KEY` (افتراضيًا `123`)
  - **الروابط:** `NEXT_PUBLIC_NEMO_SPORTS_URL=https://nemo-sports.vercel.app`، `GATEWAY_SITE_URL=https://nemo-live-kora.vercel.app` (Canonicals وSitemap وOpen Graph؛ يفضّل على `VERCEL_PROJECT_PRODUCTION_URL` ثم متغير التوافق `NEXT_PUBLIC_GATEWAY_URL`)
- **`CRON_SECRET` يحمي `/api/cron/sync` و`/api/cron/sync-news` ولوحة الإدارة**. اضبطه في متغيرات بيئة الاستضافة، واحتفظ به خارج GitHub ولا تستخدم بادئة `NEXT_PUBLIC_` له. مسار `/api/cron/update-matches` لا يتطلب سرًا.

---

## 7. تحديث المباريات والتحقق من التخزين

`GET` أو `POST /api/cron/update-matches` متاحان مباشرةً دون ترويسة أو مفتاح؛ كل طلب يشغّل محاولة تحديث جديدة. **لأن المسار عام، يمكن لأي جهة تكرار تشغيله واستهلاك حصص مزودي البيانات أو موارد الخادم.**

الاستجابة تتضمن `runId`, `startedAt`, `finishedAt`, `result`, `persistence` وعدّادات الجلب والإضافة والتعديل.
الفشل الكامل أو التخزين غير الدائم يُرجع 503، وليس نجاحًا عامًا. نجاح HTTP محلي لا يثبت تنفيذ الجدولة أو الإنتاج.

**طبقة التخزين الدائم:** ملف `data/gateway-store.json` داخل حزمة النشر ليس مخزنًا مشتركًا؛ لذلك يُنقل كامل
اللقطة إلى مخزن خارجي عبر `lib/db/durable-store.ts`:

- `redis` — Upstash Redis REST (`KV_REST_API_URL` / `KV_REST_API_TOKEN` أو أسماء Upstash) عبر أوامر `GET`/`SET`.
- `http` — أي نقطة (`NEMO_DURABLE_STORE_URL`) تقرأ بـ `GET` وتكتب بـ `PUT`.
- اللقطة تُضغط `gzip` وتُغلَّف في مظروف مُصدَّر (`v: 1`)؛ نحو 134KB تصبح ~24KB، وأي قيمة غريبة أو تالفة
  تُرفض (`store_snapshot_invalid`) بدلًا من تحميلها كقاعدة بيانات.

آلية الأمان والدوام:

1. عند إقلاع كل عملية (نسخة lambda) يقرأ `instrumentation.ts` أحدث لقطة مشتركة قبل خدمة أي طلب؛
   ومع كل مزامنة عند الطلب يُقرأ المخزن أولًا عبر `hydrateGatewayDatabase()`.
2. لا تُكتب اللقطة إلى المخزن الخارجي إلا بعد نجاح القراءة (`store_not_hydrated` يمنع الكتابة) حتى لا
   تستبدل نسخة قديمة مضمّنة بيانات أحدث في الإنتاج.
3. الكرون ينتظر تأكيد الكتابة (`flushDurableStore({ force: true })`)؛ بقية المسارات تكتب بعد إرسال الرد
   عبر `after()` مرة واحدة لكل دفعة تغييرات.

بهذا يعيد `GET/POST /api/cron/update-matches` الحالة `200` و`status: "ok"` فقط بعد وصول البيانات إلى
تخزين مشترك حقيقي؛ وبدون مخزن مهيأ يعيد `503` مع `persistence.durableConfigured: false` و`storageReason`
عربي يشرح الإعداد المطلوب. الجدولة القائمة لم تتغير وما زالت تستدعي تحديث المباريات فقط، والأخبار ليست مجدولة بهذا المسار.

**ما بقي غير مكتمل:** القفل الموزع ومعاملات الكتابة المتزامنة (الكتابة الأخيرة تفوز) ومراجعة الحصص والحدود
لكل مزوّد — التفاصيل والحدود في [تقرير التخزين الدائم](docs/DURABLE-STORE-2026-10-14.md).

```bash
npm run verify        # lint + typecheck + test + build + npm audit --omit=dev
npm run security      # بوابة الأمان دون شبكة (ثغرات معروفة، أسرار، حقن HTML)
npm test              # 145 اختبارًا
npm run build
npm run store:check
node --import tsx scripts/audit-connectivity.ts --out=docs/evidence/connectivity.json
node --import tsx scripts/storage-migrate.ts --dry-run
```

`scripts/audit-connectivity.ts` للقراءة فقط؛ لا يحفظ بيانات ولا يستدعي كرون الإنتاج، ويتطلب خادمًا يملك وصولًا للشبكة.
التقرير التفصيلي للإصلاح في `docs/REPAIR-FINAL-2026-10-13.md`.
