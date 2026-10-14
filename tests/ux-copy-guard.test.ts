import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import NewsSection from '../components/NewsSection';
import AdSlot from '../components/AdSlot';
import { scanForbiddenPatterns, stripComments } from './helpers/source-scan';
import { describeMatchesFreshness } from '../lib/freshness';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  حارس التجربة: لا نصوص تشكّك الزائر ولا أثر لمرحلة الإعداد (UX Copy Guard)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  طلب صاحب المنتج (2026-10-14): مسح أي عبارة تُشكّك الناس في الموقع أو تجعله يبدو
 *  تجريبيًا، وإزالة «حالة المصادر» من الواجهة، وعدم عرض أي رسالة فشل للمستخدم.
 *
 *  المبدأ المُنفَّذ: الصدق يبقى في **البيانات** (لا نخترع نتيجة ولا نعلن بثًا مؤكدًا)،
 *  أما **نص الواجهة** فيكون واثقًا ومهنيًا. فمثلًا تبقى حالة المباراة `unconfirmed`
 *  داخليًا كما هي، لكن ما يُعرض للزائر «قيد التحديث» بدل «غير مؤكدة أو غير متاحة».
 *
 *  ⚠️ كل فحص نصّي يمرّ عبر stripComments: الملفات تشرح في تعليقاتها العبارات القديمة
 *  المرفوضة، وفحص النص الخام يعتبر التعليق مخالفة (إنذار كاذب).
 */

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf-8');

/** عبارات ممنوعة في أي واجهة يراها الزائر. */
const FORBIDDEN_UI_COPY: Array<{ regex: RegExp; reason: string }> = [
  { regex: /لم نتأكّد/, reason: 'تشكيك صريح في الموقع' },
  { regex: /لا نفترض/, reason: 'نبرة غير واثقة' },
  { regex: /لم نتحقق/, reason: 'نبرة غير واثقة' },
  { regex: /لا يوجد بث/, reason: 'إيحاء بخلل في الموقع' },
  { regex: /تعذر تحديث/, reason: 'رسالة فشل ظاهرة للزائر' },
  { regex: /فعّل الإعلانات/, reason: 'أثر مرحلة الإعداد' },
  { regex: /تجريبي/, reason: 'إيحاء بأن الموقع تجريبي' },
  { regex: /ستظهر الأخبار هنا/, reason: 'نص حالة فراغ تجريبي' },
  { regex: /حالة المصادر/, reason: 'صفحة/رابط حالة المصادر مطلوب إزالته' },
  { regex: /قيد الإعداد/, reason: 'أثر مرحلة الإعداد' },
  { regex: /غير مؤكدة أو غير متاحة/, reason: 'نص قديم يشكّك الزائر' },
  { regex: /لم تكتمل/, reason: 'رسالة نقص ظاهرة للزائر' },
  { regex: /غير مؤكدة من المصدر/, reason: 'مسمّى حالة غير واثق' },
  { regex: /تُعرض فقط عند التحقق منها/, reason: 'تشكيك في وجود البث' },
  { regex: /حالة بث مُتحقَّق منها|مُتحقَّق منها عند توفرها/, reason: 'تشكيك في الروابط' },
  { regex: /لا نعرض نتيجة غير مؤكدة/, reason: 'اعتذار عن البيانات' },
  { regex: /لا توجد أخبار في الأرشيف/, reason: 'نص حالة فراغ' },
  { regex: /ليست أخبارًا جديدة/, reason: 'تشكيك في حداثة المحتوى' },
];

test('1) لا عبارة تشكّك الزائر أو تُظهر مرحلة الإعداد في أي واجهة', () => {
  const violations = scanForbiddenPatterns(repoRoot, ['components', 'app', 'lib'], FORBIDDEN_UI_COPY);
  assert.deepEqual(
    violations.map((v) => `${v.file}: ${v.reason}`),
    []
  );
});

