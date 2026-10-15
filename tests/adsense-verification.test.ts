import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from './helpers/source-scan';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  حراسة كود إثبات الملكية وتفعيل Google AdSense (2026-10-15)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  طلب صاحب المنتج: «إضافة كود إثبات الملكية وتفعيل إعلانات Google AdSense في
 *  ملف الـ Root Layout الرئيسي بين <head> و </head> بالكامل» بـ
 *  `crossorigin="anonymous"`، وتحميل سليم بلا أخطاء hydration حتى ترصد أداة
 *  التحقق من Google الرمز فورًا عند الضغط على زر «تحقق». وهذه الاختبارات تحوّل
 *  الطلب إلى شروط آلية:
 *    ① السكربت وميتا الحساب داخل `<head>` في التخطيط الجذري (بين الوسمين حرفيًا).
 *    ② الكود هو نفسه المعطى حرفيًا: نفس الرابط، نفس المعايرة، `async`،
 *       `crossorigin="anonymous"` — وبنية الوسم لا تُدار بـ next/script.
 *    ③ معرّف الناشر المعتمد هو القيمة الافتراضية من مصدر واحد (بلا إعداد بيئة)،
 *       ومتغيّر البيئة يستطيع تجاوزه فقط.
 *    ④ الترتيب داخل الرأس: Google Analytics أولًا، ثم AdSense، ثم Adsterra
 *       Popunder أخيرًا قبل `</head>` — لا تزاحم ولا تأخير للقياس.
 *    ⑤ لا شيء يعطّل التحميل: لا next/script ولا beforeInteractive ولا حقن HTML.
 *
 *  والتدقيق الفعلي على HTML المُخدم بعد كل نشر بأمر واحد:
 *      npm run audit:adsense   (قراءة فقط، رمز خروج 1 عند أي نقص)
 */

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf-8');

/** المعرّف المعتمد في طلب 2026-10-15 — يجب أن يظهر في المصدر الافتراضي فقط. */
const APPROVED_CLIENT_ID = 'ca-pub-5770911159315916';

test('1) السكربت وميتا الحساب معلَّقان بين <head> و </head> في التخطيط الجذري', () => {
  const layout = stripComments(read('app/layout.tsx'));
  const headOpen = layout.indexOf('<head>');
  const headClose = layout.indexOf('</head>');
  assert.ok(headOpen >= 0 && headClose > headOpen, 'الرأس غير موجود في التخطيط الجذري');

  const scriptIndex = layout.indexOf('adsbygoogle.js?client=');
  assert.ok(scriptIndex > headOpen, 'سكربت AdSense ليس داخل <head>');
  assert.ok(scriptIndex < headClose, 'سكربت AdSense خرج بعد إغلاق </head>');

  const metaIndex = layout.indexOf('name="google-adsense-account"');
  assert.ok(metaIndex > headOpen, 'ميتا google-adsense-account ليس داخل <head>');
  assert.ok(metaIndex < headClose, 'ميتا google-adsense-account خرج بعد إغلاق </head>');

  // الوسم مكرر مرة واحدة فقط في التخطيط (لا نسخة ثانية تُخلّ بتعدد الرصد)
  assert.equal(layout.split('adsbygoogle.js?client=').length - 1, 1, 'سكربت AdSense مكرر');
});

test('2) الكود المطلوب حرفيًا: الرابط نفسه + async + crossorigin="anonymous"', () => {
  const layout = stripComments(read('app/layout.tsx'));
  // الرابط مبنيّ من المعرّف الفعّال (مصدر واحد) لا مكتوب مرتين
  assert.ok(
    layout.includes('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}'),
    'رابط السكربت غير مطابق للمطلوب'
  );

  const scriptStart = layout.lastIndexOf('<script', layout.indexOf('adsbygoogle.js'));
  const scriptEnd = layout.indexOf('/>', scriptStart);
  assert.ok(scriptStart > 0 && scriptEnd > scriptStart, 'عنصر السكربت غير مكتمل');
  const scriptTag = layout.slice(scriptStart, scriptEnd);
  assert.ok(/\basync\b/.test(scriptTag), 'السكربت بلا async (يجب أن يحجب التحليل)');
  assert.ok(scriptTag.includes('crossOrigin="anonymous"'), 'crossorigin="anonymous" مفقود');
  assert.ok(scriptTag.includes('id="google-adsense"'), 'معرّف الوسم google-adsense مفقود (يستخدمه التدقيق)');

  // ميتا الحساب تحمل المعرّف الفعّال نفسه — وليس قيمة ثابتة مكتوبة يدويًا
  assert.match(
    layout,
    /<meta name="google-adsense-account" content=\{ADSENSE_CLIENT\}\s*\/>/,
    'ميتا حساب الناشر غير مربوط بالمعرّف الفعّال'
  );
});

