import React from 'react';
import {
  ADSTERRA_BANNER_300X250,
  ADSTERRA_BANNER_728X90,
  isAdsterraFormatEnabled,
  type AdsterraBannerUnit,
} from '@/lib/ads/adsterra';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Adsterra Banner — البانر المربع 300×250 والبانر العريض 728×90
 * ═══════════════════════════════════════════════════════════════════════════════
 *  مكوّن واحد بحجمين، لأن كود الشبكة نفسه هو نفسه في الحالتين ولا يختلف إلا في
 *  المفتاح والأبعاد — فتغيير المقاسات مستقبلًا يقع في مكان واحد لا في كل صفحة.
 *
 *  ⚠️ المشكلة الحقيقية في بانرات Adsterra داخل React (ولماذا لا يُحقن وسم `<script>`
 *  مباشرة في الصفحة؟)
 *  كود البانر يعتمد متغيّرًا عامًّا واحدًا (`atOptions`) يقرأه سكربت الوحدة لحظة
 *  تنفيذه. وفي صفحة واحدة قد يوجد بانر 300×250 وبانر 728×90 (مفتاحان مختلفان)،
 *  والسكربتات تُنزَّل عبر الشبكة بشكل غير متزامن — فيحدث تسابق مضمون: السكربتان
 *  يقرآن **آخر** قيمة للمتغيّر العام، فتظهر وحدة بالحجم الخطأ أو تفشل إحداهما.
 *  ولذلك يكتب كل بانر هنا داخل **مستند معزول صغير**: وسم `<iframe>` محتواه هو كود
 *  الشبكة الحرفي كما ورد من Adsterra. النتيجة:
 *    • لكل وحدة `atOptions` خاص بها، فلا تسابق ولا تداخل مع أي بانر آخر في الصفحة.
 *    • `document.write` المستخدم في كود البانر يعمل كما يعمل في صفحة عادية، لأن
 *      الإطار يُحلَّل من أوله (خلافًا للحقن الديناميكي في صفحة مكتملة).
 *    • سكربت الإعلان لا يوقف قراءة الصفحة الرئيسية ولا يحجب أول رسم (LCP) إطلاقًا.
 *
 *  حماية الزائر: الإطار يعمل بسياسة `sandbox` تسمح بالسكربتات والنوافذ المنبثقة
 *  وبـ `allow-same-origin` (كي لا تتعطّل صور كوكيز الشبكة)، لكنها **تمنع التنقل في
 *  الإطار الأعلى** — فلا يستطيع أي إبداع إعلاني (Creative) أن يخطف المتصفح ويخرج
 *  بالزائر من الموقع إلى صفحة أخرى.
 *
 *  منع إزاحة التخطيط (CLS): الارتفاع محجوز دائمًا وبالمقاس الدقيق للوحدة (250px أو
 *  90px) في `app/globals.css`، والدور القصير المربع يُحمَّل محليًا في `srcDoc` بلا
 *  أي طلب شبكة، فلا تحدث أي قفزة في المحتوى عند وصول الإعلان.
 */

/** الحجمان المدمجان في الموقع. */
export type AdsterraBannerSize = '300x250' | '728x90';

const UNITS: Record<AdsterraBannerSize, AdsterraBannerUnit> = {
  '300x250': ADSTERRA_BANNER_300X250,
  '728x90': ADSTERRA_BANNER_728X90,
};

/**
 * يبني مستند الإطار: كود Adsterra الحرفي (atOptions ثم سكربت الوحدة) داخل صفحة
 * مصغّرة شفافة الخلفية بمقاس الوحدة بالضبط. الدالة صافية (Pure) فتُنتج النتيجة نفسها
 * على الخادم وعلى المتصفح — وهو شرط سلامة الترطيب (Hydration).
 */
export function buildBannerDocument(unit: AdsterraBannerUnit): string {
  const atOptions = [
    'atOptions = {',
    `  'key' : '${unit.key}',`,
    "  'format' : 'iframe',",
    `  'height' : ${unit.height},`,
    `  'width' : ${unit.width},`,
    "  'params' : {}",
    '};',
  ].join('\n');

  return [
    '<!doctype html>',
    '<html lang="ar" dir="rtl">',
    '<head>',
    '<meta charset="utf-8" />',
    // منع التمرير داخل الإطار: الوحدة بمقاس ثابت ولا يجوز أن يظهر شريط تمرير.
    '<style>html,body{margin:0;padding:0;border:0;background:transparent;overflow:hidden}</style>',
    '</head>',
    '<body>',
    `<script type="text/javascript">\n${atOptions}\n</script>`,
    `<script type="text/javascript" src="${unit.invokeUrl}"></script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

export default function AdsterraBanner({
  size,
  label,
  className,
}: {
  /** مقاس الوحدة — يحدّد المفتاح والأبعاد من المصدر الواحد. */
  size: AdsterraBannerSize;
  /** وصف نصّي للمساحة (يُقرأ لقارئات الشاشة، ولا يؤثر على تنزيل الإعلان). */
  label?: string;
  /** أصناف إضافية للموضع (مثل جانب المقال أو أسفل القائمة). */
  className?: string;
}) {
  const unit = UNITS[size];
  if (!isAdsterraFormatEnabled(unit.format)) return null;

  const frameTitle = label || `مساحة إعلانية ${size === '728x90' ? 'عريضة' : 'مربعة'} بمقاس ${unit.width}×${unit.height}`;
  const classes = ['kl-ad-banner', `kl-ad-banner-${size}`, className].filter(Boolean).join(' ');

  return (
    <div className={classes} data-ad-unit={size} data-ad-network="adsterra">
      <iframe
        className="kl-ad-banner-frame"
        title={frameTitle}
        srcDoc={buildBannerDocument(unit)}
        width={unit.width}
        height={unit.height}
        loading="lazy"
        scrolling="no"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
