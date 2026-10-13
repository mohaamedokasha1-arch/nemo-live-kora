# محرّك المباريات التلقائي والبيانات المنظمة (Automated Match Engine + SportsEvent SEO)

> آخر تحديث: 13 أكتوبر 2026 — هذا المستند يشرح كيف تُضيف مباراة واحدة فيتولّد كل شيء تلقائيًا،
> وكيف تُغلق أخطاء Google Search Console الخاصة بـ SportsEvent، وكيف تُفعّل الإعلانات و ads.txt.

---

## 1) إضافة مباراة جديدة في خطوة واحدة

افتح `data/matches.ts` وأضف كائنًا واحدًا إلى المصفوفة `MATCH_CATALOG` (انسخ النموذج
`MATCH_CATALOG_TEMPLATE` الموجود في نفس الملف). بمجرد النشر يُنتج النظام تلقائيًا:

| المخرج | المسار / المكان |
| --- | --- |
| صفحة هبوط كاملة الكلمات المفتاحية | `/matches/[id]` |
| صفحة بث داخلية + زر المشاهدة | `/live/[id]` |
| بيانات SportsEvent منظمة كاملة | داخل `<script type="application/ld+json">` في صفحة الهبوط |
| رابط في خريطة الموقع مع توقيت آخر تحديث | `/sitemap.xml` |
| بطاقة في الصفحة الرئيسية + قسم «بوابة المباريات» | `/` |
| ربط بطاقات الجدول بصفحة الهبوط | `/matches/YYYY-MM-DD` |

**قواعد إلزامية** (يتحقق منها `validateMatchCatalogEntry` واختبارات المشروع):

- `kickoffUtc` بصيغة ISO 8601 بتوقيت UTC، و`cairoDate` مطابق فعلًا لتوقيت القاهرة المحسوب منه.
- `broadcast.url` **ممنوع** إلا عندما تكون `broadcast.status` من نوع `verified_*`.
- 3 كلمات مفتاحية على الأقل، و`venue.countryCode` لأي مباراة في ملعب.
- `durationMinutes` بين 30 و300 دقيقة (منها يُحسب `endDate`).

---

## 2) الحقول التي كانت تُنتج الأخطاء… وكيف تم حلها

| حقل Search Console | المصدر في الكود | ملاحظات التوليد |
| --- | --- | --- |
| `location` مفقود/غير صالح | `entry.venue` | `Place` باسم الاستاد + `PostalAddress` (المدينة + `addressCountry`)، و`VirtualLocation` عند البث أونلاين، ومصفوفة الاثنين للمباريات الهجينة |
| `description` مكرر أو قصير | `buildMatchDescription()` | وصف ديناميكي فريد لكل مباراة (الفريقان + البطولة + الجولة + الموعد + الملعب + الحالة) |
| `performer` مفقود | `entry.homeTeam/awayTeam` | عقدتا `SportsTeam` بالكامل (الاسم عربي + إنجليزي + الشعار + الدولة)، وتُكرَّر في `competitor` |
| `organizer` مفقود | `entry.competition` | عقدة `SportsOrganization` باسم البطولة ورابطها الرسمي |
| `startDate`/`endDate` بصيغة خاطئة | `kickoffUtc` + `durationMinutes` | ISO 8601 **مع إزاحة القاهرة الفعلية** (`+02:00` شتاءً و`+03:00` صيفًا) عبر `toCairoIsoWithOffset` |
| `offers` مفقود أو ناقص | `entry.broadcast` | كائن `Offer` يحمل `url` (رابط المشاهدة) و`price: "0"` و`priceCurrency` و`availability: InStock` و`validFrom` و`seller` |
| `eventStatus` غير صالح | `toSchemaEventStatus()` | ترجمة تلقائية للحالة إلى قيم Schema.org المعتمدة فقط |
| «صفحة قائمة تحتوي حدثًا» | `lib/seo/match-structured-data.ts` | صفحات الجداول تُخرج `ItemList` يربط بصفحة الحدث المعيارية، والبيانات المنظمة الكاملة في صفحة الهبوط فقط |

### جدول تحويل حالة المباراة

| حالة الكود (`status`) | `eventStatus` | ملاحظة |
| --- | --- | --- |
| `scheduled` / `live` / `finished` / `suspended` | `EventScheduled` | المباراة تُقام كما هو مخطط؛ «جارية الآن» تُعرض نصيًا وفي خريطة الموقع |
| `postponed` | `EventPostponed` | |
| `cancelled` | `EventCancelled` | يبقى `startDate` و`location` في البيانات (شرط صريح من Google) |
| تجاوز يدوي `schema.eventStatusOverride` | أي قيمة معتمدة | مثل `EventRescheduled` أو `EventMovedOnline` — أي قيمة غير معتمدة تُتجاهل |

> ⚠️ **EventLive ليست قيمة معتمدة في Schema.org.** استخدامها يُنتج خطأ «Invalid enum value».
> للتغيير اليدوي فقط: `schema.eventStatusOverride: 'EventMovedOnline'` داخل المباراة.

---

## 3) حالة المباراة الصادقة (لا نتائج ولا بث من الظن)

