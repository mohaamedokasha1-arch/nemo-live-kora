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
- **محرك أخبار تلقائي (`lib/news/`)**: جلب من Google News RSS، التحقق، منع التكرار، حالات النشر، صفحات `/news` و`/news/[slug]`، وربط اختياري بصفحات NEMO Sports عند وجود مطابقة.
- **نظام هوية وروابط موثق (`lib/nemo-resolver.ts`)**:
  1. يفضّل معرّف المباراة الحقيقي من المصدر، ويحوّله إلى معرّف ثابت (`lib/match-identity.ts`) لا يتغير عند تحديث تاريخ المباراة.
  2. يوجّه مباشرة إلى `/matches/[slug]` فقط عند وجود معرّف مصدر متطابق وصفحة مباراة اختُبرت على الموقع المنشور (القناة–المصري، الزمالك–الأهلي في سجل التحقق الحالي).
  3. لا يستخدم slug وصفيًا وحده، ولا صفحة بطولة أو جدولًا عامًا كبديل لمباراة غير متاحة؛ البطاقة تبقى غير قابلة للنقر وتوضح عدم توفر صفحة مطابقة.

---

## 2. المصادر الخمسة المعتمدة (`lib/sources/`)

| # | المصدر | المحول البرمجي | نوع البيانات | الحالة |
|---|---|---|---|---|
| 1 | **SportScore** | `lib/sources/sportscore.ts` | المباريات الحية، النتائج، الأحداث، التشكيلات، وجداول الترتيب | مفعّل بالكامل بدون مفتاح (`200 OK`) |
| 2 | **Football-Data.org v4** | `lib/sources/football-data.ts` | فهرس 190 بطولة والمواسم الحالية (ومباريات الدوريات الأوروبية عند ضبط `FOOTBALL_DATA_API_KEY`) | مفعّل بدون مفتاح لمسار `/v4/competitions` (`200 OK`) |
| 3 | **TheSportsDB v1** | `lib/sources/thesportsdb.ts` | جدول مباريات الدوري المصري الممتاز (`4829`)، كأس الرابطة المصرية (`5185`)، الكونفدرالية (`5057`)، ودوري روشن (`4668`) | مفعّل بالكامل بالمفتاح العام المجاني `3` (`200 OK`) |
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
│   ├── matches/[date]/page.tsx     # صفحة جدول مباريات تاريخ محدد (/matches/YYYY-MM-DD)
│   ├── sources/page.tsx            # لوحة الشفافية لحالة المصادر الخمسة وجدول الربط
│   ├── globals.css                 # تنسيقات RTL الفاتحة/الكلاسيكية والوضع الداكن
│   ├── layout.tsx                  # التخطيط العام والبيانات الوصفية العربية
│   ├── page.tsx                    # الصفحة الرئيسية (مباريات اليوم بتوقيت القاهرة)
│   ├── robots.ts                   # ملف robots.txt الديناميكي
│   └── sitemap.ts                  # ملف sitemap.xml الديناميكي للتواريخ غير الفارغة
├── components/
│   ├── Footer.tsx
│   ├── Header.tsx
│   ├── MatchCard.tsx
│   ├── MatchGatewayClient.tsx
│   ├── NewsSection.tsx
│   └── StandingsSection.tsx
├── data/
│   └── gateway-store.json          # قاعدة البيانات الموحدة الموثقة من المصادر الخمسة
├── lib/
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

## 4. التشغيل المحلي والاختبار والبناء

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

## 5. إعدادات النشر على Vercel

- **Framework Preset**: `Next.js`
- **Root Directory**: `./` (الجذر مباشرة)
- **Build Command**: `npm run build`
- **Output Directory**: `.next` (الافتراضي لـ Next.js)
- يوجد `vercel.json` بمهمة Cron واحدة يوميًا (`0 5 * * *`) تستدعي `/api/cron/update-matches`. خطة Hobby تسمح بمهمة واحدة يوميًا فقط؛ صفحة الأخبار تحاول التحديث عند الطلب إذا مرّ 15 دقيقة على آخر محاولة مزامنة، بما فيها المحاولة الفاشلة. الصفحة الرئيسية لا تنتظر مصدر الأخبار.
- **المتغيرات البيئية الاختيارية** (انظر `.env.example`):
  - `NEXT_PUBLIC_NEMO_SPORTS_URL=https://nemo-sports.vercel.app`
  - `GATEWAY_SITE_URL=https://nemo-live-kora-matchat.vercel.app` (Canonicals وSitemap وOpen Graph؛ يفضّل على `VERCEL_PROJECT_PRODUCTION_URL` ثم متغير التوافق `NEXT_PUBLIC_GATEWAY_URL`)
  - `FOOTBALL_DATA_API_KEY` (اختياري لتفعيل مسار المباريات في Football-Data.org)
  - `API_FOOTBALL_KEY` (اختياري لتفعيل الجلب المباشر من API-Football)
- **`CRON_SECRET` مطلوب لتشغيل `/api/cron/update-matches`**، ويُستخدم أيضًا لحماية `/api/cron/sync`. اضبطه في متغيرات بيئة الاستضافة، ثم أعد النشر. احتفظ به خارج GitHub ولا تستخدم بادئة `NEXT_PUBLIC_` له.

---

## 6. API تحديث المباريات يدويًا أو عبر مجدول خارجي

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
