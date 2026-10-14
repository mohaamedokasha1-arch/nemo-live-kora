import React from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  شعار NEMO Sports — **نقل حرفي لشعار الموقع المرجعي** (بلا أي إعادة رسم)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  المصدر الرسمي (الملفات الأصلية كما هي، بايتًا ببايت):
 *    • https://nemo-sports.vercel.app           → الموقع المرجعي
 *    • مستودعه: `mohaamedokasha1-arch/sport` → `nemo-sports/` (فرع main، الإصدار
 *      c715149d78da995602df5b0e353318cac1deb25b)
 *        – `brand/nemo-mark.svg`  (307 بايت، blob 4957b0b47e72918e7afa38b43d4afaffc9ca427e)
 *        – `brand/nemo-logo.svg`  (769 بايت، blob 265026dc07097b166f8e6d8f145991477e9a19fb)
 *        – `app/icon.svg`         (306 بايت، blob 375a8323c333b3ac9aebe348c8c518afafe8051b)
 *        – `components/brand/Logo.tsx` → الهيكل النصي المنقول هنا
 *
 *  الملفات الثلاثة منسوخة في المشروع **حرفيًا** (نفس البايتات، ونفس بصمة git blob):
 *    • `public/nemo-mark.svg`  → العلامة وحدها (لمن يحتاجها خارج الموقع).
 *    • `public/nemo-logo.svg`  → العلامة + الاسم (النسخة الأفقية الكاملة).
 *    • `app/icon.svg`          → أيقونة التبويب (favicon) الرسمية.
 *  و`tests/logo-branding.test.ts` يتحقّق من تطابق البايتات مع بصمات المصدر أعلاه،
 *  فلا يمكن أن ينحرف أي ملف لاحقًا بلا أن يسقط الاختبار.
 *
 *  الشكل: دربان (Pillars) + قُطر ذهبي يخرجهما — «لحظة الحركة: التمريرة، الاختراق،
 *  صافرة النهاية»، مع هيبة الناقل الرسمي. قواعد الهوية: بلا تدرّجات، بلا حدود
 *  خارجية (outline)، وبلا أي رموز رياضية مبتذلة (كرة، صافرة…).
 *
 *  ولماذا المكوّن وليس `<img>`؟
 *    • حِدّة مطلقة على كل الشاشات (العلامة أشكال متجهية تُعاد رسمها عند أي مقاس).
 *    • صفر طلبات شبكة وصفر احتمال خطأ 404 وصفر إزاحة تخطيط (CLS).
 *  أما الاسم «NEMO / Sports» فهو **نص حيّ** بخط الهوية نفسه — تمامًا كما في المكوّن
 *  الأصلي على الموقع المرجعي (`font-display` + تباعد 0.14em/0.34em)، فلا نستبدل
 *  الحروف برسوم مخترعة.
 *
 *  ملاحظة ألوان القُطر (مهم — وهي الفرق الوحيد بيننا وبين المكوّن الحيّ):
 *  في مكوّن الموقع المرجعي يُعرَّف القُطر في الوضعين `light`/`mono` بلون النص نفسه
 *  (`currentColor`) ولا يُعرَّف بالذهبي إلا في الوضع `brand`. ولون النص المتَوارَث في
 *  الموقع المرجعي هو لون المتن `--color-ink` = `#0f1b2e` (وضع فاتح) — أي **نفس لون
 *  خلفية الهيدر الداكنة** `--color-navy-850` الذي يقف عليه الشعار — فيختفي القُطر
 *  عمليًا هناك ولا يبقى من العلامة إلا دربان أبيضان.
 *  أما **ملفات الهوية الأصلية الثلاثة** (العلامة، الشعار الكامل، الأيقونة) فكلها
 *  تعرّف القُطر بالذهبي الرسمي `#D4AF37` — والأيقونة الرسمية تحديدًا هي دربان أبيضان
 *  على مربّع كحلي + قُطر ذهبي. لذلك نرسُم القُطر **بالذهبي الرسمي دائمًا** (وهو
 *  الشكل المقصود في ملفات الهوية المنشورة)، لا بـ`currentColor` الذي يُلغيه على
 *  خلفية داكنة. لم نُغيّر أيًّا من درجتي الذهبي: gold-500 هنا، وgold-700/600 في
 *  وضع «brand» كما في المكوّن الأصلي.
 *
 *  مواصفات النقل الحرفي من `Logo.tsx` الأصلي:
 *    • العلامة: `viewBox 0 0 48 48` — دربان `10×34` عند x=5 و x=33 (y=7)،
 *      والقُطر `polygon 7,41 15,41 41,7 33,7`.
 *    • الاسم: «NEMO» بوزن 700، `letter-spacing: 0.14em`، حجم = max(18, size × 0.62).
 *    • السطر الثاني: «Sports» بحروف كبيرة بوزن 600، `letter-spacing: 0.34em`،
 *      وبلون ذهبي `#D4AF37` (gold-500 في الوضع الفاتح / gold-700 في وضع الهوية).
 *    • المسافة بين العلامة والاسم: 10px — والاتجاه ltr دائمًا (الاسم لاتيني).
 */

/** منطقة رسم العلامة — كما في `brand/nemo-mark.svg` بالحرف. */
export const NEMO_MARK_VIEWBOX = '0 0 48 48';

/** الدربان الرأسيان (Bar) في العلامة — إحداثيات المصدر بالحرف. */
export const NEMO_MARK_PILLARS = [
  { x: 5, y: 7, width: 10, height: 34 },
  { x: 33, y: 7, width: 10, height: 34 },
] as const;

/** القُطر الذهبي الخارج من الإطار — إحداثيات المصدر بالحرف. */
export const NEMO_MARK_STRIKE_POINTS = '7,41 15,41 41,7 33,7';

