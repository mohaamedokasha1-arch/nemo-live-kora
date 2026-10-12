# تقرير الفحص والإصلاح — بوابة المباريات (12 أكتوبر 2026)

> النطاق: مستودع البوابة `nemo-live-kora` فقط. مستودع الموقع الأساسي (`sport` / nemo-sports.vercel.app) قُرئ للاستكشاف فقط ولم يُعدَّل. لم يُنشر ولم يُدمج أي شيء.

## قيود بيئة الفحص (مهم)

بيئة التنفيذ لا تملك اتصالًا خارجيًا إلا بـ GitHub/npm. لذلك:

- **لم يكن ممكنًا** طلب `nemo-sports.vercel.app` أو `nemo-live-kora-matchat.vercel.app` أو SportScore أو TheSportsDB عبر HTTP من هذه البيئة.
- تم بدلًا من ذلك فحص **الكود المصدري الفعلي** للموقع الأساسي (مستودع `mohaamedokasha1-arch/sport`، فرع `main`، آخر دفع 2026-10-12 17:17 UTC) لتحديد بنية المسارات ومعرّف المباراة وقسم البث، وفحص البوابة محليًا ببناء إنتاجي (`next build` + `next start`) واختبار صفحاتها وروابطها وJSON الناتج.
- بناءً على القاعدة «لا تعتبر الربط ناجحًا إلا بعد اختبار وصول مباراة حقيقية»: **الربط مُصنَّف "مكتمل برمجيًا، بانتظار تحقق HTTP واحد من بيئة متصلة"** (خطوة التحقق موصوفة أدناه وتستغرق دقيقة).

---

## 1. المشكلات المؤكدة قبل الإصلاح

| # | المشكلة | الدليل |
|---|---|---|
| 1 | زر المباراة كان يفتح **صفحة تفاصيل** `/matches/{slug}` بلا الوصول لقسم البث | `lib/nemo-resolver.ts` القديم: `url: ${NEMO}/matches/${slug}` بدون مرساة |
| 2 | **مباراتان فقط** من 37 كان لهما رابط (الزمالك–الأهلي، القناة–المصري) رغم أن 15 سجلًا يحمل slug حقيقيًا من SportScore | جدول allowlist يدوي `VERIFIED_NEMO_MAPPING_TABLE`؛ أي مباراة خارجه = «لا توجد صفحة مطابقة» |
| 3 | جلب الدوري المصري من TheSportsDB كان **بأرقام جولات ثابتة** (`eventsround.php?...&r=6`, `r=7`) ⇒ يتوقف التحديث تلقائيًا بعد الجولة 7 | `lib/sources/thesportsdb.ts` القديم |
| 4 | **لا يوجد تحديث للمباريات عند الطلب**؛ الاعتماد على Cron واحد يوميًا 05:00 UTC، وعلى Vercel يبدأ كل مثيل من ملف JSON الملتزم به ⇒ الإنتاج شبه ثابت | `vercel.json` + `lib/db/store.ts` (ملف JSON في الذاكرة) |
| 5 | **تكرار محتمل عبر المصادر**: الـ upsert بالمعرّف فقط؛ المباراة نفسها من SportScore (`match-sportscore-*`) وTheSportsDB (`match-thesportsdb-*`) تُخزَّن مرتين إن لم تكن في الجدول اليدوي | `upsertMatchesInStore` القديم |
| 6 | سجل المزامنة كان **يبلّغ عن الفشل كنجاح**: عند تعذر SportScore/TheSportsDB يُسجَّل `status: 'active'` و`httpStatus: 200` | `lib/sync/engine.ts` القديم (`httpStatus: ssRes.httpStatus ?? 200`) |
| 7 | لا يوجد تسجيل لـ«آخر محاولة جلب» مقابل «آخر جلب ناجح» ونتيجة كل محاولة للمباريات (كان موجودًا للأخبار فقط) | `meta` في `lib/types.ts` |
| 8 | سجل «جارية» قديم في الذاكرة يبقى «جارية الآن» بين عمليات المزامنة | الحارس الزمني كان يُطبَّق فقط عند تحميل الملف |
| 9 | عنوان الصفحة الرئيسية بلا اسم الموقع (`<title>جدول مباريات اليوم بتوقيت القاهرة</title>`) لأن قالب العنوان لا يسري على المقطع الجذري | مخرجات HTML المحلية |

