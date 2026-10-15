> **تدقيق 2026-10-13:** الادعاءات التاريخية أدناه عن اتصال المصادر ليست إثباتًا حاليًا.
> راجع [التقرير المقاس وحدود الإنجاز](docs/DATA-REPAIR-2026-10-13.md).
> مسارا `/api/cron/sync` و`/api/cron/sync-news` ما زالا محميين؛ أما `/api/cron/update-matches` فأصبح متاحًا دون مصادقة. لم يُنشر هذا التغيير إلى الإنتاج.
> **تغيير 2026-10-14 (الحالي):** أُلغي الاعتماد على أي قاعدة بيانات خارجية (Turso / Upstash / Vercel KV / Blob / HTTP). التخزين صار ملف JSON محليًا مهيكلًا بكتابة ذرّية، لا يحتاج أي إعداد، ومسارات الكرون والمزامنة تُرجع دائمًا HTTP 200 مع `ok: true`. التفاصيل في [docs/LOCAL-JSON-STORE-2026-10-14.md](docs/LOCAL-JSON-STORE-2026-10-14.md).

# بوابة مباريات NEMO Sports (`nemo-live-kora`)

> **تغيير 2026-10-14 (الشعار — النسخة النهائية):** الشعار المعروض في كل صفحات البوابة هو
> **الشعار الأصلي نفسه** المستخدم على `https://nemo-sports.vercel.app/` — منقولًا **بايتًا
> ببايت** من مستودع الموقع المرجعي `mohaamedokasha1-arch/sport` (الإصدار
> `c715149d78da995602df5b0e353318cac1deb25b`): دربان كحلي/أبيض + قُطر ذهبي `#D4AF37`،
> وبجانبهما «NEMO» فوق «SPORTS» — **بلا إعادة تصميم ولا نسخة تقريبية**.
> الملفات: `components/NemoLogo.tsx` (الهيدر 38px والفوتر 40px، نفس مقاسات المرجع) ·
> `public/nemo-logo.svg` (**769 بايت**، مطابق للأصل ببصمة git blob `265026dc…`) ·
> `public/nemo-mark.svg` (**307 بايت**، `4957b0b4…`) · `app/icon.svg` (**306 بايت**،
> `375a8323…`) · `app/apple-icon.png` (180×180 مُشتقّة من الأيقونة الأصلية). وقد حُذف
> الأصل النقطي القديم نهائيًا (2.5MB، لم يكن شعار الموقع المرجعي). التفاصيل والإثباتات في
> [docs/LOGO-REPLACEMENT-2026-10-14.md](docs/LOGO-REPLACEMENT-2026-10-14.md).
> **تغيير 2026-10-15 (الأحدث — إثبات الملكية):** أُضيف **كود Google AdSense**
> (`adsbygoogle.js?client=ca-pub-5770911159315916` مع `crossorigin="anonymous"` و`async`)
> داخل `<head>` في التخطيط الجذري ⇒ في كل صفحات الموقع، بجانبه ميتا
> `google-adsense-account` لتوثيق الحساب — يظهر في HTML المُرسل قبل أي جافاسكربت
> فورًا عند الضغط على زر «تحقق» في AdSense. يعمل افتراضيًا بلا أي إعداد بيئة،
> والمصدر الواحد `lib/ads/config.ts`، والتدقيق بعد النشر:
> `npm run audit:adsense`. التفاصيل والإثباتات في
> [docs/GOOGLE-ADSENSE-2026-10-15.md](docs/GOOGLE-ADSENSE-2026-10-15.md).
> **تغيير 2026-10-15 (الحالي — القياس):** أُضيف كود **Google Analytics 4 (gtag.js)** داخل `<head>`
> في **كل صفحات الموقع** (التخطيط العام وحده ⇒ لا صفحة تُنسى ولا نسخة مختلفة من الكود)، مع
> `dns-prefetch` لنطاقَي Google، ومع قياس **صفحات التنقّل الداخلي** (لأن Next.js يبدّل الصفحات
> بلا إعادة تحميل، فبلا ذلك تُحسب الزيارة كلها صفحةً واحدة). المعرّف `G-HH8N3QCBFV` مكتوب مرة
> واحدة في `lib/analytics/google-analytics.ts`، والإيقاف بمتغيّر بيئة واحد
> (`NEXT_PUBLIC_GA_ENABLED=off`)، والتبديل من `NEXT_PUBLIC_GA_MEASUREMENT_ID`. والإثبات المطبوع
> من HTML الإنتاج مع خطوات القبول في [docs/GOOGLE-ANALYTICS-2026-10-15.md](docs/GOOGLE-ANALYTICS-2026-10-15.md).
> **تغيير 2026-10-15 (قبلها في اليوم نفسه):** رُكّبت وحدات **Adsterra** الست في مواضعها الاستراتيجية
> (Popunder في `<head>` · Social Bar قبل `</body>` · بانر 300×250 فوق زر البث وتحته وفي جانب
> المحتوى · بانر 728×90 أعلى الصفحة على شاشات الكمبيوتر · Native Banner بين كروت المباريات ووسط
> الأخبار · Smartlink مع أزرار التحويل بوسم إعلاني صريح)، بلا أي تأثير على سرعة التحميل ولا على
> زر المشاهدة الرسمي. المفاتيح كلها في `lib/ads/adsterra.ts`، والتحكّم بمتغيّر بيئة واحد،
> والتفاصيل الكاملة في [docs/ADSTERRA-INTEGRATION-2026-10-15.md](docs/ADSTERRA-INTEGRATION-2026-10-15.md).

