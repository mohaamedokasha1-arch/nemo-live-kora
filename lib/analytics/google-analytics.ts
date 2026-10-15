/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Google Analytics 4 (وسم gtag.js) — مصدر واحد للحقيقة
 * ═══════════════════════════════════════════════════════════════════════════════
 *  طلب صاحب المنتج (2026-10-15): إضافة كود Google Analytics في **كل صفحات** البوابة،
 *  مباشرةً بعد وسم `<head>` — لمتابعة الزيارات.
 *
 *  هذا الملف هو **المكان الوحيد** الذي يُكتب فيه معرّف القياس (`G-…`) ونطاق تحميل
 *  مكتبة gtag.js. المكوّنات (`components/GoogleAnalytics*.tsx`) والتخطيط العام لا
 *  يعرفون أي معرّف بأنفسهم، بل يستوردون من هنا — فلا يمكن أن يبقى معرّف قديم في
 *  موضع ويُحدَّث الجديد في موضع آخر، ولا أن يختلف ما يراه الخادم عمّا يراه المتصفح.
 *
 *  لماذا تُقرأ البيئة داخل الدوال لا في ثوابت عليا؟
 *  نفس سبب `lib/ads/adsterra.ts`: نُبقي الملف قابلًا للاختبار (إيقاف الوسم أو تبديل
 *  المعرّف لحظيًا في الاختبارات) بلا إعادة تحميل الوحدة، ولأن
 *  `process.env.NEXT_PUBLIC_*` يُستبدل نصًّا وقت البناء في طبقتَي الخادم والعميل
 *  بالقيمة نفسها فتبقى النتيجة متطابقة ولا يحدث اختلاف ترطيب.
 *
 *  مفاتيح التبديل (اختيارية — الوسم يعمل من أول نشر بلا أي إعداد):
 *    NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX  ← استبدال معرّف القياس دون تعديل كود.
 *    NEXT_PUBLIC_GA_ENABLED=off                  ← إيقاف الوسم كاملًا (لا سكربت ولا طلب).
 *  والقيمة الافتراضية: **مفعّل** بالمعرّف المتفق عليه، بنفس سياسة وحدات Adsterra.
 */

/** معرّف القياس المتفق عليه مع صاحب المنتج (2026-10-15) — الافتراضي عند عدم ضبط البيئة. */
export const DEFAULT_GA_MEASUREMENT_ID = 'G-HH8N3QCBFV';

/** نطاق تحميل مكتبة gtag.js. */
export const GA_SCRIPT_HOST = 'www.googletagmanager.com';

/** نطاق استقبال القياس (beacon) الذي ترسله المكتبة لاحقًا. */
export const GA_COLLECT_HOST = 'www.google-analytics.com';

/**
 * نطاقات Google Analytics — تُستخدم في `dns-prefetch` فقط (بلا تنزيل ولا اتصال مسبق)،
 * فتُحلّ الأسماء قبل أن يطلب المتصفح السكربت ويُرسل القياس.
 */
export const GA_HOSTS: readonly string[] = [GA_SCRIPT_HOST, GA_COLLECT_HOST];

/** قيم تُفسَّر كإيقاف صريح للمفتاح. نفس مجموعة `lib/ads/adsterra.ts` عن قصد. */
const OFF_VALUES = new Set(['off', 'false', '0', 'no', 'disabled']);

/**
 * صيغة معرّف GA4 المعتمدة: `G-` ثم أحرف لاتينية كبيرة/أرقام.
 *
 * لماذا التحقق إلزامي هنا وليس ترفًا؟
 * معرّف القياس يُدرَج نصًّا داخل **محتوى سكربت داخلي** (`<script>…</script>`)، وهو
 * موضع لا يُهرَّب فيه HTML. فقيمة بيئة مكتوبة خطأً أو مزوّرة (مثلًا تحتوي `</script>`)
 * كانت تستطيع كسر الوسم أو حقن سكربت آخر. حصرُ القيمة في هذه الصيغة يجعل الحقن
 * مستحيلًا بنيويًا، لا مجرد مرفوض بالفحص.
 */
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,32}$/;

/** هل الوسم مفعّل الآن؟ (المفتاح الرئيسي فقط — دون النظر في صحّة المعرّف.) */
export function isGoogleAnalyticsEnabled(): boolean {
  const master = (process.env.NEXT_PUBLIC_GA_ENABLED || 'on').trim().toLowerCase();
  return !OFF_VALUES.has(master);
}

