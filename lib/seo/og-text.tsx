import React from 'react';
import { OG_FONT_FAMILY, sanitizeOgText } from './og-image';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  عرض النص العربي داخل بطاقات next/og — الحل النهائي المُختبَر
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  المشكلة (مُقاسة فعليًا على هذا المشروع، وليست نظرية):
 *  محرّك Satori المستخدم في `next/og` يخطئ في قياس المسافة (U+0020) داخل أي نص يحتاج
 *  معالجة ثنائية الاتجاه. عند حجم خط 32px:
 *     • نص لاتيني «باب باب …» → فجوة 11px  (صحيحة)
 *     • نص عربي  «باب باب …» → فجوة 26px  (خطأ: +0.5em مسافة وهمية لكل فراغ)
 *  والزيادة تتناسب طرديًا مع حجم الخط (16px→+8px، 64px→+32px)، فتبدو البطاقة العربية
 *  كأن كلماتها موزّعة على العرض (justify) بشكل غير احترافي.
 *
 *  الحلول التي جُرّبت وفشلت:
 *     ✗ `whiteSpace: nowrap` و`unicodeBidi` و`textAlign` — لا تأثير.
 *     ✗ استخدام U+00A0 (مسافة غير فاصلة): يصلح التباعد لكنه **يعطّل خوارزمية
 *       Bidi داخل Satori تمامًا**، فينقلب ترتيب الكلمات رأسًا على عقب
 *       («الثلاثاء، ٢٠ أكتوبر» تصبح «الثلاثاء، ٢٠ أكتوبر» بترتيب معكوس فعليًا).
 *
 *  الحل المعتمد: تفكيك النص إلى **كلمات كعناصر flex مستقلة** داخل صف
 *  `flexDirection: 'row-reverse'` مع `gap` صريح:
 *     • الترتيب: row-reverse تعيد إنتاج ترتيب القراءة العربي بدقة (مُختبَر بصريًا على
 *       تدرّج من كلمة قصيرة إلى كلمة طويلة).
 *     • التباعد: يأتي من `gap` بالمُقاس المطلوب بدل مسافة Satori المعطوبة.
 *     • لا توجد مسافات نصية على الإطلاق، فلا يوجد خطأ أصلاً.
 *
 *  ⚠️ لا تستخدم `direction: 'rtl'` وحدها لترتيب صفوف flex في Satori — فهي لا تُعيد
 *  ترتيب الأبناء، ويبقى العنصر الأول على اليسار. استخدم `row-reverse` صريحًا.
 */

const WORD_GAP = 8;

/** نطاقات المحارف العربية في Unicode — لتحديد اتجاه النص تلقائيًا. */
const ARABIC_CHAR = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;

/**
 * هل يحتاج هذا النص ترتيبًا من اليمين إلى اليسار؟
 * تُكتشف العربية تلقائيًا، فيبقى النص اللاتيني (مثل «NEMO Sports») بترتيبه الطبيعي
 * من اليسار لليمين بلا انعكاس — وهو خطأ وقعنا فيه عند عكس كل النصوص دون تمييز.
 */
export function isRtlText(value: string): boolean {
  return ARABIC_CHAR.test(value);
}

export interface OgTextProps {
  children: string;
  /** المسافة بين الكلمات بالبكسل. الافتراضي مضبوط لمقاس 32px من خط Cairo. */
  gap?: number;
  /** الحد الأقصى لطول النص قبل الاقتصاص بعلامة (…) — يمنع تجاوز حدود البطاقة. */
  maxLength?: number;
  /** `right` لبداية القراءة العربية، و`center` للنصوص المتوسّطة كأسماء الفرق. */
  align?: 'right' | 'center';
  /** إجبار الاتجاه بدل الاكتشاف التلقائي (نادرًا ما يُحتاج). */
  direction?: 'rtl' | 'ltr';
  /**
   * السماح بالتفاف الكلمات على عدة أسطر (مع محاذاة مركزية).
   * استخدمه فقط داخل حاوية بعرض صريح، لأن الالتفاف يحتاج عرضًا معروفًا مسبقًا.
   */
  wrap?: boolean;
  style?: React.CSSProperties;
}

/**
 * نص عربي (أو مختلط) يُعرض بترتيب وتباعد صحيحين مهما كان طوله أو حجم خطه.
 * كل كلمة عنصر flex مستقل — أي أن النص كله في سطر واحد ولا يلتفّ افتراضيًا،
 * لذلك يجب ضبط `maxLength` بما يناسب عرض البطاقة.
 */
export function OgText({
  children,
  gap = WORD_GAP,
  maxLength = 120,
  align = 'right',
  direction,
  wrap = false,
  style,
}: OgTextProps) {
  const text = sanitizeOgText(children, maxLength);
  const words = text.split(' ').filter((word) => word.length > 0);
  const rtl = direction ? direction === 'rtl' : isRtlText(text);

  return (
    <div
      style={{
        display: 'flex',
        // العربية: row-reverse تُعيد ترتيب الكلمات من اليمين (ترتيب القراءة الصحيح).
        // اللاتينية: row عادية حتى لا ينعكس النص.
        flexDirection: rtl ? 'row-reverse' : 'row',
        flexWrap: wrap ? 'wrap' : 'nowrap',
        // في row-reverse تكون بداية السطر على اليمين، لذا flex-start = محاذاة يمين.
        justifyContent: align === 'right' ? 'flex-start' : 'center',
        alignItems: 'center',
        gap,
        // ⚠️ بلا `width: '100%'`: المكوّن يتمدّد تلقائيًا داخل حاوية عمودية (alignItems
        // الافتراضي stretch)، بينما داخل صف أفقي يجب أن يبقى بعرض محتواه وإلا انهارت
        // العناصر القصيرة (الشرائط والأزرار) وامتلأت البطاقة.
        fontFamily: OG_FONT_FAMILY,
        ...style,
      }}
    >
      {words.map((word, index) => (
        <div key={`${word}-${index}`} style={{ display: 'flex' }}>
          {word}
        </div>
      ))}
    </div>
  );
}

export default OgText;
