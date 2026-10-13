import '@fontsource/cairo/400.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/cairo/900.css';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { GATEWAY_SITE_URL } from '@/lib/site-url';

const SITE_NAME = 'نيمو كورة لايف — NEMO Sports';
const SITE_TITLE = 'نيمو كورة لايف | جدول مباريات اليوم والأمس والغد — NEMO Sports';
const SITE_DESCRIPTION =
  'بوابة عربية لمباريات كرة القدم: جدول المواعيد والنتائج وحالات المباريات بتوقيت القاهرة، مع صفحات هبوط لكل مباراة ورابط مشاهدة التغطية المباشرة، وإسناد بيانات كل مباراة إلى مصدرها.';

/** معرّف ناشر AdSense (اختياري) — عند ضبطه يُحمَّل السكربت وتظهر المساحات الإعلانية. */
const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim() || '';

/**
 * metadataBase تثبّت النطاق الرسمي لكل الروابط المطلقة (canonical/openGraph/sitemap).
 * الوسوم المعيارية تُضبط لكل صفحة على حدة (وليس هنا) لتجنّب الإشارة الخاطئة إلى الجذر
 * من صفحات الأخبار أو الصفحات القانونية — وهذا هو الأسلوب الصحيح لمنع تكرار المحتوى.
 */
export const metadata: Metadata = {
  metadataBase: new URL(GATEWAY_SITE_URL),
  title: {
    default: SITE_TITLE,
    template: '%s | نيمو كورة لايف',
  },
  description: SITE_DESCRIPTION,
  applicationName: 'نيمو كورة لايف',
  category: 'sports',
  publisher: SITE_NAME,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  verification: {
    google: '6nwKbe3UwHbbzzDg0S8a6TRE_rEEIAdyGgIJD6q6ua4',
  },
  openGraph: {
    type: 'website',
    locale: 'ar_EG',
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: GATEWAY_SITE_URL,
    images: [
      {
        url: `${GATEWAY_SITE_URL}/og-cover.jpg`,
        width: 1200,
        height: 675,
        alt: 'نيمو كورة لايف — بوابة مباريات اليوم والبث المباشر',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [`${GATEWAY_SITE_URL}/og-cover.jpg`],
  },
};

export const viewport: Viewport = {
  themeColor: '#161f2e',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" data-theme="light" suppressHydrationWarning>
      <head>
        {ADSENSE_CLIENT ? (
          <>
            {/* توثيق حساب الناشر في AdSense + تحميل السكربت بشكل غير معطّل للعرض */}
            <meta name="google-adsense-account" content={ADSENSE_CLIENT} />
            <Script
              async
              strategy="afterInteractive"
              src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
              crossOrigin="anonymous"
            />
          </>
        ) : null}
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
