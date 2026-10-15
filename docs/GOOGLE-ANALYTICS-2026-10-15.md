# كود Google Analytics في كل الصفحات — 2026-10-15

> هذه الوثيقة تسجّل ما نُفّذ بالضبط، وأين، ولماذا، وكيف يُتحقّق منه بعد النشر.
> النطاق: بوابة `nemo-live-kora` (`https://nemo-live-kora.vercel.app`).
> الطلب: «إضافة كود Google Analytics في كل صفحات الموقع، مباشرةً بعد وسم `<head>`، لمتابعة الزيارات».

---

## 1) ما نُفّذ في سطر واحد

كود Google Analytics (gtag.js) أصبح يُرسم **داخل `<head>` في كل صفحات الموقع** من مكان واحد:
التخطيط العام `app/layout.tsx` ← المكوّن `components/GoogleAnalytics.tsx` ← المصدر الواحد
`lib/analytics/google-analytics.ts`. لا نسخة من الكود في أي صفحة، ولا معرّف مكتوب في أي مكوّن.

| # | العنصر | الملف | الدور |
| --- | --- | --- | --- |
| ① | مصدر واحد للمعرّف والنطاقات والسكربت الداخلي | `lib/analytics/google-analytics.ts` | معرّف القياس `G-HH8N3QCBFV` + بناء الرابط + نص أوامر gtag + مفتاح الإيقاف |
| ② | وسما Google في الرأس | `components/GoogleAnalytics.tsx` | `<script async src="…gtag/js?id=G-…">` ثم سكربت التهيئة الداخلي |
| ③ | التركيب في كل الصفحات | `app/layout.tsx` | **أول عنصر داخل `<head>`** + `dns-prefetch` لنطاقَي Google |
| ④ | قياس التنقّل الداخلي | `components/GoogleAnalyticsPageViews.tsx` | حدث `page_view` عند كل تنقّل بلا إعادة تحميل |
| ⑤ | الحراسة الآلية | `tests/google-analytics.test.ts` | 9 اختبارات تمنع أي انحراف لاحق |

هذا هو **الكود نفسه الذي أرسله صاحب المنتج**، حرفيًا (مع استبدال المعرّف نصًّا من المصدر الواحد):

```html
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-HH8N3QCBFV"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-HH8N3QCBFV');
</script>
```

---

## 2) لماذا في التخطيط العام لا في كل صفحة؟

Next.js (App Router) يبني كل صفحة داخل التخطيط الجذري `app/layout.tsx` — وهو **الملف الوحيد**
الذي يُنشئ `<html>` و`<head>` في المشروع كله. وضْع الوسم فيه يعني:

- **كل الصفحات** بلا استثناء: `/` · `/matches` · `/matches/[id]` (جدول التاريخ **وصفحة هبوط المباراة**) ·
  `/match/[id]` · `/live/[matchId]` · `/news` · `/news/[slug]` · `/news/archive` · `/about` ·
  `/contact` · `/privacy-policy` · `/terms` · صفحات لوحة الإدارة — كلها تمرّ من التخطيط نفسه.
- **استحالة نسيان صفحة** جديدة تُضاف مستقبلًا، واستحالة اختلاف نسخة الكود بين صفحة وأخرى.
- **عدم تكرار الوسم**: لا صفحة تُنشئ `<head>` خاصًا بها (اختبار آلي يتحقق من ذلك)، فلو أضاف
  أحدهم وسمًا يدويًا في صفحة سيُكشف فورًا.

---

## 3) أين يظهر الوسمان فعلًا داخل الرأس؟ (مقيس، لا مُفترض)

`React 19` يعيد ترتيب السكربتات داخل `<head>` بحكم تصميمه:

- سكربت `async` ⇒ يُرفع إلى **أعلى `<head>`** (بعد سكربتات Next الخاصة مباشرة) فيكون أول سكربت
  خارجي في الرأس.
- سكربت داخلي (بلا `src`) ⇒ يُودع في **آخر `<head>`** قبل `</head>` مباشرة.

والأثر العملي صفر: الوسمان **داخل `<head>` في كل صفحة، وقبل أي عنصر من `<body>`**، ولا يُفقد أي
قياس ولا يتأخّر أول رسم (السكربت الخارجي `async`، والداخلي 4 أسطر لا تنتظر أي طلب شبكة).