test('3) المعرّف المعتمد هو الافتراضي من مصدر واحد، ومتغيّر البيئة يُرجّحه فقط', () => {
  const config = stripComments(read('lib/ads/config.ts'));
  assert.ok(
    config.includes(`export const DEFAULT_ADSENSE_CLIENT_ID = '${APPROVED_CLIENT_ID}'`),
    'المعرّف الافتراضي ليس معرّف الطلب المعتمد'
  );
  // قاعدة الاستخلاص تُرجّح البيئة ثم تعود للافتراضي — لا تعطيل ممكن بالفراغ
  assert.match(
    config,
    /export function resolveAdsenseHeadClient\(\): string \{\s*return \(process\.env\.NEXT_PUBLIC_ADSENSE_CLIENT \|\| ''\)\.trim\(\) \|\| DEFAULT_ADSENSE_CLIENT_ID;\s*\}/,
    'استخلاص المعرّف لا يُرجّح البيئة أو لا يعود للافتراضي'
  );

  const layout = stripComments(read('app/layout.tsx'));
  // التخطيط يستدعي المصدر الواحد ولا يكرر منطق الاستخلاص أو المعرّف
  assert.ok(layout.includes('const ADSENSE_CLIENT = resolveAdsenseHeadClient();'), 'التخطيط لا يقرأ من المصدر الواحد');
  assert.equal(layout.split(APPROVED_CLIENT_ID).length - 1, 0, 'المعرّف مكتوب يدويًا داخل التخطيط');
});

test('4) الترتيب داخل الرأس: Google Analytics أولًا ثم AdSense ثم Popunder أخيرًا', () => {
  const layout = stripComments(read('app/layout.tsx'));
  // الشريحة تنتهي عند `</head>` (غير مضمّنة) ⇒ وجود الـ Popunder فيها يعني أنه قبل الإغلاق
  const head = layout.slice(layout.indexOf('<head>'), layout.indexOf('</head>'));
  const gaIndex = head.indexOf('<GoogleAnalytics');
  const adsenseIndex = head.indexOf('adsbygoogle.js?client=');
  const popunderIndex = head.indexOf('<AdsterraPopunder');
  assert.ok(gaIndex > 0, 'Google Analytics ليست أول الرأس');
  assert.ok(gaIndex < adsenseIndex, 'كود AdSense طغى على موضع Google Analytics');
  assert.ok(adsenseIndex < popunderIndex, 'AdSense ليس قبل Adsterra Popunder في الرأس');
  assert.ok(popunderIndex > 0, 'الـ Popunder خرج من الرأس (ليس قبل </head>)');
});

test('5) لا شيء يعطّل التحميل ولا يكسر hydration: لا next/script ولا حقن HTML', () => {
  const layout = stripComments(read('app/layout.tsx'));
  assert.ok(!layout.includes('next/script'), 'next/script يُلحق الوسم نهاية <body> بعد الترطيب');
  assert.ok(!layout.includes('beforeInteractive'), 'beforeInteractive يحجب أول رسم للصفحة');
  assert.ok(!layout.includes('dangerouslySetInnerHTML'), 'حقن HTML خام في التخطيط');
  assert.ok(!layout.includes('document.write('), 'كتابة مباشرة في مستند الصفحة');
  // الوسم لا يُدار بـ Google Tag Manager ولا يُشترط بحمولة ديناميكية — ثابت في كل صفحة
  assert.ok(!/googletagmanager\.com\/gtm\.js/.test(layout), 'AdSense عبر GTM بدل الوسم المباشر');
});
