# كود إثبات الملكية وتفعيل Google AdSense في كل الصفحات — 2026-10-15

> هذه الوثيقة تسجّل ما نُفّذ بالضبط، وأين، ولماذا، وكيف يُتحقّق منه بعد النشر.
> النطاق: بوابة `nemo-live-kora` (`https://nemo-live-kora.vercel.app`).
> الطلب: «إضافة كود إثبات الملكية وتفعيل إعلانات Google AdSense في ملف الـ Root Layout
> الرئيسي للموقع بين وسوم `<head>` و `</head>` بالكامل» — بـ `crossorigin="anonymous"`
> وتحميل سليم بلا أخطاء hydration حتى ترصد أداة التحقق من Google الرمز فورًا عند الضغط
> على زر «تحقق».

---

## 1) ما نُفّذ في سطر واحد

كود AdSense يُرسم **داخل `<head>` في كل صفحات الموقع** من مكان واحد: التخطيط العام
`app/layout.tsx` — الوسم المطلوب حرفيًا + ميتا حساب الناشر، يعملان افتراضيًا بلا أي
إعداد بيئة.

| # | العنصر | الملف | الدور |
| --- | --- | --- | --- |
| ① | مصدر واحد لمعرّف الناشر | `lib/ads/config.ts` | `DEFAULT_ADSENSE_CLIENT_ID = 'ca-pub-5770911159315916'` + `resolveAdsenseHeadClient()` (البيئة تُرجّح، وإلا الافتراضي) |
| ② | الوسمان في الرأس | `app/layout.tsx` | `<script id="google-adsense" async src="…adsbygoogle.js?client=…">` بـ `crossOrigin="anonymous"` + `<meta name="google-adsense-account">` |
| ③ | الحراسة الآلية | `tests/adsense-verification.test.ts` | 5 اختبارات تمنع أي انحراف (الموضع، الصيغة، المصدر الواحد، الترتيب، لا next/script) |
| ④ | التدقيق بعد النشر | `scripts/audit-adsense.ts` | `npm run audit:adsense` — يفحص HTML المُخدم على الموقع الحقيقي ويُرجع `1` عند أي نقص |
| ⑤ | التوثيق | هذا الملف + ملاحظة README | مصدر قرار غير قابل للنسيان |