- الحالة والنتيجة تُدمجان من سجل المصدر الحقيقي (`data/gateway-store.json`) إذا وُجد تطابق
  بمعرّفات دقيقة (`thesportsdbEventId` / `apiFootballFixtureId` / `score slug` / الربط الأربعي).
- لا سجل مصدر؟ لا ندّعي «جارية الآن» أبدًا: نعرض «لم تبدأ» أو «غير مؤكدة» مع سبب واضح للزائر.
- `broadcast.url` لا يُنشر إلا بعد التحقق، وإلا تعرض صفحة البث توضيحًا صريحًا للزائر
  بدل فتح رابط عام أو صفحة مباراة أخرى.

---

## 4) الفهرس والوسوم المعيارية

| الصفحة | canonical | robots |
| --- | --- | --- |
| `/` | `/` | `index, follow` |
| `/matches/YYYY-MM-DD` | `/` لليوم، وإلا `/matches/YYYY-MM-DD` | تُفهرس فقط إذا كان اليوم يحتوي مباريات |
| `/matches/[id]` (هبوط المباراة) | `/matches/[id]` | `index` إذا اجتاز السجل التحقق، وإلا `noindex` |
| `/live/[id]` (صفحة البث) | `/live/[id]` | `noindex, follow` (تجنّب تكرار المحتوى + تمرير الإشارات داخليًا) |
| `/privacy-policy` `/terms` `/about` `/contact` | مسار الصفحة نفسه | `index, follow` |

`metadataBase` مضبوط في `app/layout.tsx`، والوسم المعياري يُضبط **لكل صفحة على حدة** —
وليس في التخطيط العام — حتى لا تشير صفحات الأخبار أو الصفحات القانونية إلى الصفحة الرئيسية بالخطأ.

---

## 5) تهيئة الإعلانات + ads.txt

1. ضع معرّف الناشر: `NEXT_PUBLIC_ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX`
   - يُضاف وسم `google-adsense-account` ويُحمَّل سكربت AdSense بنمط `afterInteractive`.
   - يتحوّل `/ads.txt` تلقائيًا إلى: `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`.
2. شبكات أخرى: `ADS_TXT_LINES="domain, id, DIRECT[, cert]"` (مفصولة بـ `;` أو سطر جديد).
   الأسطر غير الصالحة تُنشر كتعليق مع سبب الرفض بدل كسر الملف.
3. المساحات الإعلانية: مكوّن `components/AdSlot.tsx` بحجز ارتفاع ثابت (بدون إزاحة تخطيط)،
   ويظهر في صفحة الهبوط وصفحة البث. بدون متغيرات البيئة يظهر بديل محايد بلا أي طلب خارجي.
4. الصفحات القانونية المطلوبة للقبول موجودة ومربوطة في التذييل: سياسة الخصوصية (بما فيها
   كوكيز DoubleClick DART وروابط إلغاء التخصيص)، الشروط، من نحن، اتصل بنا.
5. صورة المشاركة الافتراضية: `public/og-cover.jpg` (1200×675).

---

## 6) كيف تتحقق أن كل شيء سليم قبل النشر؟

```bash
npm test          # 78 اختبارًا تشمل المحرّك والبيانات المنظمة و ads.txt و sitemap
npm run lint      # ESLint بدون أخطاء
npm run build     # بناء الإنتاج + فحص الأنواع
```

ثم بعد النشر:

1. `https://<domain>/ads.txt` — يجب أن يظهر سطر الشبكة.
2. `https://<domain>/robots.txt` و`https://<domain>/sitemap.xml` — تأكّد من ظهور روابط المباريات.
3. Rich Results Test على صفحة هبوط مباراة → يجب أن يظهر `SportsEvent` بدون حقول ناقصة.
4. أعد إرسال `sitemap.xml` من Search Console، وراقب تقرير «البيانات المنظمة» و«الأحداث».

---

## 7) الملفات المعنية

```
data/matches.ts                     ← الملف المركزي: أضف المباريات هنا
lib/matches/types.ts               ← أنواع سجلات الكتالوج والرؤية المدمجة
lib/matches/match-links.ts         ← أدوات المسارات الربط (client-safe)
lib/matches/match-catalog.ts       ← الدمج مع المصادر + التحقق + مدخلات sitemap
lib/seo/sports-event.ts            ← مولّد SportsEvent كامل الحقول + BreadcrumbList
lib/seo/metadata.ts                ← الوسوم المعيارية و OG لكل نوع صفحة
lib/seo/match-structured-data.ts   ← ItemList لصفحات الجداول
components/SportsEventJsonLd.tsx   ← إدراج JSON-LD في صفحة الهبوط
components/MatchLandingView.tsx    ← واجهة صفحة الهبوط + CTA
components/LiveBroadcastView.tsx   ← واجهة صفحة البث الداخلية
components/AdSlot.tsx              ← مساحات إعلانية جاهزة بحجز الارتفاع
app/matches/[id]/page.tsx          ← مسار موحّد: جدول تاريخ أو صفحة هبوط مباراة
app/live/[matchId]/page.tsx        ← صفحة البث الداخلية (noindex, follow)
app/sitemap.ts • app/robots.ts • app/ads.txt/route.ts
```