بوابة مباريات عربية مستقلة (`RTL`) تعرض جدول كرة القدم حسب التاريخ بتوقيت القاهرة (`Africa/Cairo`)، مع **أولوية للكرة المصرية** ثم البطولات الأفريقية والعربية والأوروبية والعالمية. كل مباراة لها صفحة تفاصيل خاصة على البوابة (`/matches/[id]`) تحمل زر مشاهدة موحّدًا يفتح **صفحة المشاهدة على منصة NEMO Sports** في تبويب جديد (`https://nemo-sports.vercel.app/watch`)، ويختار الزائر المباراة بنفسه من هناك — نظام دائم بلا كود خاص بأي مباراة، مصدره الوحيد `lib/nemo-watch.ts`، مع بانر 300×250 فوق الزر وآخر تحته وزر راعٍ مموّل بعده (وحدات Adsterra). التفاصيل في [docs/WATCH-ROUTING-2026-10-14.md](docs/WATCH-ROUTING-2026-10-14.md).

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

## 2. المصادر الستة المعتمدة (`lib/sources/`)

| # | المصدر | المحول البرمجي | نوع البيانات | المفتاح المطلوب |
|---|---|---|---|---|
| 1 | **SportScore** | `lib/sources/sportscore.ts` | المباريات الحية، النتائج، وجداول الترتيب (`/api/widget/matches/`، `/api/v1/matches/`، `/api/v1/fixtures/?date=`، `/api/widget/standings/`) | لا يحتاج (`SPORTSCORE_SRC` اختياري للتعريف بالنفس) |
| 2 | **Football-Data.org v4** | `lib/sources/football-data.ts` | فهرس البطولات والمواسم، والمباريات والترتيب عند ضبط المفتاح | `FOOTBALL_DATA_API_KEY` (اختياري — بدونه `partial_keyless`) |
| 3 | **TheSportsDB v1** | `lib/sources/thesportsdb.ts` | جولات الدوري المصري الممتاز (`4829`)، كأس الرابطة (`5185`)، الكونفدرالية (`5057`)، وقائمة اليوم. `4830` مستبعد لأنه دوري بيسبول (KBO) | `THESPORTSDB_API_KEY` — المجاني العام `123` (و`3` تاريخيًا). المفاتيح المدفوعة ترفض `eventsround.php` بـ 404، فيسقط الكود تلقائيًا إلى `123` ثم `3` |
| 4 | **API-Football v3** | `lib/sources/api-football.ts` | fixtures + **الترتيب** + ربط معرّفات `idAPIfootball` | `API_FOOTBALL_KEY` (+ `API_FOOTBALL_HOST` لطريق RapidAPI). بدون مفتاح: `requires_api_key` |
| 5 | **Google News RSS** | `lib/sources/google-news-rss.ts` | عناوين وناشرون حقيقيون بعد فك الروابط الوسيطة؛ الروابط التي لا تُفك تُرفض بصدق ولا تُنشر خامًا | لا يحتاج (استخدام شخصي حسب شروط Google — راجع `docs/evidence/source-audit-2026-10-15.json`) |
| 6 | **خلاصات الناشرين المباشرة** | `lib/sources/publisher-rss.ts` | RSS/Atom مباشر من الناشر نفسه — القائمة الافتراضية موثّقة حيًا 2026-10-15 (BBC Sport Football، The Guardian Football، اليوم السابع رياضة؛ في الجول أوقف RSS) — روابط مقالات حقيقية بلا أي وسيط، مع بوابة نطاق صارمة لكل خلاصة (تشمل النطاقات المرآة المعلنة) | لا يحتاج. `NEMO_PUBLISHER_RSS_FEEDS` لإضافة خلاصات (مفصولة بفواصل) أو `none` للتعطيل |

