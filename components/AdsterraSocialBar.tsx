import Script from 'next/script';
import { ADSTERRA_SOCIAL_BAR_SCRIPT_URL, isAdsterraFormatEnabled } from '@/lib/ads/adsterra';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Adsterra Social Bar — البار الاجتماعي (يُحمَّل من نهاية <body>)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  الموضع: آخر عنصر داخل <body> بعد التذييل — كما نصّ عليه كود الشبكة نفسه.
 *
 *  لماذا `strategy="lazyOnload"`؟
 *  لأن هذا الشريط **ثانوي بطبيعته** (أيقونات صغيرة أسفل الشاشة تُفتح بالضغط)، فلا
 *  يجوز أن ينافس المحتوى أو الصور أو الخطوط على النطاق الترددي. بهذه الاستراتيجية
 *  لا يُطلب السكربت إلا بعد أن تصل الصفحة إلى حالة الخمول (idle) وبعد تحميل كل
 *  عناصر العرض — فتظل سرعة الموقع (LCP/TBT) كما لو أن الإعلان غير موجود، ويظهر
 *  الشريط للزائر بعد استقرار الصفحة.
 *
 *  ولا يُرسم أي وسم على الإطلاق عند إيقاف الوحدة، فلا يبقى للسكربت أي أثر في HTML.
 */
export default function AdsterraSocialBar() {
  if (!isAdsterraFormatEnabled('socialbar')) return null;

  return (
    <Script
      id="adsterra-social-bar"
      src={ADSTERRA_SOCIAL_BAR_SCRIPT_URL}
      strategy="lazyOnload"
    />
  );
}