### الإثبات الفعلي (خادم الإنتاج محليًا، 2026-10-15)

```bash
npm run build && npm run start          # 0.0.0.0:3000
curl -s http://127.0.0.1:3000/ | python3 -c "import sys,re;h=sys.stdin.read();head=h[h.find('<head'):h.find('</head>')];print([t[:120] for t in re.findall(r'<script[^>]*>',head)])"
```

الناتج الفعلي (مختصر):

```text
… <script src="/_next/static/chunks/07s566nldosf_.js" async=""></script>
<script id="google-analytics-loader" async="" src="https://www.googletagmanager.com/gtag/js?id=G-HH8N3QCBFV"></script>
<script id="adsterra-popunder" async="" src="https://furydonkeypharmacy.com/45/91/b9/….js"></script>
… <meta name="theme-color" …><title>…</title> … <link rel="canonical" …>
<link rel="dns-prefetch" href="//www.googletagmanager.com"/>
<link rel="dns-prefetch" href="//www.google-analytics.com"/>
<script id="google-analytics-init">window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-HH8N3QCBFV');</script>
</head>
```

وتم فحص كل أنواع الصفحات فعليًا (البناء الإنتاجي نفسه)، والنتيجة **مطابقة 100%**:

| الصفحة | الوسمان داخل `<head>`؟ | عدد مرات المعرّف في الرأس | `dns-prefetch` لـ Google |
| --- | --- | --- | --- |
| `/` (الرئيسية) | نعم | 2 | 2 |
| `/matches/2026-10-16` (جدول تاريخ) | نعم | 2 | 2 |
| `/matches/al-ittihad-alexandria-vs-zamalek-2026-10-20` (صفحة هبوط مباراة) | نعم | 2 | 2 |
| `/news` | نعم | 2 | 2 |
| `/admin` (لوحة الإدارة) | نعم | 2 | 2 |
| `/privacy-policy` · `/about` · `/terms` · `/contact` | نعم | 2 | 2 |

(المعرّف يظهر **مرتين**: مرة في وسم المكتبة ومرة في أمر `config` — وهذا هو المتوقع، ولا تكرار للوسم.)

```bash
for p in / /matches /news /admin /privacy-policy /about /terms /contact; do
  echo "== $p"; curl -s "http://127.0.0.1:3000$p" | python3 -c "
import sys; h=sys.stdin.read(); head=h[h.find('<head'):h.find('</head>')]
print('loader', 'google-analytics-loader' in head, '| init', 'google-analytics-init' in head)";
done
```

---

## 4) لماذا وسم `<script>` مباشر وليس `next/script`؟

`next/script` بأي استراتيجية (عدا `beforeInteractive` التي تحجب العرض) تُلحق الوسم في **نهاية
`<body>` بعد الترطيب** — أي أن مكانه الفعلي لا يكون في الرأس كما طُلب، ويتأخّر تسجيل أول صفحة
مشاهدة إلى ما بعد عمل React. ووسم `<script>` مباشر في الرأس يحقّق المطلوب بدقة مع الحفاظ على
السرعة:

- `async` على سكربت المكتبة ⇒ لا يوقف تحليل HTML، ولا يحجب الترطيب، ولا يؤخّر أول رسم (LCP).
- السكربت الداخلي يُنشئ `dataLayer` ويكدس الأوامر فيه؛ ولو وصلت المكتبة متأخّرة أو قبلها فالأوامر
  تُفرَّغ فور وصولها (هذا هو سبب وجود الطابور في الوسم الرسمي من الأصل)، فلا تُفقد «صفحة المشاهدة» الأولى.
- `dns-prefetch` لنطاقَي `www.googletagmanager.com` و`www.google-analytics.com` في نفس الرأس
  (بلا `preconnect` عن قصد: لا نفتح اتصالًا لأي زائر لا يصل إلى تلك الخدمة).

---

## 5) التنقّل داخل الموقع: لماذا يلزم كود إضافي؟

