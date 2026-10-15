import React from 'react';
import { isAdsterraFormatEnabled, resolveAdsterraSmartlinkUrl } from '@/lib/ads/adsterra';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Adsterra Smartlink — زر التحويل المموّل (الرابط الذكي)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  المواضع المُعتمدة: كتلة المشاهدة في كل صفحات المباريات (صفحة التفاصيل، صفحة البث
 *  الداخلية، وصفحة سجل المصدر) وبطاقات الصفحة الرئيسية — أي نقاط التحويل نفسها التي
 *  يقف عندها الزائر جاهزًا للنقر.
 *
 *  ⚠️ قاعدة UX مُلزِمة في هذا المشروع: زر المشاهدة الرسمي (منصة NEMO Sports) يبقى
 *  **الأساسي** كما هو، والسمارت لينك يأتي **إلى جواره** كزر ثانٍ بوسم إعلاني صريح.
 *  استبدال الزر الرسمي برابط إعلاني كان سيضلّل الزائر (يضغط ليشاهد فتُفتح صفحة عرض)
 *  ويُسقط وعد الموقع في «مشاهدة مباشرة»، ويعطّل حراسة الاختبارات على وجهة المشاهدة.
 *
 *  SEO: وسم `rel="sponsored nofollow"` إلزامي لروابط مدفوعة — يُخبر محركات البحث أن
 *  الرابط تجاري فلا يُمرَّر إليه أي إشارة، ويحمي سمعة الموقع في جوجل.
 *  والرابط `target="_blank"` مع `noopener noreferrer` فلا يصل الرابط الخارجي إلى نافذة
 *  موقعنا ولا يعرف من أين جاء الزائر بالتفصيل.
 */
export default function SmartlinkCta({
  variant = 'button',
  label,
  note,
  className,
}: {
  /** `button` — زر كامل بجوار أزرار التحويل، و`inline` — رابط نصّي خفيف داخل بطاقة. */
  variant?: 'button' | 'inline';
  label?: string;
  note?: string | null;
  className?: string;
}) {
  if (!isAdsterraFormatEnabled('smartlink')) return null;

  const text = label || 'عروض الراعي — عرض مُموّل مختار';
  const classes = ['kl-smartlink', `kl-smartlink-${variant}`, className].filter(Boolean).join(' ');

  return (
    <div className={classes} data-ad-network="adsterra" data-ad-unit="smartlink">
      <a
        href={resolveAdsterraSmartlinkUrl()}
        target="_blank"
        rel="noopener noreferrer sponsored nofollow"
        className="kl-smartlink-link"
        aria-label={`${text} — رابط إعلاني من راعٍ خارجي يفتح في نافذة جديدة`}
      >
        <span className="kl-smartlink-text">{text}</span>
        <span className="kl-smartlink-badge">إعلان</span>
        <span className="kl-smartlink-arrow" aria-hidden="true">
          ←
        </span>
      </a>
      {note ? <p className="kl-smartlink-note">{note}</p> : null}
    </div>
  );
}
