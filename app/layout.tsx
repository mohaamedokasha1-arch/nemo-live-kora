import '@fontsource/cairo/400.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/cairo/900.css';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import SiteBanner from '@/components/SiteBanner';
import AdsterraBanner from '@/components/AdsterraBanner';
import AdsterraPopunder from '@/components/AdsterraPopunder';
import AdsterraSocialBar from '@/components/AdsterraSocialBar';
import GoogleAnalytics from '@/components/GoogleAnalytics';
import GoogleAnalyticsPageViews from '@/components/GoogleAnalyticsPageViews';
import { ADSTERRA_HOSTS } from '@/lib/ads/adsterra';
import { resolveAdsenseHeadClient } from '@/lib/ads/config';
import { GA_HOSTS, isGoogleAnalyticsActive, resolveGaMeasurementId } from '@/lib/analytics/google-analytics';
import { GATEWAY_SITE_URL } from '@/lib/site-url';
import { getSiteSettings, loadManualDocument } from '@/lib/admin/manual-store';

const SITE_NAME = 'نيمو كورة لايف — NEMO Sports';
const SITE_TITLE = 'نيمو كورة لايف | جدول مباريات اليوم والأمس والغد — NEMO Sports';
const SITE_DESCRIPTION =
  'بوابة عربية لمباريات كرة القدم: جدول المواعيد والنتائج وحالات المباريات بتوقيت القاهرة، مع صفحات هبوط لكل مباراة ورابط مشاهدة التغطية المباشرة، وإسناد بيانات كل مباراة إلى مصدرها.';

/**
 * معرّف ناشر AdSense — كود إثبات الملكية وتفعيل الإعلانات (طلب 2026-10-15).
 * السكربت يُحمَّل افتراضيًا بالمعرّف الصريح المعتمد حتى لا تُنسى صفحة ولا يحتاج
 * فحص «تحقق» في AdSense إلى أي إعداد بيئة مسبق، ويمكن لمتغيّر البيئة
 * `NEXT_PUBLIC_ADSENSE_CLIENT` تجاوزه بمعرّف آخر دون تعديل الكود.
 * المصدر الواحد: `resolveAdsenseHeadClient()` في `lib/ads/config.ts`.
 */
const ADSENSE_CLIENT = resolveAdsenseHeadClient();

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
  // معرّف القياس الفعّال (أو null عند الإيقاف/معرّف غير صالح) لتشغيل قياس التنقّل الداخلي.
  const gaMeasurementId = isGoogleAnalyticsActive() ? resolveGaMeasurementId() : null;
  return (
    <html lang="ar" dir="rtl" data-theme="light" suppressHydrationWarning>
      <head>
        {/*
          ═══════════════════════════════════════════════════════════════════════
           Google Analytics (gtag.js) — **أول ما يُرسم داخل <head>** في كل الصفحات
          ═══════════════════════════════════════════════════════════════════════
          طلب صاحب المنتج (2026-10-15): كود Google Analytics مباشرةً بعد وسم <head>
          في جميع الصفحات لمتابعة الزيارات. والتنفيذ هنا في التخطيط العام (الجذر الذي
          يمرّ منه كل مسار) — لا في كل صفحة على حدة — فلا يمكن أن تُنسى صفحة أو أن
          تختلف نسخة الكود عن أخرى. المعرّف والنص كلاهما من
          `lib/analytics/google-analytics.ts` (مصدر واحد)، والإيقاف بمتغيّر بيئة واحد.
        */}
        <GoogleAnalytics />
        {/*
          ربط الشبكة الإعلانية مسبقًا (dns-prefetch فقط):
          يحلّ اسم النطاق قبل أن يطلب المتصفح سكربت الإعلان، فلا تُضاف زمن انتظار
          DNS إلى مسار الطلب. لا تنزيل ولا اتصال مسبق (preconnect) عن قصد — حتى
          لا يُفتح اتصال بجهة خارجية لكل زائر لا يصل إلى تلك الوحدات أصلًا.
        */}
        {ADSTERRA_HOSTS.map((host) => (
          <link key={host} rel="dns-prefetch" href={`//${host}`} />
        ))}
        {/*
          ونفس المعاملة لنطاقَي Google Analytics (تحميل المكتبة ثم إرسال القياس).
          مشروطة بتشغيل الوسم: عند `NEXT_PUBLIC_GA_ENABLED=off` أو معرّف غير صالح لا
          يبقى في الرأس أي أثر لـ Google إطلاقًا — ولا حتى تحليل اسم نطاقها.
        */}
        {gaMeasurementId
          ? GA_HOSTS.map((host) => <link key={host} rel="dns-prefetch" href={`//${host}`} />)
          : null}
        {ADSENSE_CLIENT ? (
          <>
            {/*
              ═══════════════════════════════════════════════════════════════════════
               كود إثبات الملكية + تفعيل Google AdSense — كما طُلب حرفيًا داخل <head>
              ═══════════════════════════════════════════════════════════════════════
              الطلب (2026-10-15): سكربت adsbygoogle بمعايرة الناشر المطلوبة و
              `crossorigin="anonymous"`، بين <head> و </head> بالكامل، بتحميل سليم بلا
              أخطاء hydration حتى ترصد أداة التحقق من Google الرمز فورًا عند الضغط على
              زر «تحقق».

              • وسم `google-adsense-account` يوثّق حساب الناشر عند Google (أقوى إشارة
                للتحقق من ملكية الموقع للحساب).
              • السكربت `async` لا يحجب تحليل HTML ولا يؤخّر أول رسم (LCP) ولا يحجب
                الترطيب — والقراءة هنا من HTML المُرسل قبل أي جافاسكربت، وهو ما يفحصه
                أداة التحقق.

              لماذا `<script>` مباشر لا `next/script`؟ (نفس قرار GoogleAnalytics
              وAdsterraPopunder الموثّق على بناء إنتاجي حقيقي 2026-10-15):
              `next/script` بأي استراتيجية (عدا beforeInteractive التي تحجب العرض)
              يُلحق الوسم في نهاية `<body>` بعد الترطيب — أي خارج الرأس تمامًا، فيفشل
              شرط «بين وسوم <head> و </head>» ويتأخر الرصد حتى يعمل JavaScript.
              الوسم المباشر يُرفع إلى الرأس مع كل سكربت `async` في React 19، ويعمل
              نفس النمط في المشروع منذ إضافة الوسمين السابقين بلا أي انحراف hydration
              — فالخادم والعميل يرسمان الوسم نفسه حرفيًا.
            */}
            <meta name="google-adsense-account" content={ADSENSE_CLIENT} />
            <script
              id="google-adsense"
              async
              src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
              crossOrigin="anonymous"
            />
          </>
        ) : null}
        {/* الإعلان المنبثق (Popunder) — آخر ما يُحمَّل من الرأس، في كل صفحات الموقع */}
        <AdsterraPopunder />
      </head>
      <body className="kl-page-shell">
        {/*
          قياس التنقّل داخل الموقع: كل صفحة مشاهَدَة بعد صفحة الدخول تُرسل حدث
          `page_view` صريحًا لأن Next.js يبدّل الصفحات بلا إعادة تحميل للمستند.
          المكوّن يرسم `null` ولا يظهر في الشاشة، ولا يعمل إطلاقًا عند إيقاف الوسم.
        */}
        {gaMeasurementId ? <GoogleAnalyticsPageViews measurementId={gaMeasurementId} /> : null}
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
