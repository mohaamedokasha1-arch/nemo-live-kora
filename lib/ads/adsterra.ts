/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Adsterra — مصدر واحد للحقيقة لكل الوحدات الإعلانية (Server + Client)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  كل معرّف (key) وكل عنوان سكربت في الموقع كله موجود هنا **مرة واحدة فقط**.
 *  المكوّنات (components/Adsterra*.tsx) لا تعرف أي مفتاح ولا أي رابط بنفسها، بل
 *  تستورد من هنا — فلا يمكن أن يتسرّب مفتاح قديم في مكان وتُحدَّث النسخة الجديدة
 *  في مكان آخر، ولا أن يظهر اختلاف بين ما يراه الخادم وما يراه المتصفح.
 *
 *  لماذا ملف عادي بلا `'use client'`؟
 *  لأن مكوّنات الخادم (الصفحات) تحتاج قراءة الحالة **قبل** إرسال أي شيء إلى
 *  المتصفح، ولأن `process.env.NEXT_PUBLIC_*` تُستبدل وقت البناء في الطبقتين
 *  بالقيمة نفسها، فتبقى النتيجة متطابقة. وهذا الملف يقرأ البيئة **داخل الدوال**
 *  لا في ثوابت عليا، حتى يبقى قابلًا للاختبار (إيقاف الإعلانات لحظيًا) دون إعادة
 *  تحميل الوحدة.
 *
 *  مفاتيح التبديل (اختيارية، كلها لا تحتاج أي إعداد ليعمل الموقع):
 *    NEXT_PUBLIC_ADSTERRA_ENABLED=off          ← مفتاح رئيسي: يوقف كل وحدات Adsterra.
 *    NEXT_PUBLIC_ADSTERRA_DISABLED_FORMATS="popunder,socialbar"  ← إيقاف وحدات بعينها.
 *    NEXT_PUBLIC_ADSTERRA_SMARTLINK_URL=...    ← استبدال رابط السمارت لينك دون تعديل كود.
 *  القيمة الافتراضية: **مفعّلة**. أي إعلان جديد يظهر فورًا في الإنتاج بلا خطوة نشر،
 *  ويمكن للمشغّل إيقاف أي وحدة (أو كلها) بمتغير بيئة واحد من لوحة Vercel.
 */

/** كل وحدات Adsterra المدمجة في الموقع. */
export type AdsterraFormat =
  | 'popunder'
  | 'socialbar'
  | 'banner300'
  | 'banner728'
  | 'native'
  | 'smartlink';

/** قيم تُفسَّر كإيقاف صريح للمفتاح. */
const OFF_VALUES = new Set(['off', 'false', '0', 'no', 'disabled']);

/**
 * هل هذه الوحدة مفعّلة الآن؟
 *
 * يُقرأ المتغير في كل نداء (لا في ثابت أعلى الملف) لسببين:
 *  1) الاختبارات تتحقق من مسار الإيقاف فعليًا برسم المكوّن بعد ضبط المتغير.
 *  2) `process.env.NEXT_PUBLIC_*` يُستبدل نصًّا في حزمة العميل وفي حزمة الخادم معًا،
 *     فتبقى النتيجة واحدة في المكانين ولا يحدث اختلاف ترطيب (hydration mismatch).
 */