Next.js يبدّل الصفحات **بلا إعادة تحميل للمستند**، و`gtag('config')` يُرسل صفحة مشاهدة واحدة عند
تحميل المستند. فبلا معالجة صريحة، زائر يدخل الرئيسية ثم ينتقل إلى عشر صفحات مباريات يظهر في
تقارير Google كزيارة واحدة — أي أن «متابعة الزيارات» التي طُلبت تفشل في أغلب الصفحات.

الحل المنفَّذ (`components/GoogleAnalyticsPageViews.tsx`): مكوّن عميل يرسم `null` (لا يضيف أي عنصر
للموقع)، ويستمع لتغيّر المسار مع سلسلة الاستعلام، ويرسل `page_view` مرة واحدة لكل صفحة جديدة:

```ts
gtag('event', 'page_view', { page_path, page_location, page_title, send_to });
```

- **صفحة الدخول لا تُحسب مرتين**: أول تشغيل للأثر يُتخطّى لأن `config` أرسلها بالفعل (`shouldTrackGaPageView`).
- **إعادة الرسم بلا تنقّل لا تُرسل شيئًا** (نفس المسار = لا حدث).
- **غياب `gtag` لا يكسر الموقع**: لو حجبه مانع إعلانات أو فشل تحميله، يتوقف الإرسال بهدوء بلا خطأ
  في وحدة التحكم (`typeof gtag !== 'function'`).
- **بلا أثر على السيو أو التوليد**: القياس يقرأ سلسلة الاستعلام من `window.location`
  ولا يستخدم `useSearchParams` (الذي يحوّل الصفحات الساكنة إلى ديناميكية).

---

## 6) مصدر واحد + مفتاح إيقاف

| المتغيّر | الأثر | الافتراضي |
| --- | --- | --- |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | استبدال معرّف القياس دون تعديل كود | `G-HH8N3QCBFV` |
| `NEXT_PUBLIC_GA_ENABLED=off` | إيقاف الوسم كاملًا: لا سكربت ولا طلب إلى Google من أي صفحة | مفعّل |

- **المعرّف مكتوب مرة واحدة فقط** في `lib/analytics/google-analytics.ts`، ورابط التحميل يُبنى منه
  (`buildGaScriptUrl`) فلا ينفصلان. واختبار آلي يفشل إذا ظهر المعرّف أو نطاق `googletagmanager.com`
  أو `google-analytics.com` في أي مكوّن أو صفحة.
- **المعرّف مُحكوم الصيغة**: `G-[A-Z0-9]{4,32}`. فالقيمة غير الصالحة (أو محاولة حقن `</script>`
  عبر متغيّر البيئة) تُرفض ولا يُرسم أي وسم ولا يُرسل أي قياس — الفشل الصريح لا نجاح وهمي.
- **الإيقاف مُتحقَّق منه على HTML حقيقي** (نفس البناء الإنتاجي، مع `NEXT_PUBLIC_GA_ENABLED=off`):

```bash
NEXT_PUBLIC_GA_ENABLED=off npx next start -H 127.0.0.1 -p 3011 &
curl -s http://127.0.0.1:3011/ | grep -c "googletagmanager\|google-analytics\|G-HH8N3QCBFV"
# 0  ← لا سكربت ولا رابط ولا حتى dns-prefetch لنطاق Google
```

  (وعلى Vercel يستلزم أي تغيير في متغيّرات `NEXT_PUBLIC_*` إعادة نشر — كالمعتاد مع Next.js.)

---

## 7) الحراسة الآلية (`tests/google-analytics.test.ts`)

```
npm test          # 314 اختبارًا، منها 9 لهذا الوسم
```

| الاختبار | ما يمنعه |
| --- | --- |
| ① الموضع في المصدر | أن يُنقل الوسم خارج `<head>` أو بعد سكربتات الإعلانات |
| ② تخطيط جذري واحد | أن تُضاف صفحة برأس خاص بها فتفقد الوسم أو تكرّره |
| ③ الكود حرفيًا | أي تغيير في الرابط أو أوامر `gtag` أو المعرّف |
| ④ بناء الروابط من المعرّف | انفصال رابط الوحدة عن المعرّف، أو إضافة `preconnect` |
| ⑤ مصدر واحد | كتابة المعرّف/النطاق في مكوّن أو صفحة |
| ⑥ الأداء | `beforeInteractive` · `dangerouslySetInnerHTML` · `document.write` · `next/script` |
| ⑦ التنقّل | احتساب صفحة الدخول مرتين، أو فقدان صفحات التنقّل الداخلي |
| ⑧ مفتاح الإيقاف | بقاء أي أثر أو سكربت بعد `NEXT_PUBLIC_GA_ENABLED=off` |
| ⑨ المعرّف | قبول معرّف غير صالح، أو تجاهل البديل المضبوط في البيئة |