ما **لم** يكن به خلل مؤكد: robots.txt، sitemap (تواريخ غير فارغة فقط، بلا إدارة/API)، canonical لكل صفحة إلى نفسها، `noindex` للتواريخ الفارغة ولصفحة الأخبار الفارغة، التحويلات (`/?date=` ⇒ `/matches/{date}`، تاريخ اليوم ⇒ `/`)، 404 للتواريخ غير الصالحة، `viewport`، H1 واحد، محرك الأخبار (مصدر وحيد Google News RSS مع تمييز `publishedAt`/`fetchedAt` ومنع التكرار؛ لا تُعرض عناصر غير محققة).

---

## 2. الإصلاحات المنفذة والملفات المعدلة

### أ) الربط المباشر بقسم البث
- `lib/nemo-resolver.ts`: 
  - ثابت `NEMO_LIVE_STREAM_ANCHOR = 'live-stream'` و`buildNemoBroadcastUrl(slug)` ⇒ `https://nemo-sports.vercel.app/matches/{slug}#live-stream`.
  - الدقة الأولى: slug مسار SportScore الموجود في سجل المباراة (هو **المعرّف نفسه** الذي يبني به الموقع الأساسي صفحة المباراة). الثانية: جدول الجسر الموثق لمعرّفات TheSportsDB/API-Football. غير ذلك: بلا رابط.
  - `isLinkableNemoMatchSlug` يرفض slugs العناصر النائبة (`team-xxxxxxxx-vs-team-yyyyyyyy`) التي يردّ عليها الموقع الأساسي بـ 404.
- `components/MatchCard.tsx`: نص الزر «مشاهدة البث على NEMO Sports» / «لا يتوفر رابط بث مطابق».
- `lib/seo/match-structured-data.ts`: JSON-LD يشير إلى صفحة المباراة بلا جزء `#` (الجزء للمستخدم لا لمحركات البحث).

### ب) الدوري المصري والتحديث الآلي
- `lib/sources/thesportsdb.ts`: `buildTheSportsDBEndpoints` — `eventsnextleague.php` + `eventspastleague.php` لكل من 4829 (الدوري المصري)، 4830 (كأس مصر)، 5185 (كأس الرابطة)، 5057 (الكونفدرالية) + `eventsday.php` لأمس/اليوم/غد. إزالة أرقام الجولات الثابتة. نتيجة **كل نقطة نهاية** تُعاد وتُسجَّل (`endpoints[]`). منع تكرار `idEvent` داخل الدفعة.
- `lib/sync/engine.ts`:
  - `ensureFreshMatches(maxAge=10 دقائق)` — تحديث عند الطلب مع طلب واحد مشترك (in-flight) ووضع `quick` يتخطى Football-Data/API-Football عند غياب مفاتيحهما ويتخطى الأخبار.
  - تسجيل نتيجة كل محاولة عبر `recordMatchesSyncAttempt` (ناجحة/فاشلة، المصادر الناجحة/الفاشلة، عدد المباريات).
  - إبلاغ صادق عن الفشل: `status: 'degraded'` و`httpStatus` الحقيقي ورسالة الخطأ، وزيادة `errorCount`.
