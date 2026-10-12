import '@fontsource/cairo/400.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/cairo/900.css';
import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { GATEWAY_SITE_URL } from '@/lib/site-url';

export const metadata: Metadata = {
  metadataBase: new URL(GATEWAY_SITE_URL),
  title: {
    default: 'نيمو كورة لايف | جدول مباريات اليوم والأمس والغد — NEMO Sports',
    template: '%s | نيمو كورة لايف',
  },
  description:
    'بوابة مباريات عربية تعرض جدول المواعيد والنتائج وحالات المباريات بتوقيت القاهرة، مع إسناد بيانات كل مباراة إلى مصدرها.',
  openGraph: {
    type: 'website',
    locale: 'ar_EG',
    siteName: 'نيمو كورة لايف — NEMO Sports',
    title: 'نيمو كورة لايف | جدول مباريات اليوم بتوقيت القاهرة',
    description:
      'تابع مواعيد ونتائج المباريات وحالاتها بتوقيت القاهرة. نعرض رابط المباراة على NEMO Sports فقط عند التحقق من مطابقته.',
    url: GATEWAY_SITE_URL,
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
        <meta
          name="google-site-verification"
          content="6nwKbe3UwHbbzzDg0S8a6TRE_rEEIAdyGgIJD6q6ua4"
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
