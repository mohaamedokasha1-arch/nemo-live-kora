import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'الصفحة غير موجودة',
  robots: { index: false, follow: false },
};

/**
 * صفحة 404 الموحدة: تشرح الحالة بلغة واثقة وتُعيد الزائر فورًا إلى مسارات مفيدة
 * (جدول اليوم — الأخبار) بدل تركه عند مسدود. النص عام بما يكفي ليغطي روابط
 * المباريات والأخبار والصفحات القديمة، ولا يدّعي معلومة لا يملكها.
 */
export default function NotFound() {
  return (
    <div className="kl-empty-box">
      <h1 className="kl-empty-title">الصفحة غير موجودة</h1>
      <p>
        الرابط الذي فتحته غير صحيح أو لم يعد متاحًا — قد يكون المحتوى حُذف أو نُقل
        إلى عنوان آخر. يمكنك الوصول إلى المباريات والأخبار من الروابط أدناه.
      </p>
      <div className="kl-empty-links">
        <Link href="/" className="kl-day-btn kl-day-btn-active">
          جدول المباريات
        </Link>
        <Link href="/matches" className="kl-day-btn">
          كل المباريات
        </Link>
        <Link href="/news" className="kl-day-btn">
          الأخبار
        </Link>
      </div>
    </div>
  );
}