- `lib/db/store.ts`: `upsertMatchesInStore` يدمج بالمعرّف ثم بمفتاح الهوية عبر المصادر `buildMatchDedupKey` (`lib/match-identity.ts`) مع الحفاظ على المعرّف الأول وتوحيد `externalIds` وإعادة حساب الرابط؛ `guardStaleLiveStatus` (20 دقيقة) يُطبَّق عند الاستعلام؛ `recordMatchesSyncAttempt`.
- `lib/news/migrate.ts`: دمج السجلات المكررة بمفتاح الهوية عند تحميل الملف أيضًا.
- `lib/types.ts`: حقول `lastMatchesSyncAttemptAt` / `lastSuccessfulMatchesSyncAt` / `lastMatchesSyncResult` و`endpoints[]`.
- `lib/freshness.ts` + `components/MatchGatewayClient.tsx`: سطر صغير أعلى الجدول يميز «آخر تحديث ناجح» عن «تعذر التحديث في آخر محاولة؛ تُعرض بيانات آخر جلب ناجح» (نفس تنسيق سطر تحديث الأخبار؛ بلا تغيير في التصميم).
- `app/page.tsx`، `app/matches/[date]/page.tsx`، `app/api/matches/route.ts`: استدعاء `ensureFreshMatches()` قبل القراءة.

### ج) SEO
- `app/page.tsx`: عنوان مطلق يتضمن اسم الموقع.

### د) الاختبارات والتوثيق
- `tests/broadcast-link-and-sync.test.ts` (6 اختبارات جديدة)، تحديث `tests/gateway.test.ts` للرابط الجديد، `README.md`، هذا التقرير.

---

## 3. نتائج الاختبارات (أدلة محلية)

| الفحص | النتيجة |
|---|---|
| `npx tsc --noEmit` | بلا أخطاء |
| `npm run lint` | بلا أخطاء |
| `npm test` | **51/51** ناجح (45 سابقة + 6 جديدة) |
| `npm run build` | ناجح (Next.js 16.4.0) |
| `GET /` ، `/matches/2026-10-11` ، `/matches/2026-10-13` | 200 |
| `GET /matches/2026-10-12` (اليوم) | 307 ⇒ `/` (صحيح، canonical واحد لليوم) |
| `GET /?date=2026-10-11` | 307 ⇒ `/matches/2026-10-11` |
| `GET /matches/bad-date` | 404 |
| `GET /matches/2026-10-25` (بلا مباريات) | 200 + `noindex, follow` + canonical لنفسها |
| `GET /api/cron/update-matches` بلا سر | 500 (إعدادات) — المسار مغلق |
| `GET /robots.txt` | `Allow: /`، `Disallow: /api/ /admin/ /admin`، رابط Sitemap |
| `GET /sitemap.xml` | `/` + 6 صفحات تواريخ غير فارغة فقط؛ لا إدارة، لا API، لا query params، لا تحويلات |
| تحديث عند الطلب في بيئة بلا إنترنت | سُجّل: `ok:false, sourcesFailed:[sportscore, thesportsdb]`، **المباريات السابقة بقيت كاملة (37)**، وظهر السطر «تعذر تحديث المباريات في آخر محاولة…» |
| `viewport` و H1 | `width=device-width, initial-scale=1`؛ H1 واحد |

---

## 4. مصدر بيانات الدوري المصري وحالة التحديث الآلي

- **المصدر المحتفظ به**: TheSportsDB v1 (مفتاح عام مجاني `3`) للمواعيد/النتائج/الجولات، وSportScore (بدون مفتاح) للنتائج المباشرة وslug صفحة المباراة. لم تُضف خدمة مدفوعة ولا مفتاح جديد.
- **القيود الفعلية** (من توثيق TheSportsDB وليس افتراضًا): المفتاح `3` محدود المعدل ومخصص للتطوير؛ `eventsnextleague`/`eventspastleague` يعيدان 15 حدثًا فقط لكل منهما؛ `eventsday.php` قد يكون محدودًا في المستوى المجاني — لذلك تُسجَّل نتيجة كل نقطة نهاية على حدة ولا يُفترض نجاحها. SportScore يعيد نافذة متدحرجة (50 مباراة) وليس أرشيفًا.
- **آلية التحديث**: Cron يومي (خطة Hobby) + تحديث عند الطلب كل 10 دقائق على الأكثر عند زيارة الصفحات/API. التخزين ما زال ملف JSON بذاكرة لكل مثيل (كما كان)؛ للمشاركة بين المثيلات يلزم مخزن خارجي (قرار منفصل يحتاج موافقتك).
- **توقيت القاهرة**: `cairoDate`/`cairoTime` يُحسبان من `Africa/Cairo` عبر `Intl`؛ البطاقة تعرض الوقت بـ `timeZone: 'Africa/Cairo'` (مثال محلي: الزمالك–الأهلي 17:00Z ⇒ ٠٨:٠٠ م).
- **لم يُختلق أي بيان**: الملف `data/gateway-store.json` لم يُعدَّل.

