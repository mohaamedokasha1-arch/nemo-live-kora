'use client';

import React, { useEffect, useRef } from 'react';

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
 * بدون تفعيل المتغيرات يعرض المكوّن مساحة محجوزة محايدة بدون أي طلب خارجي.
 */

const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim() || '';
const PUSHED = new Set<string>();

type AdFormat = 'leaderboard' | 'in-article' | 'sidebar';

const FORMAT_STYLE: Record<AdFormat, { minHeight: number; label: string }> = {
  leaderboard: { minHeight: 100, label: 'مساحة إعلانية أفقية' },
  'in-article': { minHeight: 250, label: 'مساحة إعلانية داخل المحتوى' },
  sidebar: { minHeight: 600, label: 'مساحة إعلانية جانبية' },
};

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const adKey = slotId || `placeholder-${format}`;
  const config = FORMAT_STYLE[format];

  useEffect(() => {
    if (!ADSENSE_CLIENT || !slotId) return;
    const container = containerRef.current;
    if (!container || PUSHED.has(adKey)) return;
    const adElement = container.querySelector('ins.adsbygoogle');
    if (!adElement) return;
    try {
      const adsWindow = window as unknown as { adsbygoogle?: unknown[] };
      adsWindow.adsbygoogle = adsWindow.adsbygoogle || [];
      adsWindow.adsbygoogle.push({});
      PUSHED.add(adKey);
    } catch {
      // فشل تحميل الإعلان لا يجب أن يُعطّل الصفحة.
    }
  }, [adKey, slotId]);

  return (
    <div
      className={`kl-ad-slot kl-ad-slot-${format}`}
      style={{ minHeight: config.minHeight }}
      aria-label={label || config.label}
      data-ad-configured={ADSENSE_CLIENT && slotId ? 'true' : 'false'}
    >
      {ADSENSE_CLIENT && slotId ? (
        <ins
          className="adsbygoogle"
          style={{ display: 'block', width: '100%' }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={slotId}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      ) : (
        <div className="kl-ad-placeholder">
          <span>{label || config.label}</span>
          <small>
            فعّل الإعلانات بضبط NEXT_PUBLIC_ADSENSE_CLIENT و NEXT_PUBLIC_ADSENSE_SLOT_*
          </small>
        </div>
      )}
    </div>
  );
}