> **حالة الاتصال الحي لا تُدّعى هنا.** الحالة الفعلية لكل مصدر ومفتاح تُقرأ وقت التشغيل من `/api/health` وصفحة `/sources`،
> أو من `node --import tsx scripts/audit-connectivity.ts`. لا تُعدّ أي قيمة `200 OK` مكتوبة في التوثيق دليلًا على اتصال حالي.

### التخزين (ملف JSON محلي — لا يحتاج إعدادًا)

البيانات (المباريات، الترتيب، الأخبار) تُحفظ في **ملف JSON محلي مهيكل** عبر طبقة واحدة (`lib/db/durable-store.ts`
و`lib/db/atomic-file.ts`) تختار مكان الملف تلقائيًا حسب بيئة التشغيل:

1. خادم عادي / حاوية / `next start`: `data/gateway-store.json` (يبقى بعد إعادة التشغيل).
2. Vercel / Lambda / Netlify: `<os.tmpdir()>/nemo-gateway/gateway-store.json` (أي `/tmp`) — ذاكرة للنسخة الدافئة فقط.
3. `NEMO_DATA_DIR` اختياري لتغيير المجلد. لا يوجد أي متغير سحابي أو توكن مطلوب.

**الكتابة ذرّية:** يُكتب الملف المؤقت باسم فريد ثم يُفرّغ على القرص (`fsync`) ثم يستبدل الملف الأصلي عبر `rename`،
فلا يرى أي قارئ ملفًا مبتورًا. الملف التالف يُنقل جانبًا (`*.corrupt-<time>.json`) ويبدأ المخزن نظيفًا من المصدر التالي بلا تدخل يدوي.