/** منطقة رسم الشعار الكامل — كما في `brand/nemo-logo.svg` (320×96). */
export const NEMO_LOGO_VIEWBOX = '0 0 320 96';

/** لوحة الهوية الرسمية (من ملفات المصدر الثلاثة + رموز الوضع في globals.css). */
export const NEMO_BRAND_COLORS = {
  /** `#0F1B2E` — كحلي الهوية: الدربان على الخلفية الفاتحة وخلفية الأيقونة. */
  navy: '#0F1B2E',
  /** `#FFFFFF` — الدربان على الخلفية الداكنة. */
  white: '#FFFFFF',
  /** `#D4AF37` — الذهبي الرسمي للقُطر (gold-500). */
  gold: '#D4AF37',
  /** `#B8912C` — الذهبي العميق المستخدم لكلمة SPORTS في الملف القائم بذاته (gold-600). */
  goldDeep: '#B8912C',
  /** `#856515` — gold-700: ذهبي «SPORTS» في وضع الهوية على الخلفية الفاتحة. */
  goldStrong: '#856515',
  /** `#5D6B7F` — رمادي النص في وضع الهوية (muted). */
  muted: '#5D6B7F',
} as const;

/** أنصاف أطوال الاسم — منقولة من المكوّن الأصلي حرفيًا. */
export const NEMO_LOGO_TRACKING_WORD = '0.14em';
export const NEMO_LOGO_TRACKING_SUB = '0.34em';

export type NemoLogoTone = 'light' | 'brand' | 'mono';

export interface NemoMarkProps {
  /** طول ضلع العلامة بالبكسل. */
  size?: number;
  /** الوضع اللوني: `light` للخلفيات الداكنة، `brand` للفاتحة، `mono` لون النص. */
  tone?: NemoLogoTone;
  /** نص بديل لقارئات الشاشة — عند غيابه تُعامل العلامة كعنصر زخرفي. */
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * العلامة وحدها (دربان + قُطر). الأشكال هنا مطابقة لإحداثيات `brand/nemo-mark.svg`
 * بالحرف، ويراقب هذا التطابق اختبار آلي.
 */
export function NemoMark({ size = 38, tone = 'light', title, className, style }: NemoMarkProps) {
  const decorative = !title;
  // منطق الأصل: الوضع الفاتح ⇒ أبيض صريح؛ وضعا الهوية والأحادي ⇒ لون النص المحيط.
  const pillarColor = tone === 'light' ? NEMO_BRAND_COLORS.white : 'currentColor';
  // القُطر: الذهبي الرسمي في الوضعين فاتح/هوية (كما في ملفات الهوية المنشورة)،
  // ولون النص في الوضع الأحادي. لا تدرّجات ولا لون ثالث.
  const strikeColor = tone === 'mono' ? 'currentColor' : NEMO_BRAND_COLORS.gold;

  return (
    <svg
      viewBox={NEMO_MARK_VIEWBOX}
      width={size}
      height={size}
      className={className}
      style={style}
      shapeRendering="geometricPrecision"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={title}
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      {NEMO_MARK_PILLARS.map((pillar) => (
        <rect
          key={pillar.x}
          x={pillar.x}
          y={pillar.y}
          width={pillar.width}
          height={pillar.height}
          fill={pillarColor}
        />
      ))}
      <polygon points={NEMO_MARK_STRIKE_POINTS} fill={strikeColor} />
    </svg>
  );
}

export interface NemoLogoProps {
  /** طول ضلع العلامة بالبكسل (والاسم يُحسب منها بنِسب المكوّن الأصلي). */
  size?: number;
  /** اسم قديم لنفس القيمة — مُبقى للتوافق مع نداءات سابقة في الهيدر. */
  height?: number;
  tone?: NemoLogoTone;
  /** سطر «Live Sports, Every Moment» — يظهر في المكوّن الأصلي على الشاشات الواسعة. */
  tagline?: boolean;
  /** نص بديل للشعار كاملًا. عند غيابه يُعامل كعنصر زخرفي (والنص المجاور يشرحه). */
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * الشعار الكامل: العلامة + «NEMO» + «Sports» — نقل حرفي للمكوّن الأصلي.
 * المقاسات الافتراضية من الموقع المرجعي نفسه: 38 في الهيدر، و40 في الفوتر.
 */
export default function NemoLogo({
  size,
  height,
  tone = 'light',
  tagline = false,
  title,
  className,
  style,
}: NemoLogoProps) {
  const markSize = size ?? height ?? 34;
  // نِسب المكوّن الأصلي بالحرف: max(18, size × 0.62) للاسم، و0.62rem للسطر الثاني
  // (نتحفّظ على النسبة عند تغيير المقاس حتى لا تتغيّر النسب).
  const wordSize = Math.max(18, markSize * 0.62);
  const subSize = markSize * (9.92 / 38);
  const decorative = !title;

  return (
    <span
      className={['kl-nemo-logo', `kl-nemo-logo--${tone}`, className].filter(Boolean).join(' ')}
      style={style}
      dir="ltr"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={title}
    >
      <NemoMark size={markSize} tone={tone} className="kl-nemo-mark" />
      <span className="kl-nemo-words">
        <span
          className="kl-nemo-word"
          style={{ fontSize: `var(--kl-logo-word, ${wordSize}px)` }}
        >
          NEMO
        </span>
        <span className="kl-nemo-sub" style={{ fontSize: `var(--kl-logo-sub, ${subSize}px)` }}>
          Sports
        </span>
      </span>
      {tagline ? (
        <span className="kl-nemo-tagline">
          Live Sports,
          <br />
          Every Moment
        </span>
      ) : null}
    </span>
  );
}
