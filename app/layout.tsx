import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://nemo-live-kora.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(GATEWAY_URL),
  title: {
    default: 'نيمو كورة لايف | جدول مباريات اليوم والأمس والغد — NEMO Sports',
    template: '%s | نيمو كورة لايف',
  },
  description:
    'بوابة مباريات وأخبار عربية سريعة تعرض جدول مباريات اليوم بتوقيت القاهرة مع أخبار رياضية محققة من المصادر المعتمدة والربط المباشر مع NEMO Sports.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'ar_EG',
    siteName: 'نيمو كورة لايف — NEMO Sports',
    title: 'نيمو كورة لايف | جدول مباريات اليوم بتوقيت القاهرة',
    description:
      'تابع مواعيد ونتائج مباريات الدوري المصري والبطولات الأفريقية والعربية والأوروبية بتوقيت القاهرة مع الانتقال المباشر لتفاصيل المباراة على NEMO Sports.',
    url: GATEWAY_URL,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" data-theme="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Almarai:wght@400;700;800&family=Cairo:wght@500;600;700;800;900&family=Tajawal:wght@500;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="kl-page-shell">
        <Header />
        <main id="main-content" className="kl-container kl-main">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