**الدوام:** على Vercel يكون `durable: false` لأن `/tmp` خاص بكل نسخة وقد يُعاد تهيئته عند البدء البارد؛ هذا يُعلَن في الاستجابة
ولا يُحجب النجاح. أما `status: "ok"` فيعني أن المزامنة نجحت وأن اللقطة كُتبت محليًا.

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
│   ├── AdSlot.tsx                  # مساحات AdSense الجاهزة بحجز ارتفاع ثابت (بدون CLS)
│   ├── AdsterraBanner.tsx          # بانر 300×250 و728×90 داخل مستند معزول (بلا تسابق atOptions)
│   ├── AdsterraNative.tsx          # الإعلان المدمج بين كروت المباريات ووسط الأخبار
│   ├── AdsterraPopunder.tsx        # الإعلان المنبثق — وسم async في <head>
│   ├── AdsterraSocialBar.tsx       # البار الاجتماعي — lazyOnload قبل </body>
│   ├── SmartlinkCta.tsx            # زر الراعي المموّل (Smartlink) بوسم sponsored/nofollow
│   ├── FeaturedMatches.tsx         # بوابة المباريات في الصفحة الرئيسية
│   ├── GoogleAnalytics.tsx         # وسم Google Analytics (gtag.js) في أول <head> — كل الصفحات
│   ├── GoogleAnalyticsPageViews.tsx # قياس صفحات التنقّل الداخلي (page_view عند كل تنقّل)
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
│   ├── ads/
│   │   ├── adsterra.ts             # ⭐ مصدر واحد لمفاتيح Adsterra ونطاقاتها ومفاتيح الإيقاف
│   │   └── config.ts               # بوابة مساحات AdSense (لا تُرسم بلا معرّف ناشر)
│   ├── analytics/
│   │   └── google-analytics.ts     # ⭐ مصدر واحد لمعرّف GA4 ووسمه ومفتاح الإيقاف
│   ├── matches/
│   │   ├── types.ts                # أنواع سجل المباراة والرؤية المدمجة
│   │   ├── match-links.ts          # مسارات صفحة الهبوط/البث وربط البطاقات (client-safe)
│   │   └── match-catalog.ts        # دمج الكتالوج مع المصادر + التحقق + مدخلات sitemap
│   ├── seo/
│   │   ├── sports-event.ts         # مولّد SportsEvent كامل الحقول + BreadcrumbList
│   │   ├── metadata.ts             # الوسوم المعيارية ووسوم المشاركة لكل نوع صفحة
│   │   └── match-structured-data.ts# ItemList لصفحات الجداول
│   ├── db/
│   │   ├── durable-store.ts        # مسار ملف JSON المحلي وقراءته والتحقق منه
│   │   ├── atomic-file.ts          # كتابة ذرّية: temporary + fsync + rename
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
│   ├── audit-adsense.ts           # تدقيق كود AdSense في الرأس على الموقع المنشور (npm run audit:adsense)
│   ├── audit-analytics.ts          # تدقيق وسوم Google Analytics على الموقع المنشور (npm run audit:analytics)
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
- **الإعلانات (Adsterra):** ست وحدات مدمجة — Popunder في `<head>` · Social Bar قبل `</body>` ·
  بانر 300×250 فوق زر البث وتحته وأسفل جدول المباريات وفي صفحة الخبر · بانر 728×90 أعلى الصفحة
  (شاشات الكمبيوتر فقط، ولا يُنزَّل على الهاتف) · Native Banner بين كروت المباريات ووسط الأخبار ·
  Smartlink مع أزرار التحويل بوسم «إعلان» و`rel="sponsored nofollow"`.
  كل المفاتيح في `lib/ads/adsterra.ts` (مصدر واحد)، والمقاسات محجوزة سلفًا فلا إزاحة تخطيط (CLS)،
  والسكربتات `async`/`lazyOnload` فلا تعطيل للعرض، والإيقاف بمتغيّر بيئة واحد
  (`NEXT_PUBLIC_ADSTERRA_ENABLED=off` أو `NEXT_PUBLIC_ADSTERRA_DISABLED_FORMATS="popunder,socialbar"`).
  وتبقى مساحات AdSense في مواضع المحتوى: `app/ads.txt/route.ts` يُبنى تلقائيًا من
  `NEXT_PUBLIC_ADSENSE_CLIENT`، و`components/AdSlot.tsx` بحجز ارتفاع ثابت. والصفحات القانونية
  الأربع جاهزة (`/privacy-policy`, `/terms`, `/about`, `/contact`) ومربوطة في التذييل، وسياسة
  الخصوصية تذكر Adsterra صراحةً.
  التفاصيل الكاملة وقائمة التحقّق بعد النشر في
  [`docs/ADSTERRA-INTEGRATION-2026-10-15.md`](docs/ADSTERRA-INTEGRATION-2026-10-15.md).
- **التحليلات (Google Analytics 4):** كود `gtag.js` في **أول `<head>`** من التخطيط العام ⇒ في كل
  صفحات الموقع، بنفس الكود المطلوب حرفيًا (المكتبة `async` + أوامر `js`/`config`). المعرّف
  والنطاقات ونص الأوامر كلها في `lib/analytics/google-analytics.ts` (مصدر واحد)، والسكربتات
  الداخلية محكومة الصيغة (`G-[A-Z0-9]{4,32}`) فلا تُقبل قيمة تُفسد الوسم، والقياس يُرسل
  `page_view` عند كل تنقّل داخلي بلا احتساب صفحة الدخول مرتين. الإيقاف الكامل
  (`NEXT_PUBLIC_GA_ENABLED=off`) يزيل السكربتات وكل أثرها من HTML، والتبديل من
  `NEXT_PUBLIC_GA_MEASUREMENT_ID`. وكل ذلك محروس بـ 10 اختبارات في `tests/google-analytics.test.ts`،
  وبعد كل نشر يُتحقّق من الوسم على الموقع الحقيقي بأمر واحد: `npm run audit:analytics`
  (قراءة فقط، يفحص كل الصفحات ويُرجع رمز خروج `1` عند أي نقص — النتيجة محفوظة في
  `docs/evidence/analytics-2026-10-15.json`: 9/9 صفحة مطابقة).
  والتفاصيل في [`docs/GOOGLE-ANALYTICS-2026-10-15.md`](docs/GOOGLE-ANALYTICS-2026-10-15.md).
