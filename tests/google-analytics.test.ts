import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import GoogleAnalytics from '../components/GoogleAnalytics';
import {
  DEFAULT_GA_MEASUREMENT_ID,
  GA_COLLECT_HOST,
  GA_HOSTS,
  GA_SCRIPT_HOST,
  buildGaInlineSnippet,
  buildGaPageViewCommand,
  buildGaScriptUrl,
  isGoogleAnalyticsActive,
  isGoogleAnalyticsEnabled,
  resolveGaMeasurementId,
  shouldTrackGaPageView,
} from '../lib/analytics/google-analytics';
import { collectSourceFiles, scanForbiddenPatterns, stripComments } from './helpers/source-scan';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  حراسة كود Google Analytics (2026-10-15)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  طلب صاحب المنتج: «أضف كود Google Analytics في كل صفحات الموقع، مباشرةً بعد وسم
 *  <head> عشان نتابع الزيارات». وهذه الاختبارات تحوّل الطلب إلى شروط آلية:
 *    ① الوسم في **أول** `<head>` من التخطيط العام الوحيد ⇒ يشمل كل صفحة بلا استثناء.
 *    ② الكود هو نفسه المعطى حرفيًا (نفس الرابط، نفس أوامر gtag، نفس المعرّف).
 *    ③ مصدر واحد للمعرّف والنطاقات — لا نسخة مبثوثة في مكوّن أو صفحة.
 *    ④ لا شيء يعطّل التحميل: السكربت `async`، ولا `next/script` في الجسم، ولا حقن HTML.
 *    ⑤ لا تُفقد زيارات التنقّل الداخلي (Next.js يبدّل الصفحات بلا إعادة تحميل)،
 *       ولا تُحسب صفحة الدخول مرتين.
 *    ⑥ مفتاح إيقاف واحد يوقف كل شيء لحظيًا، ومعرّف غير صالح يُرفض ولا يُرسل بيانات.
 */

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf-8');

/** تشغيل دالة مع متغيّرات بيئة مؤقتة ثم استعادة الحالة السابقة دائمًا. */
function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 *  ① الموضع: أول ما في <head> — ومن التخطيط العام ⇒ في كل الصفحات
 * ──────────────────────────────────────────────────────────────────────────── */

test('1) الوسم أول عنصر داخل <head> في التخطيط العام (المصدر)، والرأس يحمله وحده', () => {
  const layout = stripComments(read('app/layout.tsx'));

  // «مباشرةً بعد <head>» = لا شيء يفصل بينهما سوى المسافات (والتعليقات أُزيلت أعلاه
  // فبقيت أقواس تعبيراتها `{}` — لذلك يُسمح بها في المطابقة ولا يُسمح بأي عنصر آخر)
  assert.match(
    layout,
    /<head>[\s{}]*<GoogleAnalytics\s*\/>/,
    'كود Google Analytics ليس أول عنصر داخل <head> في التخطيط العام'
  );
  // كل الفحوص التالية داخل الرأس فقط (الملف يستورد الأسماء في أعلاه فلا تُخلط بالمتن)
  const head = layout.slice(layout.indexOf('<head>'), layout.indexOf('</head>'));
  const gaIndex = head.indexOf('<GoogleAnalytics');
  assert.ok(gaIndex > 0, 'الوسم غير مركّب في رأس التخطيط العام');
  // ويسبق كل ما يُرسم في الرأس: ربط النطاقات مسبقًا وسكربتات الإعلانات
  assert.ok(gaIndex < head.indexOf('ADSTERRA_HOSTS'), 'الوسم جاء بعد ربط نطاقات الإعلانات');
  assert.ok(gaIndex < head.indexOf('<AdsterraPopunder'), 'الوسم جاء بعد سكربت الإعلان المنبثق');
});

