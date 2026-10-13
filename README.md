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

| # | المصدر | المحول البرمجي | نوع البيانات | الحالة |
|---|---|---|---|---|
| 1 | **SportScore** | `lib/sources/sportscore.ts` | المباريات الحية، النتائج، الأحداث، التشكيلات، وجداول الترتيب | مفعّل بالكامل بدون مفتاح (`200 OK`) |
| 2 | **Football-Data.org v4** | `lib/sources/football-data.ts` | فهرس 190 بطولة والمواسم الحالية (ومباريات الدوريات الأوروبية عند ضبط `FOOTBALL_DATA_API_KEY`) | مفعّل بدون مفتاح لمسار `/v4/competitions` (`200 OK`) |
| 3 | **TheSportsDB v1** | `lib/sources/thesportsdb.ts` | المباريات القادمة وآخر النتائج تلقائيًا (`eventsnextleague` / `eventspastleague`) للدوري المصري الممتاز (`4829`، عبر `eventsround` جولة بجولة)، كأس الرابطة (`5185`)، الكونفدرالية (`5057`) + قائمة اليوم (`eventsday`). كأس مصر (`4830`) مستبعد لأنه في TheSportsDB دوري بيسبول كوري (KBO) | المفتاح العام المجاني `3`؛ كل نقطة نهاية تُسجَّل بنتيجتها في سجل المزامنة |
| 4 | **API-Football v3** | `lib/sources/api-football.ts` | ربط معرّفات `idAPIfootball` وإثراء النتائج المباشرة عند ضبط `API_FOOTBALL_KEY` | جاهز ومختبر على `/status` (`200 OK`) |
| 5 | **Google News RSS** | `lib/sources/google-news-rss.ts` | **مصدر الأخبار الوحيد بين الخمسة**: عناوين RSS مع الناشر الأصلي وتاريخ النشر الحقيقي | يُنشر الخبر فقط بعد التحقق ومنع التكرار؛ لا تُعرض بيانات بذرية |

---

## 3. هيكل المشروع في الجذر مباشرة (`./`)

جميع ملفات المشروع موضوعة في جذر المستودع مباشرةً دون أي مجلد فرعي وسيط، لضمان عمل النشر التلقائي على Vercel فور ربط المستودع:

```text
.
├── app/
│   ├── api/
│   │   ├── cron/sync/route.ts      # نقطة المزامنة الخلفية اليدوية أو المجدولة خارجيًا
│   │   ├── cron/update-matches/route.ts # API تحديث المباريات المحمي بـ CRON_SECRET (GET/POST)
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
│   └── run-sync.ts
├── tests/
│   ├── gateway.test.ts
│   └── update-matches.test.ts
├── .env.example
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
- **المتغيرات البيئية الاختيارية** (انظر `.env.example`):
  - `NEXT_PUBLIC_NEMO_SPORTS_URL=https://nemo-sports.vercel.app`
  - `GATEWAY_SITE_URL=https://nemo-live-kora.vercel.app` (Canonicals وSitemap وOpen Graph؛ يفضّل على `VERCEL_PROJECT_PRODUCTION_URL` ثم متغير التوافق `NEXT_PUBLIC_GATEWAY_URL`)
  - `FOOTBALL_DATA_API_KEY` (اختياري لتفعيل مسار المباريات في Football-Data.org)
  - `API_FOOTBALL_KEY` (اختياري لتفعيل الجلب المباشر من API-Football)
- **`CRON_SECRET` مطلوب لتشغيل `/api/cron/update-matches`**، ويُستخدم أيضًا لحماية `/api/cron/sync`. اضبطه في متغيرات بيئة الاستضافة، ثم أعد النشر. احتفظ به خارج GitHub ولا تستخدم بادئة `NEXT_PUBLIC_` له.

---

## 7. API تحديث المباريات يدويًا أو عبر مجدول خارجي

**الملف:** `app/api/cron/update-matches/route.ts` — **المسار:** `/api/cron/update-matches`

| العنصر | التفاصيل |
| --- | --- |
| الطريقة | `GET` و `POST` للتشغيل اليدوي أو عبر مجدول خارجي |
| الحماية | `Authorization: Bearer ${process.env.CRON_SECRET}` |
| عند غياب ترويسة التفويض أو إرسال سر غير صحيح | `401 Unauthorized` |
| عند عدم ضبط `CRON_SECRET` على الخادم | `500` (خطأ إعدادات؛ يظل المسار مغلقًا) |
| وظيفة التحديث | `runMatchesUpdatePipeline()` في `lib/sync/engine.ts` (Database Pipeline) |
| الأنماط | `live` (الافتراضي)، `daily`، `standings`، `manual`؛ عبر `?mode=` أو جسم JSON في `POST` |
| الجدولة | Cron يومي على Vercel (`0 5 * * *`) بالإضافة إلى الاستدعاء اليدوي أو من مجدول خارجي |

مثال استجابة ناجحة:

```json
{
  "ok": true,
  "success": true,
  "messageAr": "تم تحديث المباريات بنجاح — 24 مباراة محدَّثة.",
  "updatedMatches": 24,
  "matchesAdded": 3,
  "matchesChanged": 21,
  "matchesProcessed": 38,
  "totalMatches": 512,
  "standingsUpdated": 0,
  "newsUpdated": 6,
  "mode": "live",
  "durationMs": 8420
}
```

### تشغيله يدويًا

```bash
curl --fail-with-body -X GET "https://<your-project>.vercel.app/api/cron/update-matches" \
  -H "Authorization: Bearer $CRON_SECRET"

# أو مع تحديد نمط التحديث: live (الافتراضي) | daily | standings | manual
curl --fail-with-body -X POST "https://<your-project>.vercel.app/api/cron/update-matches?mode=daily" \
  -H "Authorization: Bearer $CRON_SECRET"

# أو تحديد النمط في جسم JSON
curl --fail-with-body -X POST "https://<your-project>.vercel.app/api/cron/update-matches" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  --data '{"mode":"daily"}'
```

اضبط `CRON_SECRET` في بيئة الطرف الذي ينفذ `curl` بنفس قيمة السر على الخادم، واستبدل `<your-project>` باسم مشروعك.

### الاستدعاء من مجدول خارجي لاحقًا

- استخدم الرابط نفسه مع `GET` أو `POST`، وأضف الترويسة `Authorization: Bearer <CRON_SECRET>` صراحةً؛ لا تضيفها Vercel تلقائيًا للطلبات الخارجية.
- احفظ السر في مخزن الأسرار الخاص بالمجدول (مثل GitHub Actions Secrets)، وليس في ملف داخل المستودع أو ضمن رابط الطلب.
- اختر وتيرة مناسبة لحدود استدعاء الوظائف ومصادر البيانات. خطة Hobby تسمح بمهمة Cron واحدة يوميًا.
- مسار `/api/cron/sync-news` يزامن الأخبار فقط وهو محمي بنفس السر. لوحة `/admin/news` تعرض حالة المصادر والأخبار للمصرّح لهم.

> **ملاحظة التخزين:** يستخدم المشروع حاليًا ملف JSON مع ذاكرة مؤقتة. على Vercel، كتابة الملف ليست تخزينًا دائمًا، وقد لا تكون التحديثات مشتركة بين مثيلات الوظائف. صفحات الأخبار تحاول الجلب الحي عند الحاجة إذا تجاوز عمر آخر نجاح 15 دقيقة. للتحديثات الدائمة في الإنتاج يُفضَّل مخزن بيانات خارجي.