---

## 8) خطوات القبول بعد النشر

**① أمر واحد يتحقّق من الموقع المنشور كله** (قراءة فقط، بلا أي كتابة):

```bash
npm run audit:analytics
# على دومين آخر (أو على بناء محلي):
node --import tsx scripts/audit-analytics.ts --base=https://nemo-live-kora.vercel.app
node --import tsx scripts/audit-analytics.ts --base=http://127.0.0.1:3000 --out=docs/evidence/analytics.json
```

يفحص لكل صفحة — ومنها صفحات تُكتشف تلقائيًا من روابط الموقع (تاريخ + صفحة هبوط مباراة):
وسَمَي Google داخل `<head>` · الرابط يحمل معرّف القياس الصحيح · أمر `gtag('config', …)` ·
عدد ظهور المعرّف في الرأس = 2 · `dns-prefetch` للنطاقين · وعدم ظهور أي وسم في `<body>`.
رمز الخروج `1` يعني وجود نقص مع بيان الصفحة والحقل الناقص. والنتيجة الفعلية على البناء الإنتاجي
(2026-10-15) محفوظة في [`docs/evidence/analytics-2026-10-15.json`](evidence/analytics-2026-10-15.json):
**9/9 صفحة مطابقة**. وبفحص سالب (خادم بلا وسم) رصدت الأداة النقص وأرجعت رمز خروج `1`.

**② Realtime في Google Analytics**: افتح الموقع وتنقّل بين صفحتين — يجب أن تظهر صفحة الدخول وكل
صفحة تنقّل كحدث `page_view` جديد خلال ثوانٍ.

**③ تدقيق الرأس يدويًا (اختياري)**: `Ctrl+U` ثم ابحث عن `G-HH8N3QCBFV` — يظهر مرتين داخل `<head>`.

**④ منع حجب القياس**: تأكد أن مانع الإعلانات متوقف في اختبارك (المتصفحات تمنع `gtag` أحيانًا)؛
الموقع لا يعتمد عليه في أي وظيفة، لكن القياس نفسه لا يصل حين يُحجب.

**⑤ التقارير بعد 24–48 ساعة**: `Reports → Engagement → Pages and screens` يجب أن تظهر فيها
صفحات المسار (`/matches/…`، `/news/…`) لا صفحة الدخول وحدها.

> ⚠️ **ملاحظة مقيسة عن الإيقاف/التبديل:** متغيّرات `NEXT_PUBLIC_*` تُستبدل **وقت البناء**. أُوقف
> الوسم على خادم يعمل بنفس البناء السابق فظلّ يظهر في الصفحات **الساكنة** (المُولَّدة مسبقًا) واختفى
> من الصفحات الديناميكية — أي أن `NEXT_PUBLIC_GA_ENABLED=off` أو تبديل المعرّف يستلزم **إعادة نشر**
> كاملة على Vercel، لا مجرد تغيير المتغيّر. هذا سلوك Next.js المتوقع، وموثّق هنا حتى لا يُفسَّر خطأً.

---

## 9) ملاحظة تشغيلية

- صفحات لوحة الإدارة (`/admin/*`) مشمولة بالقياس لأنها جزء من «كل صفحات الموقع»، ومساراتها لا
  تحمل أي بيانات شخصية. لإيقاف القياس فيها لاحقًا يمكن استثناؤها بشرط مسار واحد في
  `components/GoogleAnalytics.tsx` دون أي تغيير في بقية الملفات.
- سياسة الخصوصية (`/privacy-policy`) تُحدَّث لتذكر **Google Analytics** بالاسم صراحةً بجانب
  Adsterra وAdSense، لأن الوسم يضع كوكيز `_ga`.
