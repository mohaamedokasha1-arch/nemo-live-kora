import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import AdsterraBanner, { buildBannerDocument } from '../components/AdsterraBanner';
import AdsterraNative from '../components/AdsterraNative';
import NewsSection from '../components/NewsSection';
import SmartlinkCta from '../components/SmartlinkCta';
import WatchStreamBlock from '../components/WatchStreamBlock';
import {
  ADSTERRA_BANNER_300X250,
  ADSTERRA_BANNER_728X90,
  ADSTERRA_HOSTS,
  ADSTERRA_NATIVE_CONTAINER_ID,
  ADSTERRA_NATIVE_SCRIPT_URL,
  ADSTERRA_POPUNDER_SCRIPT_URL,
  ADSTERRA_SOCIAL_BAR_SCRIPT_URL,
  DEFAULT_ADSTERRA_SMARTLINK_URL,
  isAdsterraFormatEnabled,
  type AdsterraFormat,
} from '../lib/ads/adsterra';
import { resolveWatchDestination } from '../lib/nemo-watch';
import { scanForbiddenPatterns, stripComments } from './helpers/source-scan';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  حراسة وحدات Adsterra الست (2026-10-15)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  طلب صاحب المنتج: تركيب وحدات Adsterra الست في مواضعها الاستراتيجية بلا أي تأثير
 *  على سرعة التحميل. هذه الاختبارات تحوّل الطلب إلى شروط آلية:
 *    ① كل وحدة في موضعها الصحيح داخل الصفحة (Popunder في الرأس، Social Bar في نهاية
 *       الجسم، البانر العريض بين الهيدر والمحتوى).
 *    ② المفاتيح المتفق عليها حرفيًا، ومصدر واحد لها (لا مفتاح مكتوب في مكوّن).
 *    ③ البانر 300×250 فوق زر المشاهدة وتحته وزر الراعي بعده — بلا مزاحمة للزر الرسمي.
 *    ④ الإعلان المدمج (Native) مرة واحدة لكل صفحة، وفي الموضع الذي يخدم المحتوى.
 *    ⑤ لا شيء يعطّل التحميل: لا سكربت متزامن، والبانرات بإطار كسول، والوحدات
 *       المخفية لا تُنزَّل، والمقاسات محجوزة فلا إزاحة تخطيط (CLS).
 *    ⑥ مفتاح إيقاف يعمل لحظيًا: عند إيقافه لا يبقى في الصفحة أي أثر إعلاني.
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
 *  ① المواضع الست داخل الصفحة
 * ──────────────────────────────────────────────────────────────────────────── */

