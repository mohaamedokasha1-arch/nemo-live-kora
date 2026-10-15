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
import SiteBanner from '@/components/SiteBanner';
import AdsterraBanner from '@/components/AdsterraBanner';
import AdsterraPopunder from '@/components/AdsterraPopunder';
import AdsterraSocialBar from '@/components/AdsterraSocialBar';
import { ADSTERRA_HOSTS } from '@/lib/ads/adsterra';
import { GATEWAY_SITE_URL } from '@/lib/site-url';
import { getSiteSettings, loadManualDocument } from '@/lib/admin/manual-store';

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
/**
 * الوسوم الافتراضية للموقع. تُبنى من دالة لا من ثابت لأن جزءًا منها يقرأ إعدادات
 * لوحة الإدارة (صورة المشاركة والوصف التعريفي) — فينعكس تعديل المشغّل بلا إعادة بناء.
 * كل ما لم يُغيَّر في اللوحة يبقى بنفس القيمة الثابتة السابقة حرفيًا.
 */
export async function generateMetadata(): Promise<Metadata> {
  await loadManualDocument();
  const settings = getSiteSettings();
  const ogImage = settings.ogImagePath?.startsWith('http')
    ? settings.ogImagePath
    : `${GATEWAY_SITE_URL}${settings.ogImagePath || '/og-cover.jpg'}`;
  return buildLayoutMetadata(ogImage, settings.siteDescriptionAr || SITE_DESCRIPTION);
}

function buildLayoutMetadata(ogImage: string, description: string): Metadata {
  return {
  metadataBase: new URL(GATEWAY_SITE_URL),
  title: {
    default: SITE_TITLE,
    template: '%s | نيمو كورة لايف',
  },
  description,
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
    description,
    url: GATEWAY_SITE_URL,
    images: [
      {
        url: ogImage,
        width: 1200,
        height: 675,
        alt: 'نيمو كورة لايف — بوابة مباريات اليوم والبث المباشر',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description,
    images: [ogImage],
  },
  };
}

export const viewport: Viewport = {
  themeColor: '#161f2e',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // تحميل مستند الإدارة هنا يجعل الشريط والصفحات تقرأ أحدث قرار إداري في نفس الطلب،
  // والقراءة مخزَّنة في الذاكرة فلا تُضيف أي طلب شبكة بعد أول تحميل.
  await loadManualDocument();
  return (
    <html lang="ar" dir="rtl" data-theme="light" suppressHydrationWarning>
      <head>
        {/*
          ربط الشبكة الإعلانية مسبقًا (dns-prefetch فقط):
          يحلّ اسم النطاق قبل أن يطلب المتصفح سكربت الإعلان، فلا تُضاف زمن انتظار
          DNS إلى مسار الطلب. لا تنزيل ولا اتصال مسبق (preconnect) عن قصد — حتى
          لا يُفتح اتصال بجهة خارجية لكل زائر لا يصل إلى تلك الوحدات أصلًا.
        */}
        {ADSTERRA_HOSTS.map((host) => (
          <link key={host} rel="dns-prefetch" href={`//${host}`} />
        ))}
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
        {/* الإعلان المنبثق (Popunder) — آخر ما يُحمَّل من الرأس، في كل صفحات الموقع */}
        <AdsterraPopunder />
      </head>
      <body className="kl-page-shell">
        <SiteBanner />
        <Header />
        {/*
          البانر العريض 728×90 في أعلى الصفحة مباشرة بعد الهيدر.
          يظهر على شاشات الكمبيوتر والأجهزة الكبيرة فقط (`kl-ad-leaderboard-slot`
          مخفي تحت 800px في globals.css) لأن 728 بكسل أعرض من شاشة الهاتف، وعرضُه
          مجبورًا على الهاتف يعني إما تمرير أفقي أو إعلانًا مقصوصًا — وكلاهما مرفوض.
          وحين يُخفى على الهاتف لا يُنزَّل سكربت الوحدة أصلًا (الإطار المخفي لا
          يُحمَّل)، فلا يُدفع ثمن إعلان لا يُرى.
        */}
        <div className="kl-container kl-ad-leaderboard-slot">
          <AdsterraBanner size="728x90" label="مساحة إعلانية عريضة أعلى الصفحة 728×90" />
        </div>
        <main id="main-content" className="kl-container kl-main">
          {children}
        </main>
        <Footer />
        {/* البار الاجتماعي (Social Bar) — آخر وسم داخل <body> كما نصّ كود الشبكة */}
        <AdsterraSocialBar />
      </body>
    </html>
  );
}