/**
 * معرّف القياس الفعّال بعد التحقق من الصيغة.
 * تُرجع `null` إذا كانت القيمة المضبوطة في البيئة غير صالحة — فلا يُرسم وسم واحد
 * بدل أن يُرسل قياس إلى معرّف خاطئ (الفشل الصريح أفضل من نجاح وهمي).
 */
export function resolveGaMeasurementId(): string | null {
  const configured = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '').trim().toUpperCase();
  const candidate = configured || DEFAULT_GA_MEASUREMENT_ID;
  return MEASUREMENT_ID_PATTERN.test(candidate) ? candidate : null;
}

/**
 * هل يجب رسم وسوم Google Analytics في هذه الصفحة؟
 * شرطان معًا: المفتاح الرئيسي مفعّل + معرّف صالح. غير ذلك ⇒ لا أثر في HTML إطلاقًا.
 */
export function isGoogleAnalyticsActive(): boolean {
  return isGoogleAnalyticsEnabled() && resolveGaMeasurementId() !== null;
}

/** رابط تحميل مكتبة gtag.js — يُبنى من المعرّف نفسه فلا يمكن أن ينفصل عنه. */
export function buildGaScriptUrl(measurementId: string): string {
  return `https://${GA_SCRIPT_HOST}/gtag/js?id=${measurementId}`;
}

/**
 * نص السكربت الداخلي (الإعداد) — الكود المتفق عليه حرفيًا من صاحب المنتج:
 *
 *   window.dataLayer = window.dataLayer || [];
 *   function gtag(){dataLayer.push(arguments);}
 *   gtag('js', new Date());
 *   gtag('config', 'G-…');
 *
 * ويعمل حتى لو وصلت مكتبة gtag.js متأخّرة أو لم تُحمَّل بعد: الأوامر تُكدَّس في
 * `dataLayer` وتُفرَّغ فور تحميل المكتبة (وهذا هو سبب وجود الطابور أصلًا في الوسم
 * الرسمي)، فلا تفقد أول صفحة مشاهدة بسبب ترتيب التحميل.
 */
export function buildGaInlineSnippet(measurementId: string): string {
  return [
    'window.dataLayer = window.dataLayer || [];',
    'function gtag(){dataLayer.push(arguments);}',
    "gtag('js', new Date());",
    `gtag('config', '${measurementId}');`,
  ].join('\n');
}

/**
 * هل يُرسل حدث صفحة مشاهدة للمسار الجديد؟
 *
 * التنقّل داخل Next.js (App Router) لا يُعيد تحميل المستند، فوسم `config` يُرسل
 * **صفحة واحدة فقط** (صفحة الدخول) مهما تنقّل الزائر بعدها. لذلك يُرسل المكوّن
 * `components/GoogleAnalyticsPageViews.tsx` حدث `page_view` عند كل تغيّر مسار.
 *
 * القاعدة هنا تفصل الحالتين بدقة:
 *   • `previous === null`  ⇒ هذه أول مرة يعمل فيها الأثر (صفحة الدخول) و`config` أرسلها
 *     بالفعل ⇒ **لا إرسال** (وإلا سُجّلت أول صفحة مرتين وتضخّمت الأرقام).
 *   • `previous === current` ⇒ إعادة رسم بلا تنقّل (نفس المسار) ⇒ **لا إرسال**.
 *   • غير ذلك ⇒ تنقّل حقيقي ⇒ **إرسال**.
 */
export function shouldTrackGaPageView(previousUrl: string | null, currentUrl: string): boolean {
  if (previousUrl === null) return false;
  return previousUrl !== currentUrl;
}

/** بيانات حدث صفحة المشاهدة المرسَل عند التنقّل الداخلي. */
export interface GaPageViewPayload {
  /** المسار مع سلسلة الاستعلام، مثال: `/news?page=2` */
  pagePath: string;
  /** العنوان الكامل كما يظهر في شريط المتصفح. */
  pageLocation: string;
  /** عنوان المستند لحظة الإرسال. */
  pageTitle: string;
  measurementId: string;
}

/** أمر gtag لحدث صفحة مشاهدة واحد — دالة نقية قابلة للاختبار بمعزل عن المتصفح. */
export function buildGaPageViewCommand(
  payload: GaPageViewPayload
): readonly [string, string, Record<string, string>] {
  return [
    'event',
    'page_view',
    {
      page_path: payload.pagePath,
      page_location: payload.pageLocation,
      page_title: payload.pageTitle,
      send_to: payload.measurementId,
    },
  ];
}

/**
 * دالة gtag العامة التي يعرّفها السكربت الداخلي في نطاق النافذة.
 * تُعلن هنا مرة واحدة حتى لا يستخدم أي ملف آخر `any` أو تحويلًا غير آمن.
 */
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}