test('2) صفحة «حالة المصادر» مُزالة من المسارات ومن كل الروابط', () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, 'app/sources/page.tsx')),
    false,
    'صفحة المصادر ما زالت موجودة'
  );

  const violations = scanForbiddenPatterns(repoRoot, ['components', 'app', 'lib'], [
    { regex: /href=["'`]\/sources["'`]/, reason: 'رابط إلى صفحة المصادر' },
  ]);
  assert.deepEqual(violations.map((v) => v.file), []);
});

test('3) لا رسالة فشل مزامنة تُعرض للزائر — سطر التحديث واثق أو صامت', () => {
  // أي فشل (وصول/شبكة) لا يجب أن يظهر في النص المُعاد
  const failingMeta = {
    lastMatchesSyncAttemptAt: new Date().toISOString(),
    lastMatchesSyncResult: { ok: false } as never,
    lastSuccessfulMatchesSyncAt: null,
    lastLiveSyncAt: null,
  } as never;

  // الكود الفعلي (بلا تعليقات) لا يحتوي أي نص فشل يُعرض للزائر
  const noteCode = stripComments(read('lib/freshness.ts'));
  assert.ok(!/تعذر|فشل/.test(noteCode), 'ملف السطر يحتوي نص فشل');
  assert.ok(noteCode.includes('lastSuccessfulMatchesSyncAt'), 'المنطق لم يعد قائمًا على وقت النجاح');

  // والدالة فعليًا: بلا بيانات نجاح ⇒ لا نص (صمت) بدل رسالة فشل
  const output = describeMatchesFreshness(failingMeta);
  assert.ok(output === null || /آخر تحديث/.test(output), `نص غير مقبول: ${output}`);
  assert.ok(!/تعذر|فشل|خطأ/.test(output ?? ''), `رسالة فشل ظاهرة: ${output}`);
});

test('4) قسم الأخبار يختفي بدل عرض نص فراغ تجريبي، ويُعرض عند وجود أخبار', () => {
  // بلا أخبار: لا شيء يُعرض على الإطلاق (لا صندوق فراغ ولا وعد بمزامنة)
  assert.equal(renderToStaticMarkup(NewsSection({ news: [] })), '');
  assert.equal(renderToStaticMarkup(NewsSection({ news: null as never })), '');

  // مع أخبار: تُعرض العناوين وصفحة الأخبار
  const html = renderToStaticMarkup(
    NewsSection({
      news: [
        {
          id: 'n1',
          slug: 'news-1',
          title: 'الأهلي يفوز على الزمالك في قمة الدوري',
          publisherName: 'المصري اليوم',
          cairoTimeLabel: '٠٩:٣٠ م',
          language: 'ar',
          originalUrl: 'https://example.com/a',
          link: 'https://example.com/a',
        } as never,
      ],
      lastUpdatedLabel: '١٤ أكتوبر ٢٠٢٦، ٠٩:٠٠ ص',
    })
  );
  assert.match(html, /آخر الأخبار الرياضية/);
  assert.match(html, /الأهلي يفوز على الزمالك/);
  assert.match(html, /آخر تحديث/);
});