- **الإعلانات (Google AdSense — إثبات الملكية):** كود `adsbygoogle.js` بمعايرة
  `ca-pub-5770911159315916` مع `crossorigin="anonymous"` و`async` داخل `<head>` من
  التخطيط الجذري ⇒ في كل الصفحات، وميتا `google-adsense-account` بجانبه. يعمل
  افتراضيًا **بلا أي إعداد بيئة** (المصدر الواحد `lib/ads/config.ts`، وتجاوزه بـ
  `NEXT_PUBLIC_ADSENSE_CLIENT`)، ويظهر في HTML المُرسل قبل أي جافاسكربت — وهو ما
  تقرأه أداة التحقق من Google فورًا عند الضغط على زر «تحقق». محموس بـ 5 اختبارات
  في `tests/adsense-verification.test.ts`، وبعد كل نشر يُتحقّق بأمر واحد
  `npm run audit:adsense` (قراءة فقط، رمز خروج `1` عند أي نقص).
  والتفاصيل والإثباتات في [`docs/GOOGLE-ADSENSE-2026-10-15.md`](docs/GOOGLE-ADSENSE-2026-10-15.md).

📘 التفاصيل الكاملة، وجدول الحقول، وخطوات التحقق قبل النشر في
[`docs/MATCH-ENGINE-AND-SEO.md`](docs/MATCH-ENGINE-AND-SEO.md).

### 4.4) بطاقة المشاركة لكل مباراة (1200×675) — إغلاق أخطاء الصور

لكل مباراة **صورة مُولَّدة آليًا** على نطاق الموقع بمقاس 1200×675، بمجرد إضافتها إلى
`data/matches.ts` — تُنشئها `app/matches/[id]/opengraph-image.tsx`:

- تُغلق خطأ **«Missing field image»** في البيانات المنظمة نهائيًا.
- تُغلق تحذير **«Image too small»**: شعارات الفرق مربّعة وصغيرة ومُستضافة خارجيًا
  (لا تستوفي حد Google وهو 720 بكسل عرضًا)، فتُستخدم الآن داخل `SportsTeam.logo` فقط.
- الصورة نفسها تُستخدم في `openGraph.images` لصفحة الهبوط ولصفحة البث.
- الخطوط العربية بصيغة TTF في `assets/fonts/` (Satori لا يدعم WOFF)، مدموجة لتغطي
  العربية واللاتينية والأرقام معًا، ومُضمَّنة في حزمة Vercel عبر
  `outputFileTracingIncludes`.

📘 سبب كل قرار، والمصائد التقنية، وقياسات الأخطاء في
[`docs/GSC-FIXES-AND-OG-CARD-2026-10-14.md`](docs/GSC-FIXES-AND-OG-CARD-2026-10-14.md).

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
  - **التخزين:** لا يتطلب أي متغير. (`NEMO_DATA_DIR` اختياري لتغيير مجلد الملف.) الفحص: `npm run store:check`.
  - **مفاتيح المصادر:** `API_FOOTBALL_KEY` (مطلوب لـ API-Football)، `FOOTBALL_DATA_API_KEY` (اختياري)، `THESPORTSDB_API_KEY` (افتراضيًا `123`)
  - **الأخبار:** `NEMO_PUBLISHER_RSS_FEEDS` اختياري (روابط RSS/Atom إضافية للناشرين، أو `none` لتعطيل المصدر السادس)؛ `NEMO_NEWS_ENRICH=off` لتعطيل إثراء الملخصات
  - **التحليلات:** لا تحتاج أي إعداد (الوسم مفعّل بالمعرّف `G-HH8N3QCBFV`). للتبديل: `NEXT_PUBLIC_GA_MEASUREMENT_ID`، وللإيقاف الكامل: `NEXT_PUBLIC_GA_ENABLED=off`
  - **الروابط:** `NEXT_PUBLIC_NEMO_SPORTS_URL=https://nemo-sports.vercel.app`، `GATEWAY_SITE_URL=https://nemo-live-kora.vercel.app` (Canonicals وSitemap وOpen Graph؛ يفضّل على `VERCEL_PROJECT_PRODUCTION_URL` ثم متغير التوافق `NEXT_PUBLIC_GATEWAY_URL`)
