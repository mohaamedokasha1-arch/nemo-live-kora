'use client';

import React, { useEffect, useRef } from 'react';
import { ADSENSE_CLIENT_ID, resolveAdSlotId } from '@/lib/ads/config';

/**
 * مساحة إعلانية جاهزة (AdSense / أي شبكة أخرى) مع حجز ارتفاع ثابت لمنع
 * إزاحة التخطيط (CLS) — وهو أحد شروط قبول المواقع في برامج الناشرين.
 *
 * طريقة التفعيل:
 *  1) ضع معرّف الناشر في متغير البيئة NEXT_PUBLIC_ADSENSE_CLIENT
 *     (مثال: ca-pub-1234567890123456).
 *  2) ضع رقم الوحدة الإعلانية في متغير البيئة التالي بصيغة
 *     NEXT_PUBLIC_ADSENSE_SLOT_<ID> أو مرّر slotId مباشرة إلى المكوّن.
 *  3) أضف سطر الشبكة في ملف /ads.txt (يُنشأ تلقائيًا من معرّف الناشر).
 *
 * بدون تفعيل المتغيرات **لا يُرسم أي شيء إطلاقًا**: لا صندوق فارغ ولا نص إرشادي — فلا
 * يظهر للزائر أي أثر لمرحلة الإعداد، ولا تُستهلك مساحة في الصفحة بلا مقابل.
 * وعند التفعيل تظهر المساحة بارتفاع محجوز مسبقًا فلا تحدث إزاحة تخطيط (CLS).
 *
 * ملاحظة معمارية: الفحص يقع في المكوّن الخارجي **قبل أي hook**، والـ hooks تعيش في
 * مكوّن داخلي لا يُستدعى إلا عند وجود إعلان فعلي — فيبقى المسار الفارغ بلا أي عمل.
 */

const PUSHED = new Set<string>();

type AdFormat = 'leaderboard' | 'in-article' | 'sidebar';

const FORMAT_STYLE: Record<AdFormat, { minHeight: number; label: string }> = {
  leaderboard: { minHeight: 100, label: 'مساحة إعلانية أفقية' },
  'in-article': { minHeight: 250, label: 'مساحة إعلانية داخل المحتوى' },
  sidebar: { minHeight: 600, label: 'مساحة إعلانية جانبية' },
};

/** الوحدة الفعلية: تُرسم فقط عند وجود معرّف ناشر ووحدة إعلانية صالحة. */
function AdUnit({
  client,
  slotId,
  format,
  label,
}: {
  client: string;
  slotId: string;
  format: AdFormat;
  label?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const config = FORMAT_STYLE[format];

  useEffect(() => {
    const container = containerRef.current;
    if (!container || PUSHED.has(slotId)) return;
    const adElement = container.querySelector('ins.adsbygoogle');
    if (!adElement) return;
    try {
      const adsWindow = window as unknown as { adsbygoogle?: unknown[] };
      adsWindow.adsbygoogle = adsWindow.adsbygoogle || [];
      adsWindow.adsbygoogle.push({});
      PUSHED.add(slotId);
    } catch {
      // فشل تحميل الإعلان لا يجب أن يُعطّل الصفحة.
    }
  }, [slotId]);

  return (
    <div
      className={`kl-ad-slot kl-ad-slot-${format}`}
      ref={containerRef}
      style={{ minHeight: config.minHeight }}
      aria-label={label || config.label}
      data-ad-configured="true"
    >
      <ins
        className="adsbygoogle"
        style={{ display: 'block', width: '100%' }}
        data-ad-client={client}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}

export default function AdSlot({
  slotId,
  format = 'in-article',
  label,
}: {
  /** رقم الوحدة الإعلانية من لوحة الناشر. */
  slotId?: string;
  format?: AdFormat;
  label?: string;
}) {
  const normalizedSlot = resolveAdSlotId(slotId);
  // بلا إعلان مُعدّ: لا رسم ولا hooks — الصفحة تبقى نظيفة تمامًا للزائر.
  if (!ADSENSE_CLIENT_ID || !normalizedSlot) return null;

  return <AdUnit client={ADSENSE_CLIENT_ID} slotId={normalizedSlot} format={format} label={label} />;
}