test('1) الوحدات موزّعة في مواضعها: Popunder في الرأس وSocial Bar في نهاية الجسم والبانر العريض أعلى المحتوى', () => {
  const layout = stripComments(read('app/layout.tsx'));

  // ① الإعلان المنبثق: داخل <head> (قبل إغلاقه) وفي كل صفحات الموقع
  const popunderIndex = layout.indexOf('<AdsterraPopunder');
  const headCloseIndex = layout.indexOf('</head>');
  assert.ok(popunderIndex > 0, 'وحدة الـ Popunder غير مركّبة في التخطيط');
  assert.ok(headCloseIndex > popunderIndex, 'وحدة الـ Popunder خارج <head>');

  // ③ البار الاجتماعي: آخر وسم داخل <body> — بعد التذييل مباشرة
  const socialIndex = layout.indexOf('<AdsterraSocialBar');
  const footerIndex = layout.indexOf('<Footer');
  const bodyCloseIndex = layout.indexOf('</body>');
  assert.ok(socialIndex > footerIndex, 'البار الاجتماعي ليس بعد التذييل');
  assert.ok(socialIndex < bodyCloseIndex, 'البار الاجتماعي خارج <body>');

  // ⑥ البانر العريض 728×90: بين الهيدر وبداية المحتوى (أعلى الشاشة الرئيسية)
  const leaderboardIndex = layout.indexOf('<AdsterraBanner size="728x90"');
  const headerIndex = layout.indexOf('<Header />');
  const mainIndex = layout.indexOf('<main');
  assert.ok(leaderboardIndex > headerIndex, 'البانر العريض ليس أسفل الهيدر');
  assert.ok(leaderboardIndex < mainIndex, 'البانر العريض يجب أن يسبق المحتوى الرئيسي');
  assert.match(layout, /kl-ad-leaderboard-slot/, 'الصنف الحاكم لظهور البانر العريض مفقود');

  // ⑤ الإعلان المدمج بين كروت المباريات، والباقي في قسم الأخبار وصفحة الخبر
  assert.match(
    stripComments(read('components/MatchGatewayClient.tsx')),
    /<AdsterraNative/,
    'الإعلان المدمج غير موجود بين كروت المباريات'
  );
  assert.match(
    stripComments(read('components/NewsSection.tsx')),
    /<AdsterraNative/,
    'الإعلان المدمج غير موجود في قسم الأخبار'
  );
  assert.match(
    stripComments(read('app/news/page.tsx')),
    /withNativeAd/,
    'صفحة الأخبار لا تفعّل الإعلان المدمج'
  );
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ② المفاتيح: نفس الأكواد المتفق عليها، ومصدر واحد لها
 * ──────────────────────────────────────────────────────────────────────────── */

test('2) المفاتيح والروابط هي نفسها أكواد Adsterra المتفق عليها حرفيًا', () => {
  // ① Popunder
  assert.equal(
    ADSTERRA_POPUNDER_SCRIPT_URL,
    'https://furydonkeypharmacy.com/45/91/b9/4591b9d89acaef4816e3858fcdd4fb8c.js'
  );
  // ② Smartlink
  assert.equal(
    DEFAULT_ADSTERRA_SMARTLINK_URL,
    'https://furydonkeypharmacy.com/c71f0nh0?key=e98ed29e685da7d0f646c6adf71e66a7'
  );
  // ③ Social Bar
  assert.equal(
    ADSTERRA_SOCIAL_BAR_SCRIPT_URL,
    'https://furydonkeypharmacy.com/40/0b/61/400b61ec64c579e1e11e27f80157c8fc.js'
  );
  // ④ Native Banner: المعرّف نفسه في الحاوية وفي مسار السكربت (لا انفصال بين الاثنين)
  assert.equal(ADSTERRA_NATIVE_CONTAINER_ID, 'container-23d4da70cd556e8aef8683f8494212bb');
  assert.equal(
    ADSTERRA_NATIVE_SCRIPT_URL,
    'https://furydonkeypharmacy.com/23d4da70cd556e8aef8683f8494212bb/invoke.js'
  );
  // ⑤ البانر المربع 300×250
  assert.equal(ADSTERRA_BANNER_300X250.key, '701dbec926e94a740a37b7a03d152b5f');
  assert.equal(ADSTERRA_BANNER_300X250.width, 300);
  assert.equal(ADSTERRA_BANNER_300X250.height, 250);
  assert.equal(
    ADSTERRA_BANNER_300X250.invokeUrl,
    'https://www.highrevenueformat.com/701dbec926e94a740a37b7a03d152b5f/invoke.js'
  );
  // ⑥ البانر العريض 728×90
  assert.equal(ADSTERRA_BANNER_728X90.key, 'd3ac0adacd0e9f8455c8174e938a797a');
  assert.equal(ADSTERRA_BANNER_728X90.width, 728);
  assert.equal(ADSTERRA_BANNER_728X90.height, 90);
  assert.equal(
    ADSTERRA_BANNER_728X90.invokeUrl,
    'https://www.highrevenueformat.com/d3ac0adacd0e9f8455c8174e938a797a/invoke.js'
  );
});

test('3) لا مفاتيح ولا نطاقات إعلانية مكتوبة داخل المكوّنات أو الصفحات', () => {
  // كل نطاق إعلاني لازم يمرّ إلّا من lib/ads/adsterra.ts — فلا تنسخ الصفحة كود الشبكة
  const violations = scanForbiddenPatterns(repoRoot, ['components', 'app'], [
    { regex: /furydonkeypharmacy\.com/, reason: 'نطاق إعلاني مكتوب خارج ملف الإعداد' },
    { regex: /highrevenueformat\.com/, reason: 'نطاق إعلاني مكتوب خارج ملف الإعداد' },
    { regex: /23d4da70cd556e8aef8683f8494212bb/, reason: 'معرّف وحدة مكتوب خارج ملف الإعداد' },
    { regex: /701dbec926e94a740a37b7a03d152b5f/, reason: 'مفتاح البانر المربع مكتوب خارج ملف الإعداد' },
    { regex: /d3ac0adacd0e9f8455c8174e938a797a/, reason: 'مفتاح البانر العريض مكتوب خارج ملف الإعداد' },
  ]);
  assert.deepEqual(
    violations.map((violation) => `${violation.file}: ${violation.reason}`),
    []
  );

  // والنطاقات معلنة مرة واحدة للربط المسبق (dns-prefetch) في الرأس
  assert.deepEqual([...ADSTERRA_HOSTS], ['furydonkeypharmacy.com', 'www.highrevenueformat.com']);
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ③ البانر 300×250 حول زر المشاهدة + زر الراعي
 * ──────────────────────────────────────────────────────────────────────────── */

test('4) بنية كود البانر مطابقة لكود Adsterra: atOptions بالمقاس الصحيح ثم سكربت الوحدة', () => {
  const document = buildBannerDocument(ADSTERRA_BANNER_300X250);

  assert.ok(document.includes("'key' : '701dbec926e94a740a37b7a03d152b5f'"), document);
  assert.ok(document.includes("'format' : 'iframe'"), document);
  assert.ok(document.includes("'height' : 250"), document);
  assert.ok(document.includes("'width' : 300"), document);
  assert.ok(document.includes("'params' : {}"), document);
  // المتغيّر العام يُضبط قبل تحميل سكربت الوحدة (هذا هو شرط عمل البانر)
  assert.ok(
    document.indexOf('atOptions = {') < document.indexOf(ADSTERRA_BANNER_300X250.invokeUrl),
    'atOptions يُضبط بعد سكربت الوحدة'
  );
  assert.ok(document.includes('<script type="text/javascript" src="'), document);
  // والخلفية شفافة فلا يظهر إطار أبيض فوق بطاقة الموقع في الوضع الداكن
  assert.match(document, /background:transparent/);
});

test('5) البانر المربع يُرسم بمقاسه الدقيق وبارتفاع محجوز (لا إزاحة تخطيط)', () => {
  const html = renderToStaticMarkup(AdsterraBanner({ size: '300x250' }));
  assert.match(html, /width="300"/);
  assert.match(html, /height="250"/);
  assert.match(html, /data-ad-unit="300x250"/);
  assert.match(html, /loading="lazy"/, 'الإطار يجب أن يكون كسولًا حتى لا يؤخّر التحميل');
  assert.match(html, /title="[^"]+"/, 'الإطار بلا وصف نصّي لقارئات الشاشة');

  const css = read('app/globals.css');
  const bannerRule = /\.kl-ad-banner-300x250\s*\{[^}]*min-height:\s*250px/.test(css);
  const leaderboardRule = /\.kl-ad-banner-728x90\s*\{[^}]*min-height:\s*90px/.test(css);
  const nativeRule = /\.kl-ad-native\s*\{[^}]*min-height:\s*250px/.test(css);
  assert.ok(bannerRule, 'ارتفاع البانر المربع غير محجوز في CSS');
  assert.ok(leaderboardRule, 'ارتفاع البانر العريض غير محجوز في CSS');
  assert.ok(nativeRule, 'ارتفاع الإعلان المدمج غير محجوز في CSS');
});

test('6) البانر العريض 728×90 لشاشات الكمبيوتر فقط ولا يُنزَّل على الهاتف', () => {
  const css = read('app/globals.css');
  // مخفي افتراضيًا (الهاتف) ولا يظهر إلا من 800 بكسل وما فوق
  assert.match(css, /\.kl-ad-leaderboard-slot\s*\{\s*display:\s*none;\s*\}/);
  assert.match(
    css,
    /@media \(min-width: 800px\)\s*\{\s*\.kl-ad-leaderboard-slot\s*\{\s*display:\s*block;/,
    'البانر العريض لا يظهر على الشاشات الكبيرة'
  );
  // وحين يكون الإطار داخل عنصر مخفي لا يُحمَّل أصلًا (سلوك loading=lazy) فلا ندفع ثمن عرض مخفي
  const html = renderToStaticMarkup(AdsterraBanner({ size: '728x90' }));
  assert.match(html, /kl-ad-banner-728x90/);
  assert.match(html, /loading="lazy"/);
});

test('7) زر الراعي المموّل (Smartlink) يفتح في نافذة جديدة ويُوسم sponsored/nofollow', () => {
  const html = renderToStaticMarkup(SmartlinkCta({}));
  assert.ok(html.includes(DEFAULT_ADSTERRA_SMARTLINK_URL), 'رابط السمارت لينك مفقود');
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer sponsored nofollow"/);
  assert.match(html, /kl-smartlink-badge">إعلان</, 'الوسم الإعلاني الصريح مفقود');
});

test('8) الزر الرسمي للمشاهدة لا يُستبدل بالإعلان: الوجهة تبقى من محرّك المشاهدة', () => {
  const destination = resolveWatchDestination({ matchId: 'x' });
  const html = renderToStaticMarkup(WatchStreamBlock({ destination }));

  // زر المشاهدة يحمل وجهة المنصة الرسمية المحسوبة من lib/nemo-watch.ts
  assert.ok(html.includes(destination.url), 'وجهة المشاهدة الرسمية مفقودة');
  assert.ok(html.includes(`href="${destination.url}"`), 'رابط زر المشاهدة تغيّر');
  // ورابط الراعي يظهر بعده في الصفحة (لا قبله ولا مكانه)
  assert.ok(html.indexOf(DEFAULT_ADSTERRA_SMARTLINK_URL) > html.indexOf(destination.url));

  // ولا يوجد أي رابط إعلاني داخل وسم الزر الرسمي نفسه
  const watchAnchor = /<a[^>]*class="kl-watch-btn"[^>]*>/.exec(html)?.[0] ?? '';
  assert.ok(watchAnchor.length > 0, 'وسم زر المشاهدة غير موجود');
  assert.ok(!watchAnchor.includes('furydonkeypharmacy.com'), 'الزر الرسمي يحمل رابطًا إعلانيًا');
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ④ الإعلان المدمج: مرة واحدة لكل صفحة + سمات السكربت الحرفية
 * ──────────────────────────────────────────────────────────────────────────── */

test('9) الإعلان المدمج يظهر مرة واحدة في الصفحة الواحدة بحاوية الشبكة الصحيحة', () => {
  // لكل ملف موضع واحد فقط لهذا المكوّن (تكرار الحاوية يهدر الإعلان ويكسر الوحدة)
  for (const file of [
    'components/MatchGatewayClient.tsx',
    'components/NewsSection.tsx',
    'app/news/[slug]/page.tsx',
  ]) {
    const source = stripComments(read(file));
    const occurrences = [...source.matchAll(/<AdsterraNative\b/g)].length;
    assert.equal(occurrences, 1, `${file}: عدد وحدات الإعلان المدمج ${occurrences} وليس 1`);
  }

  // وفي صفحة واحدة لا يجتمع مصدران للإعلان المدمج: الرئيسية بها جدول مباريات،
  // فقسم الأخبار فيها يبقى بلا تفعيل، والتفعيل يقع في صفحة الأخبار وحدها.
  assert.ok(
    !stripComments(read('app/page.tsx')).includes('withNativeAd'),
    'الصفحة الرئيسية ستُكرّر حاوية الإعلان المدمج (جدول المباريات + قسم الأخبار)'
  );
  assert.ok(
    !stripComments(read('app/matches/[id]/page.tsx')).includes('withNativeAd'),
    'صفحات التواريخ ستُكرّر حاوية الإعلان المدمج'
  );

  // والمكوّن نفسه يستخدم معرّف الحاوية المطلوب من الشبكة وسمات السكربت كما وردت
  const native = stripComments(read('components/AdsterraNative.tsx'));
  assert.match(native, /ADSTERRA_NATIVE_CONTAINER_ID/, 'معرّف الحاوية غير مستخدم من المصدر الواحد');
  assert.match(native, /strategy="lazyOnload"/, 'الإعلان المدمج يُحمَّل بطريقة تعطّل العرض');
  assert.match(native, /data-cfasync="false"/, 'سمة data-cfasync مفقودة من كود الإعلان المدمج');
  const rendered = renderToStaticMarkup(AdsterraNative({}));
  assert.ok(
    rendered.includes(`id="${ADSTERRA_NATIVE_CONTAINER_ID}"`),
    'حاوية الإعلان المدمج بمعرّف خاطئ'
  );
  assert.match(rendered, /kl-ad-native-caption">إعلان</, 'وسم «إعلان» الصريح مفقود');
});

test('9-ب) قسم الأخبار: الإعلان المدمج مرة واحدة في وسط الشبكة، ولا يظهر في قائمة قصيرة', () => {
  const news = Array.from({ length: 6 }, (_, index) => ({
    id: `n${index}`,
    slug: `news-${index}`,
    title: `خبر رياضي رقم ${index}`,
    publisherName: 'المصري اليوم',
    cairoTimeLabel: '٠٩:٣٠ م',
    language: 'ar',
    originalUrl: `https://example.com/${index}`,
    link: `https://example.com/${index}`,
  }));

  const withAd = renderToStaticMarkup(NewsSection({ news: news as never, withNativeAd: true }));
  assert.equal(
    [...withAd.matchAll(/id="container-/g)].length,
    1,
    'الإعلان المدمج يجب أن يظهر مرة واحدة في قسم الأخبار'
  );
  assert.match(withAd, /kl-ad-native-grid-item/, 'الإعلان المدمج لا يأخذ عرض الصف في الشبكة');
  // وموضعه وسط الأخبار تمامًا: بين الخبر الثاني والخبر الثالث في قائمة من ستة
  const adIndex = withAd.indexOf('kl-ad-native');
  const secondCardIndex = withAd.indexOf('خبر رياضي رقم 1');
  const thirdCardIndex = withAd.indexOf('خبر رياضي رقم 2');
  assert.ok(adIndex > secondCardIndex, 'الإعلان المدمج ظهر قبل بداية الأخبار');
  assert.ok(adIndex < thirdCardIndex, 'الإعلان المدمج ليس في وسط الأخبار');

  // وبدون التفعيل (السلوك الافتراضي) لا يظهر أي أثر له — فلا تتكرّر الحاوية في صفحة فيها جدول مباريات
  const withoutAd = renderToStaticMarkup(NewsSection({ news: news as never }));
  assert.ok(!withoutAd.includes('container-'), 'الإعلان المدمج ظهر بلا تفعيل صريح');

  // وفي قائمة قصيرة (4 أخبار أو أقل) لا يُقحَم إعلان وسط الأخبار
  const shortList = renderToStaticMarkup(
    NewsSection({ news: news.slice(0, 3) as never, withNativeAd: true })
  );
  assert.ok(!shortList.includes('container-'), 'إعلان مدمج ظهر في قائمة أخبار قصيرة');
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ⑤ الأداء: لا شيء يعطّل التحميل
 * ──────────────────────────────────────────────────────────────────────────── */

test('10) لا سكربت إعلاني يعطّل العرض: لا beforeInteractive ولا حقن HTML خام', () => {
  // لا سكربت إعلاني بسياسة beforeInteractive في أي مكان من التطبيق
  const violations = scanForbiddenPatterns(repoRoot, ['components', 'app'], [
    { regex: /strategy="beforeInteractive"/, reason: 'سكربت إعلاني يعطّل أول رسم للصفحة' },
  ]);
  assert.deepEqual(
    violations.map((violation) => `${violation.file}: ${violation.reason}`),
    []
  );

  /*
   * وطبقة الإعلانات نفسها لا تحقن HTML خام ولا تكتب في مستند الصفحة:
   * كود Adsterra يُكتب داخل مستند الإطار المعزول فقط (srcDoc) — أما حقن HTML في
   * مستند الموقع فيبقى محصورًا في مسار JSON-LD المُهرَّب (serializeJsonLd) الذي
   * يحرسه scripts/security-check.ts.
   */
  for (const file of [
    'components/AdsterraBanner.tsx',
    'components/AdsterraPopunder.tsx',
    'components/AdsterraSocialBar.tsx',
    'components/AdsterraNative.tsx',
    'components/SmartlinkCta.tsx',
    'components/WatchStreamBlock.tsx',
  ]) {
    const code = stripComments(read(file));
    assert.ok(!code.includes('dangerouslySetInnerHTML'), `${file}: حقن HTML خام`);
    assert.ok(!code.includes('document.write('), `${file}: كتابة مباشرة في مستند الصفحة`);
  }

  // والبانرات الثابتة معزولة في إطار يمنع خطف المتصفح (لا allow-top-navigation)
  const banner = stripComments(read('components/AdsterraBanner.tsx'));
  assert.match(banner, /sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"/);
  assert.ok(!banner.includes('allow-top-navigation'), 'الإطار يسمح بخطف نافذة الزائر');

  // وربط النطاقات مسبقًا محدود بـ dns-prefetch (لا preconnect يفتح اتصالًا لكل زائر)
  const layout = stripComments(read('app/layout.tsx'));
  assert.match(layout, /rel="dns-prefetch"/);
  assert.ok(!layout.includes('rel="preconnect"'), 'preconnect لجهة إعلانية خارجية');
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ⑥ مفتاح الإيقاف
 * ──────────────────────────────────────────────────────────────────────────── */

test('11) مفتاح الإيقاف يعمل لحظيًا: عند إيقافه لا يبقى أي أثر إعلاني', () => {
  const formats: AdsterraFormat[] = ['popunder', 'socialbar', 'banner300', 'banner728', 'native', 'smartlink'];
  for (const format of formats) {
    assert.equal(isAdsterraFormatEnabled(format), true, `${format}: يجب أن تكون مفعّلة افتراضيًا`);
  }

  withEnv({ NEXT_PUBLIC_ADSTERRA_ENABLED: 'off' }, () => {
    for (const format of formats) {
      assert.equal(isAdsterraFormatEnabled(format), false, `${format}: المفتاح الرئيسي لم يوقفها`);
    }
    assert.equal(renderToStaticMarkup(AdsterraBanner({ size: '300x250' })), '', 'بانر ظهر رغم الإيقاف');
    assert.equal(renderToStaticMarkup(AdsterraBanner({ size: '728x90' })), '', 'بانر عريض ظهر رغم الإيقاف');
    assert.equal(renderToStaticMarkup(AdsterraNative({})), '', 'إعلان مدمج ظهر رغم الإيقاف');
    assert.equal(renderToStaticMarkup(SmartlinkCta({})), '', 'زر راعٍ ظهر رغم الإيقاف');

    // وحتى كتلة المشاهدة تعود إلى زرها وحده بلا أي أثر متبقٍّ
    const clean = renderToStaticMarkup(
      WatchStreamBlock({ destination: resolveWatchDestination({ matchId: 'x' }) })
    );
    assert.ok(clean.includes('kl-watch-btn'), 'زر المشاهدة اختفى عند إيقاف الإعلانات');
    assert.ok(!clean.includes('kl-ad-banner'), 'مساحة إعلانية ظهرت رغم الإيقاف');
    assert.ok(!clean.includes('kl-smartlink'), 'زر الراعي ظهر رغم الإيقاف');
  });

  // وإيقاف وحدة بعينها لا يمسّ غيرها
  withEnv({ NEXT_PUBLIC_ADSTERRA_DISABLED_FORMATS: 'banner300, popunder' }, () => {
    assert.equal(isAdsterraFormatEnabled('banner300'), false);
    assert.equal(isAdsterraFormatEnabled('popunder'), false);
    assert.equal(isAdsterraFormatEnabled('banner728'), true);
    assert.equal(isAdsterraFormatEnabled('native'), true);
    assert.equal(isAdsterraFormatEnabled('smartlink'), true);
    assert.equal(renderToStaticMarkup(AdsterraBanner({ size: '300x250' })), '');
    assert.notEqual(renderToStaticMarkup(AdsterraBanner({ size: '728x90' })), '');
  });

  // ورابط السمارت لينك قابل للاستبدال من البيئة دون تعديل كود (لتبديل الحملة)
  withEnv({ NEXT_PUBLIC_ADSTERRA_SMARTLINK_URL: 'https://example.com/offer?key=abc' }, () => {
    const html = renderToStaticMarkup(SmartlinkCta({}));
    assert.ok(html.includes('https://example.com/offer?key=abc'), 'الرابط البديل لم يُستخدم');
    assert.ok(!html.includes(DEFAULT_ADSTERRA_SMARTLINK_URL), 'الرابط الافتراضي بقي مع بديل مضبوط');
  });
});
