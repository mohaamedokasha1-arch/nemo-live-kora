'use client';

import Link from 'next/link';

type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/** Friendly route-level fallback; error details are intentionally not exposed to visitors. */
export default function RouteError({ reset }: RouteErrorProps) {
  return (
    <section className="kl-empty-box" role="alert" aria-live="assertive" aria-labelledby="route-error-title">
      <h1 id="route-error-title" className="kl-empty-title">
        حدث خطأ غير متوقع
      </h1>
      <p>تعذّر إكمال الطلب الآن. يمكنك إعادة المحاولة أو العودة إلى جدول المباريات.</p>
      <div className="kl-empty-links">
        <button
          type="button"
          className="kl-day-btn kl-day-btn-active"
          style={{ cursor: 'pointer' }}
          onClick={reset}
        >
          إعادة المحاولة
        </button>
        <Link href="/" className="kl-day-btn">
          العودة إلى الصفحة الرئيسية
        </Link>
      </div>
    </section>
  );
}
