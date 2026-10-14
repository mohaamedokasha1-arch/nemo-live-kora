import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import NemoLogo, {
  NemoMark,
  NEMO_BRAND_COLORS,
  NEMO_MARK_PILLARS,
  NEMO_MARK_STRIKE_POINTS,
  NEMO_MARK_VIEWBOX,
  NEMO_LOGO_VIEWBOX,
  NEMO_LOGO_TRACKING_SUB,
  NEMO_LOGO_TRACKING_WORD,
} from '../components/NemoLogo';
import { stripComments } from './helpers/source-scan';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  حراسة شعار NEMO Sports الأصلي (الموقع المرجعي) — بلا أي إعادة رسم
 * ═══════════════════════════════════════════════════════════════════════════════
 *  طلب صاحب المنتج (2026-10-14): «استخدم نفس اللوجو الأصلي الموجود في الموقع
 *  المرجعي، دون إعادة تصميمه أو توليد نسخة تقريبية منه».
 *
 *  لذلك الملفات الثلاثة منسوخة **بايتًا ببايت** من مستودع الموقع المرجعي، وهذه
 *  الاختبارات تمنع أي انحراف لاحق: تُحسب بصمة git-blob للملف (نفس الخوارزمية التي
 *  يستخدمها git) وتُقارن ببصمة الملف الأصلي الموثّقة من المصدر.
 *
 *  بصمات المصدر (mohaamedokasha1-arch/sport → nemo-sports/، الإصدار
 *  c715149d78da995602df5b0e353318cac1deb25b، فرع main):
 *    app/icon.svg        375a8323c333b3ac9aebe348c8c518afafe8051b   (306 بايت)
 *    brand/nemo-logo.svg 265026dc07097b166f8e6d8f145991477e9a19fb   (769 بايت)
 *    brand/nemo-mark.svg 4957b0b47e72918e7afa38b43d4afaffc9ca427e   (307 بايت)
 *
 *  وكل فحص للنصوص البرمجية يمرّ عبر stripComments: ملفاتنا تشرح في تعليقاتها الشعار
 *  السابق المرفوض، وفحص النص الخام يعتبر التعليق مخالفة (إنذار كاذب).
 */

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf-8');
const bytes = (rel: string) => fs.readFileSync(path.join(repoRoot, rel));

