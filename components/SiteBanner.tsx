import React from 'react';
import { getSiteSettings } from '@/lib/admin/manual-store';

/**
 * شريط التنبيه العام أعلى الموقع.
 *
 * يُستخدم عندما يتعذّر التحديث التلقائي (مصدر متوقف مثلًا): المشغّل يكتب سطرًا
 * واحدًا من لوحة الإدارة فيظهر لكل الزائر — بصدق وبلغة لا تُشكّك في الموقع،
 * وبنفس هوية الألوان القائمة (لا تصميم جديد).
 *
 * لا يُعرض أي شريط افتراضيًا: كل ما يظهر هنا فعّله المدير بنفسه من اللوحة،
 * وإلا فالمكوّن لا يُنتج أي HTML.
 */
export default function SiteBanner() {
  const { banner } = getSiteSettings();
  if (!banner.enabled || !banner.textAr.trim()) return null;

  const isWarning = banner.tone === 'warning';
  return (
    <div
      className={`kl-site-banner${isWarning ? ' kl-site-banner-warning' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="kl-container kl-site-banner-inner">
        {isWarning ? <span aria-hidden="true">⚠️</span> : <span aria-hidden="true">ℹ️</span>}
        <p>{banner.textAr.trim()}</p>
      </div>
    </div>
  );
}