test('2) التخطيط العام وحيد ولا صفحة تُنشئ <head> خاصًا بها ⇒ الوسم في كل صفحات الموقع', () => {
  // التخطيط الجذري (الذي يُنشئ <html>) واحد فقط — وهو الذي يحمل الوسم، فتشمل كل الصفحات
  const appFiles = collectSourceFiles(repoRoot, ['app']);
  const rootLayouts = appFiles.filter(
    (file) => file.endsWith('layout.tsx') && /<html[\s>]/.test(stripComments(read(file)))
  );
  assert.deepEqual(rootLayouts, ['app/layout.tsx'], 'يوجد أكثر من تخطيط جذري — قد تخرج صفحات بلا وسم');

  // ولا أي صفحة أو تخطيط (جذري أو فرعي) يفتح <head> بنفسه، وإلا صار الرأس مزدوجًا وضاع الوسم
  const pages = appFiles.filter((file) => file.endsWith('page.tsx') || file.endsWith('layout.tsx'));
  const ownHead = pages.filter((file) => /<head[\s>]/.test(stripComments(read(file))));
  assert.deepEqual(ownHead, ['app/layout.tsx'], `صفحات تعرّف رأسها بنفسها: ${ownHead.join(', ')}`);

  // وقياس التنقّل الداخلي مفعّل من نفس التخطيط بالمعرّف المحسوب نفسه
  const layout = stripComments(read('app/layout.tsx'));
  assert.match(layout, /<GoogleAnalyticsPageViews measurementId=\{gaMeasurementId\}/, 'قياس التنقّل الداخلي غير مركّب');
  assert.match(
    layout,
    /isGoogleAnalyticsActive\(\)\s*\?[\s\S]{0,80}resolveGaMeasurementId\(\)/,
    'المعرّف غير محسوب من المصدر الواحد'
  );
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ② الكود: نفس ما أرسله صاحب المنتج حرفيًا
 * ──────────────────────────────────────────────────────────────────────────── */

test('3) الكود المُرسم هو كود Google المتفق عليه حرفيًا (الرابط + أوامر gtag + المعرّف)', () => {
  const html = renderToStaticMarkup(GoogleAnalytics());

  // السكربت الخارجي: نفس الرابط بالمعرّف نفسه، و`async` فلا يحجب العرض
  assert.ok(
    html.includes(
      `<script id="google-analytics-loader" async="" src="https://www.googletagmanager.com/gtag/js?id=G-HH8N3QCBFV">`
    ),
    html
  );

  // السكربت الداخلي: نفس الأسطر الأربعة المطلوبة بلا زيادة ولا نقصان
  assert.equal(buildGaInlineSnippet('G-HH8N3QCBFV'), [
    'window.dataLayer = window.dataLayer || [];',
    'function gtag(){dataLayer.push(arguments);}',
    "gtag('js', new Date());",
    "gtag('config', 'G-HH8N3QCBFV');",
  ].join('\n'));
  assert.ok(html.includes('<script id="google-analytics-init">window.dataLayer = window.dataLayer || [];'));
  assert.ok(html.includes("gtag('js', new Date());"), 'أمر js مفقود');
  assert.ok(html.includes("gtag('config', 'G-HH8N3QCBFV');"), 'أمر config بالمعرّف مفقود');

  // والترتيب صحيح: إنشاء الطابور وتعريف gtag قبل أمر التهيئة، والمكتبة تُطلب قبلهما
  assert.ok(
    html.indexOf('google-analytics-loader') < html.indexOf('google-analytics-init'),
    'السكربت الداخلي سبق تحميل المكتبة'
  );
  assert.ok(
    html.indexOf('window.dataLayer = window.dataLayer || []') < html.indexOf("gtag('config'"),
    'الأوامر سُجّلت قبل إنشاء الطابور'
  );

  // ولا وسم إضافي غير مطلوب داخل الرأس (لا تعليق HTML ظاهر ولا سكربت ثالث)
  assert.equal([...html.matchAll(/<script/g)].length, 2, 'عدد سكربتات Google Analytics ليس 2');
});

test('4) الروابط والنطاقات تُبنى من المعرّف فلا تنفصل عنه', () => {
  assert.equal(DEFAULT_GA_MEASUREMENT_ID, 'G-HH8N3QCBFV');
  assert.equal(buildGaScriptUrl('G-HH8N3QCBFV'), 'https://www.googletagmanager.com/gtag/js?id=G-HH8N3QCBFV');
  assert.equal(GA_SCRIPT_HOST, 'www.googletagmanager.com');
  assert.equal(GA_COLLECT_HOST, 'www.google-analytics.com');
  // النطاقان يُربطان مسبقًا بـ dns-prefetch فقط (بلا preconnect يفتح اتصالًا لكل زائر)
  assert.deepEqual([...GA_HOSTS], ['www.googletagmanager.com', 'www.google-analytics.com']);
  const layout = stripComments(read('app/layout.tsx'));
  // الربط المسبق مشروط بتشغيل الوسم: عند الإيقاف لا يبقى في الرأس أي أثر لـ Google
  assert.match(
    layout,
    /gaMeasurementId\s*\?[\s\S]{0,120}GA_HOSTS\.map\(\(host\) =>/,
    'ربط نطاق القياس مسبقًا مفقود من الرأس أو غير مشروط بمفتاح التشغيل'
  );
  assert.ok(!layout.includes('rel="preconnect"'), 'preconnect لجهة خارجية');
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ③ مصدر واحد للحقيقة
 * ──────────────────────────────────────────────────────────────────────────── */

test('5) لا معرّف ولا نطاق Google مكتوب في المكوّنات أو الصفحات', () => {
  const violations = scanForbiddenPatterns(repoRoot, ['components', 'app'], [
    { regex: /G-HH8N3QCBFV/, reason: 'معرّف القياس مكتوب خارج lib/analytics/google-analytics.ts' },
    { regex: /googletagmanager\.com/, reason: 'نطاق gtag مكتوب خارج المصدر الواحد' },
    { regex: /google-analytics\.com/, reason: 'نطاق إرسال القياس مكتوب خارج المصدر الواحد' },
  ]);
  assert.deepEqual(
    violations.map((violation) => `${violation.file}: ${violation.reason}`),
    []
  );
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ④ الأداء: لا شيء يعطّل التحميل
 * ──────────────────────────────────────────────────────────────────────────── */

test('6) لا شيء يعطّل أول رسم: async بلا beforeInteractive ولا حقن HTML خام', () => {
  const component = stripComments(read('components/GoogleAnalytics.tsx'));
  assert.match(component, /\basync\b/, 'السكربت الخارجي بلا async');
  assert.ok(!component.includes('dangerouslySetInnerHTML'), 'حقن HTML خام في الوسم');
  assert.ok(!component.includes('beforeInteractive'), 'سكربت يوقف أول رسم للصفحة');
  assert.ok(!component.includes('document.write('), 'كتابة مباشرة في مستند الصفحة');
  assert.ok(!component.includes('next/script'), 'استخدام next/script يؤخّر الوسم إلى نهاية الجسم');

  // المكوّن لا يضيف أي عنصر مرئي: وسمان فقط ثم null
  const html = renderToStaticMarkup(GoogleAnalytics());
  assert.equal(html.trim().startsWith('<script'), true, html);
  assert.equal(html.trim().endsWith('</script>'), true, html);
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ⑤ التنقّل الداخلي: لا زيارة مفقودة ولا صفحة محسوبة مرتين
 * ──────────────────────────────────────────────────────────────────────────── */

test('7) قياس التنقّل: تُرسل الصفحات الجديدة مرة واحدة ولا تُحتسب صفحة الدخول مرتين', () => {
  // أول تشغيل للأثر = صفحة الدخول، وقد أرسلها config ⇒ لا إرسال
  assert.equal(shouldTrackGaPageView(null, '/'), false, 'صفحة الدخول سُجّلت مرتين');
  // إعادة رسم بلا تنقّل ⇒ لا إرسال
  assert.equal(shouldTrackGaPageView('/matches/2026-10-15', '/matches/2026-10-15'), false);
  // تنقّل حقيقي ⇒ إرسال
  assert.equal(shouldTrackGaPageView('/', '/matches/2026-10-15'), true);
  assert.equal(shouldTrackGaPageView('/', '/news?page=2'), true);

  // وبيانات الحدث المرسل هي حقول GA4 الصحيحة، والمعرّف يُمرَّر صريحًا في send_to
  const command = buildGaPageViewCommand({
    pagePath: '/matches/2026-10-15',
    pageLocation: 'https://nemo-live-kora.vercel.app/matches/2026-10-15',
    pageTitle: 'جدول مباريات 15 أكتوبر 2026',
    measurementId: 'G-HH8N3QCBFV',
  });
  assert.deepEqual(command, [
    'event',
    'page_view',
    {
      page_path: '/matches/2026-10-15',
      page_location: 'https://nemo-live-kora.vercel.app/matches/2026-10-15',
      page_title: 'جدول مباريات 15 أكتوبر 2026',
      send_to: 'G-HH8N3QCBFV',
    },
  ]);

  // والمكوّن العميل: يستمع لتغيّر المسار، ويحرس غياب gtag (مانع إعلانات/تحميل فاشل)، ولا يرسم شيئًا
  const tracker = stripComments(read('components/GoogleAnalyticsPageViews.tsx'));
  assert.match(tracker, /'use client'/);
  assert.match(tracker, /usePathname\(\)/, 'المكوّن لا يتابع تغيّر المسار');
  assert.match(tracker, /window\.location\.search/, 'سلسلة الاستعلام غير مشمولة في القياس');
  assert.match(tracker, /typeof gtag !== 'function'/, 'لا حارس لغياب gtag');
  assert.match(tracker, /return null;/, 'المكوّن يرسم عنصرًا في الصفحة');
  assert.ok(!tracker.includes('useSearchParams'), 'useSearchParams يحوّل الصفحات الساكنة إلى ديناميكية');
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ⑥ مفتاح الإيقاف وسلامة المعرّف
 * ──────────────────────────────────────────────────────────────────────────── */

test('8) مفتاح الإيقاف يوقف الوسم كاملًا: لا سكربت ولا أثر في HTML', () => {
  withEnv({ NEXT_PUBLIC_GA_ENABLED: undefined, NEXT_PUBLIC_GA_MEASUREMENT_ID: undefined }, () => {
    assert.equal(isGoogleAnalyticsEnabled(), true, 'الوسم يجب أن يكون مفعّلًا افتراضيًا');
    assert.equal(isGoogleAnalyticsActive(), true);
    assert.equal(resolveGaMeasurementId(), DEFAULT_GA_MEASUREMENT_ID);
    assert.notEqual(renderToStaticMarkup(GoogleAnalytics()), '');
  });

  withEnv({ NEXT_PUBLIC_GA_ENABLED: 'off' }, () => {
    assert.equal(isGoogleAnalyticsEnabled(), false);
    assert.equal(isGoogleAnalyticsActive(), false, 'المفتاح الرئيسي لم يوقف الوسم');
    assert.equal(renderToStaticMarkup(GoogleAnalytics()), '', 'وسم ظهر رغم الإيقاف');
  });
});

test('9) المعرّف قابل للاستبدال من البيئة، والقيمة غير الصالحة تُرفض بلا إرسال أي بيانات', () => {
  // تبديل المعرّف (حساب آخر أو نطاق آخر) بلا تعديل كود
  withEnv({ NEXT_PUBLIC_GA_MEASUREMENT_ID: 'g-abcd123456' }, () => {
    assert.equal(resolveGaMeasurementId(), 'G-ABCD123456', 'المعرّف البديل لم يُطبَّع/يُستخدم');
    const html = renderToStaticMarkup(GoogleAnalytics());
    assert.ok(html.includes('id=G-ABCD123456'), 'الرابط لم يستخدم المعرّف البديل');
    assert.ok(!html.includes(DEFAULT_GA_MEASUREMENT_ID), 'المعرّف الافتراضي بقي مع بديل مضبوط');
    assert.ok(html.includes("gtag('config', 'G-ABCD123456');"), 'أمر config لم يستخدم المعرّف البديل');
  });

  // محاولة حقن سكربت عبر متغيّر البيئة: تُرفض بنيويًا (المعرّف يُدرج في محتوى سكربت داخلي)
  for (const hostile of ['G-X</script><script>alert(1)</script>', 'UA-123', '', ' ', '__proto__']) {
    withEnv({ NEXT_PUBLIC_GA_MEASUREMENT_ID: hostile }, () => {
      if (hostile.trim() === '') {
        // الفراغ يعني «لم يُضبط» ⇒ يعود إلى المعرّف الافتراضي المتفق عليه
        assert.equal(resolveGaMeasurementId(), DEFAULT_GA_MEASUREMENT_ID);
        return;
      }
      assert.equal(resolveGaMeasurementId(), null, `معرّف غير صالح قُبل: ${hostile}`);
      assert.equal(isGoogleAnalyticsActive(), false, `وسم نُشر بمعرّف غير صالح: ${hostile}`);
      assert.equal(renderToStaticMarkup(GoogleAnalytics()), '', `أثر في HTML لمعرّف غير صالح: ${hostile}`);
    });
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ⑦ أداة التحقّق الحيّة (بعد كل نشر)
 * ──────────────────────────────────────────────────────────────────────────── */

test('10) أداة التحقّق على الموقع المنشور تقرأ المصدر الواحد ولا تكتب معرّفًا بنفسها', () => {
  const script = stripComments(read('scripts/audit-analytics.ts'));

  // تقرأ المعرّف والنطاقات من المصدر الواحد — لا نسخة ثانية تتباعد مع الوقت
  assert.match(script, /from '\.\.\/lib\/analytics\/google-analytics'/, 'الأداة لا تستورد المصدر الواحد');
  assert.match(script, /resolveGaMeasurementId\(\)/, 'الأداة لا تحلّ المعرّف من المصدر الواحد');
  assert.match(script, /buildGaScriptUrl\(/, 'الأداة لا تبني رابط المكتبة من نفس الدالة');

  const violations = scanForbiddenPatterns(repoRoot, ['scripts'], [
    { regex: /G-HH8N3QCBFV/, reason: 'معرّف القياس مكتوب داخل الأداة' },
    { regex: /googletagmanager\.com/, reason: 'نطاق gtag مكتوب داخل الأداة' },
  ]);
  assert.deepEqual(
    violations.map((violation) => `${violation.file}: ${violation.reason}`),
    []
  );

  // ومُسجَّلة كأمر npm مثل بقية أدوات التدقيق في المستودع
  const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert.equal(pkg.scripts?.['audit:analytics'], 'node --import tsx scripts/audit-analytics.ts');
});
