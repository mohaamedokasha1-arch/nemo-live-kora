import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'الصفحة غير موجودة',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="kl-empty-box">
      <h1 className="kl-empty-title">الصفحة غير موجودة</h1>
      <p>قد يكون الخبر محذوفًا أو غير منشور بعد التحقق.</p>
      <div className="kl-empty-links">
        <Link href="/" className="kl-day-btn kl-day-btn-active">
          جدول المباريات
        </Link>
        <Link href="/news" className="kl-day-btn">
          الأخبار
        </Link>
      </div>
    </div>
  );
}