---

## 5. روابط Sitemap وRobots الفعلية

- `https://nemo-live-kora-matchat.vercel.app/robots.txt`
- `https://nemo-live-kora-matchat.vercel.app/sitemap.xml` — محتوى البناء المحلي: `/`, `/matches/2026-10-11`, `/matches/2026-10-13`, `/matches/2026-10-14`, `/matches/2026-10-16`, `/matches/2026-10-17`, `/matches/2026-10-19` (تتغير مع البيانات؛ الأخبار تدخل فقط عند وجود مقال قابل للفهرسة).

---

## 6. نتائج اختبار روابط المباريات النهائية

الأعمدة «الرابط الذي يضغطه المستخدم» من مخرجات `/api/matches` و HTML المحلي بعد الإصلاح. «الرابط النهائي بعد التحويل» و«هل وصل إلى قسم البث» مستنتَجان من كود الموقع الأساسي (انظر §7) ويحتاجان تأكيد HTTP من بيئة متصلة.

| البطولة | المباراة | معرّف المباراة | رابط البوابة | الوجهة المتوقعة | قسم البث؟ | المباراة الصحيحة؟ |
|---|---|---|---|---|---|---|
| الدوري المصري الممتاز | الزمالك × الأهلي (11/10) | `match-api-football-1612250` (slug: `zamalek-sc-vs-al-ahly-fc`) | `https://nemo-sports.vercel.app/matches/zamalek-sc-vs-al-ahly-fc#live-stream` | نفس الصفحة (`force-dynamic`، بلا تحويل) | نعم — `<section id="live-stream">` تُعرض دائمًا | نعم — نفس slug SportScore الموثق سابقًا بالنتيجة 0-2 |
| الدوري المصري الممتاز | القناة × المصري (11/10) | `match-api-football-1612249` (slug: `olympic-el-qanal-vs-al-masry`) | `…/matches/olympic-el-qanal-vs-al-masry#live-stream` | نفس الصفحة | نعم | نعم (موثق سابقًا 1-1) |
| الدوري البرازيلي | ساو باولو × فيتوريا | `match-sportscore-k82rekhg0vyzrep` | `…/matches/sao-paulo-vs-vitoria-ba#live-stream` | نفس الصفحة | نعم | نعم — slug وارد من مسار SportScore الفعلي، وهو المثال الذي يستشهد به كود الموقع الأساسي نفسه |
| الدوري المصري الممتاز | بيراميدز × سيراميكا (12/10) | `match-api-football-1612253` (TheSportsDB فقط) | **بلا رابط** (البطاقة غير قابلة للنقر مع توضيح) | — | — | لا نوجّه إلى صفحة فارغة أو مباراة أخرى؛ يُضاف الرابط تلقائيًا عندما يرصدها SportScore |

ملاحظة: الملف الملتزم به يحتوي slug `flamengo-vs-santos` من لقطة يدوية بينما يذكر كود الموقع الأساسي أن SportScore يسميها `flamengo-vs-santos-fc`؛ الموقع الأساسي يعالج ذلك بتحويل (`resolveInboundMatchSlug`) فقط عندما تطابق المباراة سجلًا واحدًا بالضبط، وإلا 404. أول مزامنة ناجحة تستبدل slug اللقطة بالقيمة الحقيقية من `url` المصدر.

---

## 7. هل الربط بقسم البث مكتمل؟