- **`CRON_SECRET` يحمي `/api/cron/sync` و`/api/cron/sync-news` ولوحة الإدارة**. اضبطه في متغيرات بيئة الاستضافة، واحتفظ به خارج GitHub ولا تستخدم بادئة `NEXT_PUBLIC_` له. مسار `/api/cron/update-matches` لا يتطلب سرًا. بدونه تُرجع هذه المسارات `500 Misconfigured` ولا تنفّذ شيئًا (حماية مقصودة، لا تُفتح للعامة).

---

## 7. تحديث المباريات والتحقق من التخزين

`GET` أو `POST /api/cron/update-matches` متاحان مباشرةً دون ترويسة أو مفتاح؛ كل طلب يشغّل محاولة تحديث جديدة. **لأن المسار عام، يمكن لأي جهة تكرار تشغيله واستهلاك حصص مزودي البيانات أو موارد الخادم.**

الاستجابة تتضمن `runId`, `startedAt`, `finishedAt`, `result`, `persistence` وعدّادات الجلب والإضافة والتعديل.

**عقد الاستجابة:** `GET/POST /api/cron/update-matches` ترجع دائمًا **HTTP 200** مع `ok: true`، حتى عند فشل كل المصادر
أو تعذّر الكتابة. الحالة الحقيقية موجودة في الحقول:

- `status: "ok"` — نجحت المزامنة (`syncOk: true`) وكُتبت اللقطة محليًا.
- `status: "degraded"` — لم تُجلب بيانات جديدة أو تعذّرت الكتابة؛ السبب في `warnings` و`persistence.error`.
- `durable` — `false` على serverless (ذاكرة نسخة دافئة)، وهذا متوقع لا خطأ.

مراقبو الإتاحة يجب أن يقرأوا `status`/`syncOk` لا رمز HTTP، لأن رمز HTTP هنا يعبّر عن أن المسار استجاب فقط.

**آلية الأمان والدوام:**

1. عند إقلاع كل عملية يقرأ `instrumentation.ts` اللقطة المحفوظة قبل خدمة أي طلب؛ ومع كل مزامنة يُقرأ المخزن أولًا عبر `hydrateGatewayDatabase()`.
2. لا تُكتب اللقطة إلا بعد قراءة ناجحة للنسخة الحالية (`store_not_hydrated` يمنع الكتابة) حتى لا تستبدل نسخة قديمة بيانات أحدث.
3. مسارات الكرون والمزامنة تنتظر تأكيد الكتابة (`flushDurableStore({ force: true })`) قبل الرد.

**ما بقي غير مكتمل:** القفل وتعارض الكتابات المتزامنة بين نسخ serverless المختلفة (الكتابة الأخيرة تفوز، ولكل نسخة `/tmp` خاص)،
ومراجعة حصص المزودين. التفاصيل في [docs/LOCAL-JSON-STORE-2026-10-14.md](docs/LOCAL-JSON-STORE-2026-10-14.md).

```bash
npm run verify        # lint + typecheck + test + build + npm audit --omit=dev
npm run security      # بوابة الأمان دون شبكة (ثغرات معروفة، أسرار، حقن HTML)
npm test              # 320 اختبارًا
npm run audit:analytics   # تدقيق كود Google Analytics على الموقع المنشور (قراءة فقط، رمز خروج 1 عند أي نقص)
npm run audit:adsense     # تدقيق كود AdSense (إثبات الملكية) على الموقع المنشور (قراءة فقط، رمز خروج 1 عند أي نقص)
npm run build
npm run store:check
node --import tsx scripts/audit-connectivity.ts --out=docs/evidence/connectivity.json
node --import tsx scripts/storage-migrate.ts --dry-run
```

`scripts/audit-connectivity.ts` للقراءة فقط؛ لا يحفظ بيانات ولا يستدعي كرون الإنتاج، ويتطلب خادمًا يملك وصولًا للشبكة.
التقرير التفصيلي للإصلاح في `docs/REPAIR-FINAL-2026-10-13.md`.