export function isAdsterraFormatEnabled(format: AdsterraFormat): boolean {
  const master = (process.env.NEXT_PUBLIC_ADSTERRA_ENABLED || 'on').trim().toLowerCase();
  if (OFF_VALUES.has(master)) return false;

  const disabled = (process.env.NEXT_PUBLIC_ADSTERRA_DISABLED_FORMATS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return !disabled.includes(format);
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  ① Popunder — إعلان منبثق مرة واحدة في الزيارة
 *     يُحمَّل من <head> بالاستراتيجية afterInteractive (لا يعطّل أول رسم للصفحة).
 * ───────────────────────────────────────────────────────────────────────────── */
export const ADSTERRA_POPUNDER_SCRIPT_URL =
  'https://furydonkeypharmacy.com/45/91/b9/4591b9d89acaef4816e3858fcdd4fb8c.js';

/* ─────────────────────────────────────────────────────────────────────────────
 *  ② Smartlink — الرابط الذكي (تحويل مباشر بعمولة)
 *     يُربط بأزرار التحويل في صفحات المباريات وفي بطاقات الصفحة الرئيسية،
 *     دائمًا **إلى جوار** زر المشاهدة الرسمي لا بدلًا منه، وبوسم sponsored/nofollow.
 * ───────────────────────────────────────────────────────────────────────────── */
export const DEFAULT_ADSTERRA_SMARTLINK_URL =
  'https://furydonkeypharmacy.com/c71f0nh0?key=e98ed29e685da7d0f646c6adf71e66a7';

/** الرابط الفعّال للسمارت لينك (مع إمكانية استبداله بالبيئة دون نشر كود جديد). */
export function resolveAdsterraSmartlinkUrl(): string {
  return (process.env.NEXT_PUBLIC_ADSTERRA_SMARTLINK_URL || '').trim() || DEFAULT_ADSTERRA_SMARTLINK_URL;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  ③ Social Bar — الشريط الاجتماعي (يظهر خفيفًا أسفل الشاشة خلال التنقّل)
 *     يُحمَّل من نهاية <body> بالاستراتيجية lazyOnload: لا ينافس أي عنصر أساسي.
 * ───────────────────────────────────────────────────────────────────────────── */
export const ADSTERRA_SOCIAL_BAR_SCRIPT_URL =
  'https://furydonkeypharmacy.com/40/0b/61/400b61ec64c579e1e11e27f80157c8fc.js';

/* ─────────────────────────────────────────────────────────────────────────────
 *  ④ Native Banner — إعلان مدمج يظهر كأنه محتوى طبيعي
 *     المعرّف نفسه يُستخدم في حاوية الـ DOM وفي مسار السكربت، ويُبنى من مصدر واحد
 *     حتى لا يحدث انفصال بين الاثنين عند تغيير الوحدة مستقبلًا.
 * ───────────────────────────────────────────────────────────────────────────── */
const ADSTERRA_NATIVE_KEY = '23d4da70cd556e8aef8683f8494212bb';

/** حاوية الـ Native Banner — يجب أن تظهر **مرة واحدة** في كل صفحة (معرّف HTML فريد). */
export const ADSTERRA_NATIVE_CONTAINER_ID = `container-${ADSTERRA_NATIVE_KEY}`;

export const ADSTERRA_NATIVE_SCRIPT_URL = `https://furydonkeypharmacy.com/${ADSTERRA_NATIVE_KEY}/invoke.js`;

/* ─────────────────────────────────────────────────────────────────────────────
 *  ⑤ البانر المربع 300×250 و ⑥ البانر العريض 728×90
 *     صيغة Adsterra للبانرات الثابتة تعتمد متغيّرًا عامًا (atOptions) يُضبط **قبل**
 *     تحميل سكربت الوحدة. وجود أكثر من بانر في الصفحة نفسها بمفاتيح مختلفة يعني
 *     تسابقًا على المتغيّر العام نفسه: آخر بانر يضبطه هو الذي يُقرأ للمواقع كلها.
 *     الحل المُنفَّذ (وهو الممارسة المعتمدة في تطبيقات React): كل بانر يعيش داخل
 *     مستند معزول صغير (iframe) — فيصبح لكل وحدة `atOptions` خاص بها، ويبقى
 *     `document.write` الذي يستخدمه سكربت الشبكة يعمل كما يعمل في صفحة عادية.
 *     الفائدة الثانية: السكربت الخارجي لا يوقف قراءة الصفحة الرئيسية إطلاقًا.
 * ───────────────────────────────────────────────────────────────────────────── */
export interface AdsterraBannerUnit {
  readonly format: AdsterraFormat;
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /** رابط تحميل الوحدة — يُبنى من المفتاح نفسه فلا يمكن أن يختلف عنه. */
  readonly invokeUrl: string;
}

function buildIframeBannerUnit(key: string, width: number, height: number): AdsterraBannerUnit {
  return {
    format: width >= 728 ? 'banner728' : 'banner300',
    key,
    width,
    height,
    invokeUrl: `https://www.highrevenueformat.com/${key}/invoke.js`,
  };
}

/** 300×250 — فوق زر البث المباشر وتحته، وفي المساحات الجانبية. */
export const ADSTERRA_BANNER_300X250 = buildIframeBannerUnit(
  '701dbec926e94a740a37b7a03d152b5f',
  300,
  250
);

/** 728×90 — شريط أعلى الصفحة على شاشات الكمبيوتر والأجهزة الكبيرة فقط. */
export const ADSTERRA_BANNER_728X90 = buildIframeBannerUnit(
  'd3ac0adacd0e9f8455c8174e938a797a',
  728,
  90
);

/** كل نطاقات الشبكة التي تتصل بها الصفحة — تُستخدم في dns-prefetch فقط (بلا تنزيل). */
export const ADSTERRA_HOSTS: readonly string[] = [
  'furydonkeypharmacy.com',
  'www.highrevenueformat.com',
];