**مكتمل من جهة البوابة؛ لا يحتاج تعديلًا في الموقع الأساسي.** الأدلة من كود الموقع الأساسي (قراءة فقط):

- `app/matches/[slug]/page.tsx`: صفحة المباراة تُعرّف بالـ slug وتعرض **دائمًا** إمّا `<MatchStreamPlayer … sectionId="live-stream">` أو `<section id="live-stream">` بإشعار «لا يوجد بث موثّق لهذه المباراة حاليًا». إذًا المرساة `#live-stream` موجودة في كل الحالات.
- `packages/sdl/src/adapters/sportscore.ts#matchSlugFromUrl` و`lib/match-links.ts#matchPath`: معرّف الصفحة = slug مسار SportScore (نفس التعبير النمطي المستخدم في البوابة `extractSportscoreMatchSlug`).
- `app/match/[slug]/page.tsx`: المسار القديم `/match/` يحوّل 308 إلى `/matches/`؛ المتصفحات تحتفظ بالجزء `#live-stream` عبر التحويل.
- صفحة `/live` تعرض **قائمة** بث بمعرّفات داخلية للبث (`live-stream-{streamId}`) لا معرّفات مباريات، ولا تدعم تحديد مباراة عبر الرابط؛ لذلك لم تُستخدم (البند 8 من المرحلة الثالثة) — صفحة المباراة نفسها هي المكان الذي يحدد المباراة بوضوح ويعرض بثها.
- لا يوجد في الموقع الأساسي مسار مثل `/watch?matchId=` — ولم يُفترض.

**ما يتبقى للتصنيف "مكتمل ومُثبت"** (دقيقة واحدة من أي جهاز متصل، بلا أي تعديل):
```bash
curl -sI "https://nemo-sports.vercel.app/matches/zamalek-sc-vs-al-ahly-fc" | head -1      # متوقع 200
curl -s  "https://nemo-sports.vercel.app/matches/zamalek-sc-vs-al-ahly-fc" | grep -c 'id="live-stream"'   # متوقع 1
```
ثم فتح `…#live-stream` في المتصفح للتأكد من التمرير إلى قسم «البث المباشر».

**تحسين اختياري في الموقع الأساسي (غير مطلوب للربط)**: لو أراد الفريق أن تكون المباريات الواردة من TheSportsDB فقط قابلة للربط، يحتاج الموقع الأساسي قبول معرّف TheSportsDB/API-Football في صفحة المباراة. هذا خارج نطاق هذا المستودع ولم يُنفَّذ.

---

## 8. المشكلات المتبقية والإعدادات اليدوية

1. **التحقق HTTP النهائي** للروابط من بيئة متصلة (الأمر أعلاه).
2. `CRON_SECRET` يجب أن يكون مضبوطًا في Vercel وإلا يرد `/api/cron/update-matches` بـ 500 (سلوك مقصود).
3. التخزين ملف JSON في ذاكرة المثيل؛ التحديث عند الطلب يحل التقادم لكن لا يشارك البيانات بين المثيلات. مخزن خارجي = قرار منفصل بتكلفة محتملة، يحتاج موافقتك.
4. المباريات المصرية التي لا يرصدها SportScore تبقى بلا زر بث (قصدًا).
5. `data/gateway-store.json` لقطة من 12/10 00:35 UTC؛ تُحدَّث عند أول مزامنة ناجحة في الإنتاج، ولم تُعدَّل يدويًا.

## 9. تأكيد عدم تغيير مستودع الموقع الأساسي
مستودع `sport` استُنسخ إلى مجلد مؤقت خارج مساحة العمل للقراءة فقط؛ لم يُنفَّذ عليه أي `commit`/`push`، ولا تعديل ملفات.

## 10. تأكيد عدم النشر/الدمج
جميع التغييرات على فرع العمل `arena/beff854f-nemo-live-kora` محليًا، بلا دفع إلى `main` وبلا Pull Request وبلا نشر على Vercel، بانتظار موافقتك الصريحة.