/** بصمة git-blob: sha1("blob <length>\0<content>") — نفس ما يحسبه git تمامًا. */
function gitBlobSha(content: Buffer): string {
  return crypto
    .createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${content.length}\0`, 'utf-8'), content]))
    .digest('hex');
}

const ORIGINAL_FILES = {
  'app/icon.svg': {
    sha: '375a8323c333b3ac9aebe348c8c518afafe8051b',
    size: 306,
    source: 'nemo-sports/app/icon.svg',
  },
  'public/nemo-logo.svg': {
    sha: '265026dc07097b166f8e6d8f145991477e9a19fb',
    size: 769,
    source: 'nemo-sports/brand/nemo-logo.svg',
  },
  'public/nemo-mark.svg': {
    sha: '4957b0b47e72918e7afa38b43d4afaffc9ca427e',
    size: 307,
    source: 'nemo-sports/brand/nemo-mark.svg',
  },
} as const;

test('1) ملفات الشعار الثلاثة منسوخة بايتًا ببايت من الموقع المرجعي (بلا إعادة رسم)', () => {
  for (const [file, expected] of Object.entries(ORIGINAL_FILES)) {
    const content = bytes(file);
    assert.equal(content.length, expected.size, `${file}: الحجم تغيّر عن الأصل`);
    assert.equal(
      gitBlobSha(content),
      expected.sha,
      `${file}: البايتات لم تعد مطابقة لـ ${expected.source}`
    );
  }
});

test('2) علامة الشعار في المكوّن تطابق أشكال الملف الأصلي حرفيًا', () => {
  const mark = read('public/nemo-mark.svg');

  // منطقة الرسم
  assert.ok(mark.includes(`viewBox="${NEMO_MARK_VIEWBOX}"`), 'viewBox العلامة مختلف');

  // الدربان: نفس الإحداثيات والأبعاد (10×34 عند x=5 و x=33 من y=7)
  for (const pillar of NEMO_MARK_PILLARS) {
    const expectedRect = `x="${pillar.x}" y="${pillar.y}" width="${pillar.width}" height="${pillar.height}"`;
    assert.ok(mark.includes(expectedRect), `الملف الأصلي لا يحوي المستطيل ${expectedRect}`);
  }
  assert.equal(NEMO_MARK_PILLARS.length, 2, 'العلامة الأصلية دربان لا أكثر');

  // القُطر الذهبي
  assert.ok(
    mark.includes(`points="${NEMO_MARK_STRIKE_POINTS}"`),
    'نقاط القُطر في المكوّن لا تطابق الملف الأصلي'
  );

  // ألوان الهوية: الدربان كحلي والقُطر ذهبي
  assert.ok(mark.includes(`fill="${NEMO_BRAND_COLORS.navy}"`), 'كحلي الهوية مفقود من الملف');
  assert.ok(mark.includes(`fill="${NEMO_BRAND_COLORS.gold}"`), 'ذهبي الهوية مفقود من الملف');

  // العلامة أشكال هندسية فقط: لا تدرّجات ولا صورة ولا نص
  assert.ok(!mark.includes('<linearGradient'), 'ظهر تدرّج في العلامة الأصلية');
  assert.ok(!mark.includes('<text'), 'ظهر نص حيّ داخل العلامة (يجب أن تبقى أشكالًا)');
  assert.ok(!mark.includes('<image'), 'ظهرت صورة نقطية داخل العلامة');
});

test('3) الشعار الكامل (public/nemo-logo.svg) هو الأصل: العلامة + NEMO + SPORTS', () => {
  const logo = read('public/nemo-logo.svg');
  assert.ok(logo.includes(`viewBox="${NEMO_LOGO_VIEWBOX}"`), 'منطقة رسم الشعار الكامل مختلفة');
  assert.ok(logo.includes('>NEMO</text>'), 'اسم NEMO مفقود من الشعار الكامل');
  assert.ok(logo.includes('>SPORTS</text>'), 'اسم SPORTS مفقود من الشعار الكامل');
  // نسخة الشعار الكامل لها هندستها الخاصة داخل الملف الأصلي (علامة أكبر بجانب النص):
  // دربان 12×44 عند x=16 و x=52 (y=18)، وقُطر بنقاط 18,62 29,62 62,18 51,18.
  assert.ok(logo.includes('x="16" y="18" width="12" height="44"'), 'درب العلامة الأيسر مفقود');
  assert.ok(logo.includes('x="52" y="18" width="12" height="44"'), 'درب العلامة الأيمن مفقود');
  assert.ok(logo.includes('points="18,62 29,62 62,18 51,18"'), 'قُطر العلامة مفقود من الشعار الكامل');
  assert.ok(logo.includes('aria-label="NEMO Sports"'), 'وصف الشعار الأصلي للقارئات مفقود');
  // الذهبي الرسمي (القُطر) والذهبي العميق المستخدم لكلمة SPORTS في الملف الأصلي
  assert.ok(logo.includes(NEMO_BRAND_COLORS.gold), 'الذهب الرسمي مفقود');
  assert.ok(logo.includes(NEMO_BRAND_COLORS.goldDeep), 'الذهب العميق لكلمة SPORTS مفقود');
  assert.ok(!logo.includes('<linearGradient'), 'تدرّج دخيل على الشعار الأصلي');
});

test('4) أيقونة التبويب: مربّع كحلي بزوايا دائرية + دربان أبيضان + قُطر ذهبي', () => {
  const icon = read('app/icon.svg');
  assert.ok(icon.includes('viewBox="0 0 48 48"'), 'منطقة رسم الأيقونة مختلفة');
  assert.ok(icon.includes('rx="8"'), 'استدارة زوايا الأيقونة مختلفة');
  assert.ok(icon.includes(`fill="${NEMO_BRAND_COLORS.navy}"`), 'خلفية الأيقونة ليست كحلي الهوية');
  assert.ok(icon.includes(`fill="${NEMO_BRAND_COLORS.white}"`), 'الدربان الأبيضان مفقودان');
  assert.ok(icon.includes(`fill="${NEMO_BRAND_COLORS.gold}"`), 'القُطر الذهبي مفقود');
  assert.ok(!icon.includes('<text'), 'الأيقونة يجب أن تكون أشكالًا بلا نص');
});

test('5) المكوّن ينقل المكوّن الأصلي: الاسم نص حيّ بتباعد وأوزان المصدر، والاتجاه ltr', () => {
  const source = stripComments(read('components/NemoLogo.tsx'));

  // نفس التباعدات والأوزان المستخدمة في Logo.tsx الأصلي (القواعد في globals.css)
  const css = stripComments(read('app/globals.css'));
  assert.match(css, /letter-spacing: 0\.14em/, 'تباعد NEMO مختلف عن الأصل');
  assert.match(css, /letter-spacing: 0\.34em/, 'تباعد Sports مختلف عن الأصل');
  assert.match(css, /font-weight: 700/, 'وزن NEMO مختلف عن الأصل');
  assert.match(css, /font-weight: 600/, 'وزن Sports مختلف عن الأصل');
  assert.equal(NEMO_LOGO_TRACKING_WORD, '0.14em');
  assert.equal(NEMO_LOGO_TRACKING_SUB, '0.34em');
  assert.match(source, /Math\.max\(18, markSize \* 0\.62\)/, 'حجم الاسم لا يتبع معادلة الأصل');
  // الاسم لاتيني دائمًا ⇒ اتجاه ltr ثابت (كما في الأصل)
  assert.match(source, /dir="ltr"/, 'الشعار بلا اتجاه ltr');
  // الشعار الكامل = علامة + كتلة نصية، وليس رسومًا مخترعة للحروف
  assert.match(source, />\s*NEMO\s*</, 'كلمة NEMO ليست نصًا حيًّا');
  assert.match(source, />\s*Sports\s*</, 'كلمة Sports ليست نصًا حيًّا');
});

test('6) الألوان: كحلي/أبيض/ذهبي الهوية فقط — ولا أثر للشعار السابق ولا تدرّجاته', () => {
  const source = stripComments(read('components/NemoLogo.tsx'));
  assert.ok(source.includes('#0F1B2E'), 'كحلي الهوية مفقود من المكوّن');
  assert.ok(source.includes('#FFFFFF') || source.includes('#ffffff'), 'الأبيض مفقود');
  assert.ok(source.includes('#D4AF37'), 'الذهب الرسمي مفقود');
  assert.ok(source.includes('#856515'), 'ذهب وضع الهوية (gold-700) مفقود');
  // لا تدرّجات إطلاقًا (قاعدة الهوية الأصلية: no gradients)
  assert.ok(!source.includes('linearGradient'), 'ظهر تدرّج في الشعار');
  assert.ok(!source.includes('stopColor'), 'ظهرت محطات تدرّج في الشعار');
  // ولا أي بقية من الشعار السابق
  for (const leftover of ['nemoKoraBadge', 'nemoKoraGold', '#1d2b45', '#0b1424', '#e6c87e', '#c9a24e']) {
    assert.ok(!source.includes(leftover), `بقية من الشعار السابق: ${leftover}`);
  }
});

test('7) الأوضاع اللونية الثلاثة تعمل، والعلامة تتلوّن كما في الأصل', () => {
  // الوضع الفاتح (الهيدر/الفوتر): دربان أبيضان + قُطر ذهبي — تمامًا كالأيقونة الرسمية
  const light = renderToStaticMarkup(NemoMark({ size: 38, tone: 'light' }));
  assert.equal(
    (light.match(new RegExp(`fill="${NEMO_BRAND_COLORS.white}"`, 'g')) ?? []).length,
    2,
    'الوضع الفاتح: الدربان ليسا أبيضين'
  );
  assert.ok(light.includes(`fill="${NEMO_BRAND_COLORS.gold}"`), 'الوضع الفاتح: القُطر ليس ذهبيًا');

  // وضع الهوية: دربان بلون النص المحيط (كما في المكوّن الأصلي) + قُطر ذهبي
  const brand = renderToStaticMarkup(NemoMark({ size: 38, tone: 'brand' }));
  assert.equal(
    (brand.match(/fill="currentColor"/g) ?? []).length,
    2,
    'وضع الهوية: الدربان لا يتبعان لون النص كما في الأصل'
  );
  assert.ok(brand.includes(`fill="${NEMO_BRAND_COLORS.gold}"`), 'وضع الهوية: القُطر ليس ذهبيًا');

  // الوضع الأحادي: كل العناصر بلون النص
  const mono = renderToStaticMarkup(NemoMark({ size: 38, tone: 'mono' }));
  assert.equal(
    (mono.match(/fill="currentColor"/g) ?? []).length,
    3,
    'الوضع الأحادي لا يستخدم لون النص في كل العناصر'
  );

  // وأوضاع الرسم نفسها موجودة في CSS (ألوان الاسم والسطر الثاني من المكوّن الأصلي)
  const css = stripComments(read('app/globals.css'));
  assert.match(css, /\.kl-nemo-logo--light \.kl-nemo-word \{\s*color: #ffffff;/, 'لون الاسم الفاتح');
  assert.match(css, /\.kl-nemo-logo--light \.kl-nemo-sub \{\s*color: #d4af37;/, 'لون SPORTS الفاتح');
  assert.match(css, /\[data-theme='dark'\] \.kl-nemo-logo--brand \.kl-nemo-sub \{\s*color: #b8912c;/, 'gold-600 للوضع الداكن');
});

test('8) الشعار الكامل يُرسم عمليًا بالمقاسات الأصلية والاتجاه الصحيح', () => {
  const html = renderToStaticMarkup(NemoLogo({ size: 38 }));
  assert.ok(html.includes('dir="ltr"'), 'الشعار بلا اتجاه ltr');
  assert.ok(html.includes('kl-nemo-logo--light'), 'وضع الشعار الافتراضي (light) مفقود');
  assert.ok(html.includes('>NEMO<'), 'كلمة NEMO مفقودة من الرسم');
  assert.ok(html.includes('>Sports<'), 'كلمة Sports مفقودة من الرسم');
  // العلامة = مسارا مستطيل + مضلّع، بلا أي صورة نقطية
  assert.equal((html.match(/<rect/g) ?? []).length, 2, 'العلامة يجب أن تكون دربين');
  assert.ok(html.includes('<polygon'), 'القُطر الذهبي مفقود من الرسم');
  assert.ok(!html.includes('<image'), 'ظهرت صورة نقطية داخل الشعار');

  // مقاس 40 (الفوتر كما في الموقع المرجعي) يبقى بنفس النِسب
  const bigger = renderToStaticMarkup(NemoLogo({ size: 40 }));
  assert.ok(bigger.includes('width="40"'), 'مقاس الفوتر لا يُمرَّر للعلامة');
  assert.ok(bigger.includes('24.8px'), 'حجم الاسم لا يتبع نسبة الأصل عند 40');
});

test('9) الهيدر والفوتر يستخدمان المكوّن نفسه — بلا صورة نقطية وبلا نسخة ثانية من الشعار', () => {
  const header = stripComments(read('components/Header.tsx'));
  const footer = stripComments(read('components/Footer.tsx'));

  for (const [name, source] of [
    ['Header', header],
    ['Footer', footer],
  ] as const) {
    assert.match(source, /from '@\/components\/NemoLogo'/, `${name}: لا يستخدم مكوّن الشعار الموحّد`);
    assert.match(source, /<NemoLogo\b/, `${name}: لا يرسم الشعار`);
    assert.ok(!/<img[^>]*nemo-logo/i.test(source), `${name}: يعود لصورة نقطية للشعار`);
    assert.ok(!source.includes('nemoKoraBadge'), `${name}: بقية من الشعار السابق`);
  }

  // الهيدر: مقاس الموقع المرجعي نفسه (38) والوصف العربي سليم
  assert.match(header, /<NemoLogo size=\{38\} className="kl-brand-logo" \/>/);
  assert.match(header, /aria-label="نيمو كورة لايف — NEMO Sports — الصفحة الرئيسية"/);
  // الفوتر: مقاس الموقع المرجعي (40)
  assert.match(footer, /<NemoLogo size=\{40\} tone="light" className="kl-footer-logo" \/>/);

  // ولا أي نسخة ثانية مرسومة يدويًا من العلامة في المشروع كله
  const duplicated = ['components', 'app']
    .flatMap((dir) => walk(path.join(repoRoot, dir)))
    .filter((file) => /\.(tsx|ts)$/.test(file))
    .filter((file) => !file.endsWith('components/NemoLogo.tsx'))
    .filter((file) => {
      const code = stripComments(fs.readFileSync(file, 'utf-8'));
      return code.includes(NEMO_MARK_STRIKE_POINTS);
    });
  assert.deepEqual(duplicated.map((f) => path.relative(repoRoot, f)), [], 'علامة الشعار مكرّرة يدويًا');
});

test('10) قواعد العرض تحفظ الشكل: بلا قصّ ولا تمديد ولا تأثيرات، وتصغير نِسبي على الموبايل', () => {
  const css = stripComments(read('app/globals.css'));

  // لا شيء من حلول الصورة النقطية القديمة على الشعار
  const logoBlock = css.slice(css.indexOf('.kl-nemo-logo {'), css.indexOf('.kl-nav {'));
  assert.ok(logoBlock.length > 0, 'كتلة الشعار مفقودة من CSS');
  for (const banned of ['border-radius', 'object-fit', 'transform: scale', 'filter:', 'scale(']) {
    assert.ok(!logoBlock.includes(banned), `قاعدة مرفوضة على الشعار: ${banned}`);
  }

  // القياس بالمتغيّرات + تصغير نِسبي على الموبايل (38 ← 32) بلا تغيير الشكل
  assert.match(css, /\.kl-brand-logo \{\s*--kl-logo-mark: 38px;/, 'مقاس الهيدر ليس مقاس المرجع');
  assert.match(css, /--kl-logo-word: 23\.56px/, 'حجم اسم الشعار في الهيدر ليس حجم المرجع');
  assert.match(
    css,
    /@media \(max-width: 640px\) \{\s*\.kl-brand-logo \{\s*--kl-logo-mark: 32px;/,
    'التصغير على الموبايل مفقود'
  );
  // النِسب محفوظة: 19.84 / 23.56 = 32 / 38 = 0.8421
  assert.match(css, /--kl-logo-word: 19\.84px/, 'حجم الاسم على الموبايل ليس بنفس النسبة');
  // وخط الهوية هو خط المصدر نفسه بلا تثبيت خط جديد
  assert.match(
    css,
    /--kl-logo-font: "Barlow Condensed", "IBM Plex Sans Arabic", "Arial Narrow", sans-serif;/,
    'مكدّس خط الهوية مختلف عن الأصل'
  );
  // العلامة تُقاس بالمتغيّر نفسه، فلا تمديد ولا قصّ
  assert.match(css, /\.kl-nemo-mark \{[\s\S]*?width: var\(--kl-logo-mark\);[\s\S]*?height: var\(--kl-logo-mark\);/);
});

test('11) أيقونة Apple (لمس الشاشة) مُشتقّة من الأيقونة الأصلية، والملف القديم 1408×768 لم يعد مستخدمًا', () => {
  const appleIcon = path.join(repoRoot, 'app/apple-icon.png');
  assert.equal(fs.existsSync(appleIcon), true, 'app/apple-icon.png مفقود');
  const png = fs.readFileSync(appleIcon);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'الملف ليس PNG سليمًا');
  // IHDR: العرض والارتفاع في البايتات 16..24
  assert.equal(png.readUInt32BE(16), 180, 'عرض أيقونة Apple ليس 180');
  assert.equal(png.readUInt32BE(20), 180, 'ارتفاع أيقونة Apple ليس 180');

  // صورة الاستاد القديمة (1408×768) خرجت من المشروع نهائيًا
  assert.equal(fs.existsSync(path.join(repoRoot, 'public/nemo-logo.png')), false);
  const leftovers = ['components', 'app', 'lib']
    .flatMap((dir) => walk(path.join(repoRoot, dir)))
    .filter((file) => /\.(tsx|ts)$/.test(file))
    .filter((file) => stripComments(fs.readFileSync(file, 'utf-8')).includes('nemo-logo.png'));
  assert.deepEqual(leftovers.map((f) => path.relative(repoRoot, f)), [], 'لا يزال هناك كود يشير للصورة القديمة');
});

/** يمشي على مجلد ويعيد كل الملفات (بلا node_modules أو .next). */
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') return [];
      return walk(full);
    }
    return [full];
  });
}