هذا هو **الكود نفسه الذي أرسله صاحب المنتج**، حرفيًا (مع بناء الرابط من المعرّف
الفعّال بدل تكراره):

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5770911159315916" crossorigin="anonymous"></script>
```

وبجانبه في الرأس مباشرة (وهو ما يجعل «تحقق» AdSense يجد الحساب موثّقًا حتى قبل السكربت):

```html
<meta name="google-adsense-account" content="ca-pub-5770911159315916">
```

---

## 2) لماذا في التخطيط الجذري لا في كل صفحة؟

Next.js (App Router) يبني كل صفحة داخل التخطيط الجذري `app/layout.tsx` — وهو **الملف
الوحيد** الذي يُنشئ `<html>` و `<head>` في المشروع كله. وضع الكود فيه يعني:

- **كل الصفحات** بلا استثناء: `/` · `/matches` · صفحات الهبوط والبث · `/news` ·
  الصفحات القانونية · لوحة الإدارة — كلها تمرّ من التخطيط نفسه.
- **استحالة نسيان صفحة** تُضاف مستقبلًا، واستحالة اختلاف نسخة الكود بين صفحة وأخرى.
- أداة التحقق تقرأ HTML المُرسل **قبل أي جافاسكربت** — فالوسم الجذري موجود فيها
  بالتعريف.

---

## 3) أين يظهر الوسم فعلًا داخل الرأس؟ (مقيس، لا مُفترض)

بناء إنتاجي حقيقي + خادم إنتاج محلي، ثم `curl` على HTML المُخدم (2026-10-15):

```bash
npm run build && npm start          # 0.0.0.0:3000
curl -s http://127.0.0.1:3000/ | grep -o '<script id="google-adsense"[^>]*>'
```

الناتج الفعلي:

```text
<script id="google-adsense" async="" src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5770911159315916" crossorigin="anonymous">
```

وتم فحص الصفحات فعليًا (البناء الإنتاجي نفسه) والنتيجة **مطابقة 100%**:

| الصفحة | السكربت داخل `<head>`؟ | `crossorigin="anonymous"`؟ | ميتا الحساب؟ |
| --- | --- | --- | --- |
| `/` (الرئيسية) | نعم (مرة واحدة) | نعم | نعم |
| `/matches` | نعم | نعم | نعم |
| `/about` | نعم | نعم | نعم |
| `/news` | نعم | نعم | نعم |

والترتيب داخل الرأس: **Google Analytics أولًا ← كود AdSense ← Adsterra Popunder
أخيرًا قبل `</head>`** — ولا تزاحم بين الوسوم (محروس باختبار رقم 4).

```bash
npm run audit:adsense -- --base=http://127.0.0.1:3000
# بعد النشر على Vercel:
npm run audit:adsense   # الأساس: https://nemo-live-kora.vercel.app
```

النتيجة محفوظة في `docs/evidence/adsense-2026-10-15.json`.

---

## 4) لماذا وسم `<script>` مباشر وليس `next/script`؟

**قرار مقيس لا نظري** — نفس سبب `components/GoogleAnalytics.tsx` و
`components/AdsterraPopunder.tsx` (موثّق في
`docs/GOOGLE-ANALYTICS-2026-10-15.md`): `next/script` بأي استراتيجية (عدا
`beforeInteractive` التي تحجب العرض) تُلحق الوسم في **نهاية `<body>` بعد الترطيب** —
أي خارج الرأس تمامًا، فيفشل شرط «بين وسوم `<head>` و `</head>`» ويتأخر رصد أداة
التحقق حتى يعمل JavaScript على الجهاز.

أما الوسم المباشر فيتحقق المطلوب كله معًا:

- **الموضع**: يُرفع إلى الرأس مع كل سكربت `async` في React 19، ويُسلَّم في HTML
  المُخدم — يظهر في `view-source` ومن لحظة تحليل المستند.
- **بلا hydration**: الخادم والعميل يرسمان الوسم نفسه حرفيًا (عنصر ثابت بلا حالة)،
  والنمط ذاته يعمل في هذا المشروع منذ إضافة GA والـ Popunder بلا أي انحراف مسجّل.
- **بلا تعطيل للعرض**: `async` لا يوقف تحليل HTML ولا يؤخّر أول رسم (LCP) ولا يحجب
  الترطيب، و`crossorigin="anonymous"` كما في الطلب يمنع أي خطأ في تحميل الملف عبر
  CORS.
- **بناء واحد**: الرابط مبنيّ من `resolveAdsenseHeadClient()` — لا معرّف مكتوب يدويًا
  في أكثر من ملف.

---

## 5) الحراسة الآلية والتدقيق بعد النشر

- `tests/adsense-verification.test.ts` — 5 اختبارات:
  ① الموضع بين `<head>` و `</head>` وعدد مرات الظهور · ② الرابط و`async`
  و`crossorigin="anonymous"` ورقم الوسم · ③ المصدر الواحد والافتراضي المعتمد ·
  ④ الترتيب مقابل GA والـ Popunder · ⑤ لا `next/script` ولا `beforeInteractive`
  ولا حقن HTML.
- `npm run audit:adsense` — قراءة فقط، يفحص كل الصفحات المنشورة (ويكتشف صفحات
  التاريخ والهبوط من روابط الرئيسية) ويرجع `1` مع بيان الناقص عند أي انحراف.

---

## 6) خطوات القبول بعد النشر

1. رفع التغيير إلى `main` ونشر Vercel.
2. `npm run audit:adsense` — النتيجة المتوقعة: `مطابِق: N/N صفحة`.
3. فتح الصفحة الرئيسية ← `view-source` ← البحث عن `adsbygoogle.js` — يجب أن يكون
   داخل `<head>` بمعايرة `ca-pub-5770911159315916`.
4. في AdSense ← إضافة الموقع ← الضغط على **«تحقق»** — يجد الكود فورًا.
5. (اختياري لتفعيل المساحات المرئية وسطر `ads.txt` معًا) ضبط بيئة Vercel:
   `NEXT_PUBLIC_ADSENSE_CLIENT=ca-pub-5770911159315916` + أرقام
   `NEXT_PUBLIC_ADSENSE_SLOT_*` — فتُبنى مساحات `components/AdSlot.tsx` وسطر
   `google.com` في `/ads.txt` تلقائيًا من نفس المعرّف. (سكربت الرأس يعمل افتراضيًا
   بلا بيئة؛ أما المساحات و`ads.txt` فتبقى محكومة بالبيئة عمدًا: الأولى تحتاج أرقام
   وحدات فعلية لا تُخترع، والثاني محمي باختبار يرفض نشر سطر بلا معرّف صريح.)
