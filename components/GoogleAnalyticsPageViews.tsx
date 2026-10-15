'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { buildGaPageViewCommand, shouldTrackGaPageView } from '@/lib/analytics/google-analytics';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  قياس صفحات Next.js بعد التنقّل الداخلي (بلا إعادة تحميل المستند)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  المشكلة التي يحلّها هذا المكوّن:
 *  `gtag('config', …)` يُرسل صفحة مشاهدة واحدة عند تحميل المستند. أما التنقّل داخل
 *  Next.js (App Router) فيبدّل الصفحة **دون** إعادة تحميل، فلا يرى Google إلا صفحة
 *  الدخول — أي أن زائرًا يدخل الرئيسية ثم ينتقل إلى عشر صفحات مباريات يُحسب زيارة
 *  واحدة، ويهبط تقرير «الصفحات» إلى رقم واحد. (وهي المشكلة المعروفة نفسها في كل
 *  تطبيقات الصفحة الواحدة، وحلّها المعتمد: إرسال `page_view` عند كل تغيّر مسار.)
 *
 *  كيف يعمل:
 *    • المكوّن يرسم `null` — لا يضيف أي عنصر إلى الصفحة ولا أي وزن بصري.
 *    • `usePathname()` يُعيد المسار الحالي، ويتغيّر عند كل تنقّل فيُعاد تشغيل الأثر.
 *    • أول تشغيل للأثر هو **صفحة الدخول** وقد أرسلتها `config` بالفعل ⇒ يُتخطّى
 *      (`shouldTrackGaPageView` تشرح القاعدة وتفصّل حالات عدم الإرسال).
 *    • الإرسال يجري عبر `window.gtag` المُعرَّف في السكربت الداخلي بالرأس — وإن
 *      حجبه مانع إعلانات أو تعذّر تحميله فأول شرط هو التحقق من نوعه، فلا يقع أي خطأ
 *      في وحدة التحكم عند الزائر ولا يتأثّر الموقع بغياب Google.
 *
 *  ولماذا لا تُقرأ سلسلة الاستعلام من `useSearchParams`؟ لأنها تفرض في App Router
 *  تغليفًا بـ `<Suspense>` وتحوّل الصفحات الساكنة إلى ديناميكية. قراءتها من
 *  `window.location.search` داخل الأثر (عميل فقط) تعطي النتيجة نفسها بلا أي أثر على
 *  طريقة توليد الصفحات.
 */
export default function GoogleAnalyticsPageViews({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const lastTrackedUrl = useRef<string | null>(null);

  useEffect(() => {
    const currentUrl = `${pathname}${window.location.search}`;
    const shouldSend = shouldTrackGaPageView(lastTrackedUrl.current, currentUrl);
    lastTrackedUrl.current = currentUrl;
    if (!shouldSend) return;

    const gtag = window.gtag;
    if (typeof gtag !== 'function') return;

    gtag(
      ...buildGaPageViewCommand({
        pagePath: currentUrl,
        pageLocation: window.location.href,
        pageTitle: document.title,
        measurementId,
      })
    );
  }, [pathname, measurementId]);

  return null;
}