test('5) المساحات الإعلانية غير المضبوطة لا تُرسم إطلاقًا ولا تُظهر أي نص', () => {
  // المكوّن الخارجي يعود بـ null قبل أي hook أو رسم عندما لا يكون هناك إعلان مضبوط
  const adSlot = stripComments(read('components/AdSlot.tsx'));
  const guard = adSlot.indexOf('if (!ADSENSE_CLIENT_ID || !normalizedSlot) return null;');
  assert.ok(guard > 0, 'لا يوجد إرجاع مبكر عند عدم ضبط الإعلان');
  // داخل المكوّن الافتراضي: لا hook ولا رسم قبل الإرجاع المبكر
  const defaultComponent = adSlot.slice(adSlot.indexOf('export default function AdSlot'));
  const guardInDefault = defaultComponent.indexOf('if (!ADSENSE_CLIENT_ID || !normalizedSlot) return null;');
  assert.ok(!defaultComponent.slice(0, guardInDefault).includes('useRef('), 'hook يعمل قبل الإرجاع المبكر');
  assert.ok(
    !defaultComponent.slice(0, guardInDefault).includes('aria-label'),
    'التسمية تُرسم قبل الإرجاع المبكر'
  );
  assert.ok(defaultComponent.indexOf('<AdUnit') > guardInDefault, 'الوحدة تُرسم قبل التحقق');

  // وحتى عند الضبط: تشغيل بلا معرّف ناشر يعطي لا شيء على الإطلاق
  assert.equal(renderToStaticMarkup(AdSlot({ format: 'leaderboard' })), '');
  assert.equal(renderToStaticMarkup(AdSlot({ format: 'in-article', slotId: '   ' })), '');
  // ولا أي بقايا لصندوق فارغ يحمل نص مرحلة الإعداد
  assert.ok(!/placeholder/i.test(adSlot), 'بقايا نص placeholder');

  // ومكوّنات الخادم تتخطّى إرسال المكوّن أصلًا عند عدم الضبط (لا أثر في بيانات الصفحة)
  const gate = stripComments(read('lib/ads/config.ts'));
  assert.match(gate, /export function shouldRenderAdSlot/);
  assert.match(gate, /export const ADSENSE_CLIENT_ID = \(process\.env\.NEXT_PUBLIC_ADSENSE_CLIENT \|\| ''\)\.trim\(\)/);
  for (const file of [
    'components/WatchStreamBlock.tsx',
    'components/LiveBroadcastView.tsx',
    'components/MatchLandingView.tsx',
    'components/SourceMatchDetails.tsx',
  ]) {
    const source = stripComments(read(file));
    const calls = source.match(/<AdSlot/g)?.length ?? 0;
    const guards = source.match(/shouldRenderAdSlot\(/g)?.length ?? 0;
    // كل مساحة إعلانية في هذه الملفات ملفوفة بفحص واحد: العدد متساوٍ تمامًا
    assert.ok(calls > 0, `${file}: لا توجد مساحة إعلانية`);
    assert.equal(guards, calls, `${file}: عدد الفحوص (${guards}) لا يساوي عدد المساحات (${calls})`);
  }
});

test('6) الأخبار والنتائج تُحدَّث آليًا من الصفحة الرئيسية وصفحة الأخبار', () => {
  const home = read('app/page.tsx');
  const newsPage = read('app/news/page.tsx');

  // الرئيسية تشغّل تحديث المباريات والأخبار معًا عند كل زيارة (نافذة قصيرة)
  assert.match(home, /ensureFreshMatches/);
  assert.match(home, /ensureFreshNews/);
  // وصفحة الأخبار كذلك
  assert.match(newsPage, /ensureFreshNews/);

  // ولا يوجد أي نص مكتوب يدويًا للأخبار أو النتائج في مكوّنات الواجهة
  const violations = scanForbiddenPatterns(repoRoot, ['components'], [
    { regex: /const\s+(NEWS|RESULTS|MATCHES)\s*=\s*\[/, reason: 'بيانات مكتوبة يدويًا في الواجهة' },
  ]);
  assert.deepEqual(violations.map((v) => v.file), []);
});

test('7) مصادر الأخبار المجانية مُوسَّعة لتغطية مصر والكرة العربية والعالمية', () => {
  const feeds = read('lib/sources/google-news-rss.ts');
  // 6 مجموعات أساسية + إضافات 2026-10-14 لتغطية أوسع
  const queries = [...feeds.matchAll(/query:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(queries.length >= 11, `عدد مجموعات الأخبار قليل: ${queries.length}`);
  assert.ok(queries.some((q) => q.includes('الدوري المصري')), 'الدوري المصري مفقود');
  assert.ok(queries.some((q) => q.includes('كأس مصر')), 'كأس مصر مفقود');
  assert.ok(queries.some((q) => q.includes('أفريقيا')), 'البطولات الأفريقية مفقودة');
  assert.ok(queries.some((q) => q.includes('السعودي')), 'الكرة العربية مفقودة');
  assert.ok(queries.some((q) => q.includes('Champions')), 'الكرة العالمية مفقودة');
});
