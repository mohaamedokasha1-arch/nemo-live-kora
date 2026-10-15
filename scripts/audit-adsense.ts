/**
 * Live Google AdSense audit — يتحقّق من كود إثبات الملكية وتفعيل AdSense على
 * الموقع **المنشور فعليًا**، لا في الكود فقط. قراءة فقط: لا يكتب شيئًا في
 * الموقع ولا في المخزن ولا يستدعي أي مسار إداري.
 *
 *   node --import tsx scripts/audit-adsense.ts
 *   node --import tsx scripts/audit-adsense.ts --base=https://nemo-live-kora.vercel.app
 *   node --import tsx scripts/audit-adsense.ts --out=docs/evidence/adsense.json
 *
 * ما يفحصه لكل صفحة (على HTML الخادم كما يستلمه المتصفح قبل أي جافاسكربت —
 * وهو بالضبط ما تقرأه أداة التحقق من Google عند الضغط على زر «تحقق»):
 *   ① وسم `<script id="google-adsense">` **حقيقي** داخل `<head>` يحمل الرابط
 *      `adsbygoogle.js?client=<المعرّف الفعّال>` (المصدر الواحد:
 *      `resolveAdsenseHeadClient()` في `lib/ads/config.ts`).
 *   ② `async` و`crossorigin="anonymous"` على الوسم نفسه (كما في الطلب حرفيًا).
 *   ③ ميتا `google-adsense-account` بالمعرّف نفسه داخل `<head>` (توثيق الحساب).
 *   ④ المعرّف يظهر داخل الرأس مرة واحدة في السكربت + مرة في الميتا — لا أكثر.
 *   ⑤ الوسم لا يظهر داخل `<body>` إطلاقًا (الموضع المطلوب هو الرأس في كل الصفحات).
 *
 * وتُكتشف صفحات إضافية من الروابط الحقيقية في الصفحة الرئيسية (تاريخ + صفحة
 * هبوط مباراة) حتى لا يقتصر الفحص على مسارات ثابتة مكتوبة يدويًا.
 *
 * رمز الخروج 0 يعني أن كل الصفحات المفحوصة مطابقة. أي نقص ⇒ 1 مع بيان الصفحة
 * والحقل الناقص (يُستخدم مباشرةً بعد كل نشر).
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveAdsenseHeadClient } from '../lib/ads/config';
import { GATEWAY_SITE_URL } from '../lib/site-url';
import { getTodayCairoDate } from '../lib/cairo-time';

/** الصفحات الثابتة التي تُفحص دائمًا (تمثّل كل أنماط المسارات في الموقع). */
const STATIC_PAGES = ['/', '/matches', '/news', '/about', '/contact', '/terms', '/privacy-policy'];

const REQUEST_TIMEOUT_MS = 20_000;

interface PageAudit {
  path: string;
  ok: boolean;
  httpStatus: number | null;
  /** عدد ظهور المعرّف داخل <head> (المتوقع 2: السكربت + ميتا الحساب). */
  clientInHead: number;
  /** وسم السكربت الحقيقي (id=google-adsense) داخل الرأس. */
  hasScript: boolean;
  hasAsync: boolean;
  hasCrossOrigin: boolean;
  hasAccountMeta: boolean;
  /** الوسم ظهر داخل <body> (مخالف — الرأس هو الموضع المطلوب). */
  adsenseTagInsideBody: boolean;
  missing: string[];
  error?: string;
}

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

/** يستخرج عناوين الصفحة من الرابط الجذر لبدء الفحص من الواقع لا من قائمة مكتوبة يدويًا. */
async function discoverPages(base: string): Promise<string[]> {
  const discovered: string[] = [];
  try {
    const html = await fetchText(base);
    const links = [...html.matchAll(/href="(\/matches\/[^"#?]+)"/g)].map((match) => match[1]);
    const datePage = links.find((href) => /^\/matches\/\d{4}-\d{2}-\d{2}$/.test(href));
    const landingPage = links.find((href) => !/^\/matches\/\d{4}-\d{2}-\d{2}$/.test(href));
    if (datePage) discovered.push(datePage);
    if (landingPage) discovered.push(landingPage);
  } catch {
    // الصفحة الرئيسية ستُفحص على أي حال وتُظهر الخطأ في تقريرها
  }
  return discovered;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'user-agent': 'nemo-adsense-audit/1.0 (+read-only)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  if (from < 0) return '';
  const to = source.indexOf(end, from);
  return to < 0 ? source.slice(from) : source.slice(from, to + end.length);
}

/**
 * هل يوجد **وسم `<script>` حقيقي** بهذا المعرّف داخل المقطع؟
 *
 * لماذا لا تكفي مطابقة النص المجرّد؟ لأن Next.js يضع حمولة RSC (شجرة React
 * مُسلسلة) في نهاية `<body>`، وتحتوي أسماء معرّفات الوسوم **كهروب نصي**
 * (`\"id\":\"google-adsense\"`) لا كوسوم فعلية. مطابقة النص كانت تُنتج إنذارًا
 * كاذبًا «الوسم داخل <body>» في كل صفحة — وهو نفس ما قيسته وثيقة GA 2026-10-15.
 */
function hasRealScriptTag(region: string, id: string): boolean {
  return new RegExp(`<script[^>]*\\sid="${id}"`).test(region);
}

function auditHtml(pagePath: string, html: string, httpStatus: number, client: string): PageAudit {
  const head = sliceBetween(html, '<head', '</head>');
  const body = sliceBetween(html, '<body', '</body>');
  // احتياط للصفحات التي لا تُخرج <head> صريحًا
  const headRegion = head || html.slice(0, html.indexOf('<body'));

  const scriptMatch = /<script[^>]*\sid="google-adsense"[^>]*>/.exec(headRegion);
  const scriptTag = scriptMatch?.[0] ?? '';
  const hasScript = Boolean(scriptTag) && scriptTag.includes(`adsbygoogle.js?client=${client}`);
  const hasAsync = /\basync\b/.test(scriptTag);
  const hasCrossOrigin = scriptTag.toLowerCase().includes('crossorigin="anonymous"');
  const hasAccountMeta = new RegExp(
    `<meta[^>]*name="google-adsense-account"[^>]*content="${client.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}"`
  ).test(headRegion);
  const clientInHead = headRegion.split(client).length - 1;
  const adsenseTagInsideBody = hasRealScriptTag(body, 'google-adsense');

  const missing: string[] = [];
  if (!hasScript) missing.push(`سكربت adsbygoogle بالمعرّف ${client} داخل <head>`);
  if (!hasAsync) missing.push('خاصية async على السكربت');
  if (!hasCrossOrigin) missing.push('crossorigin="anonymous" على السكربت');
  if (!hasAccountMeta) missing.push('ميتا google-adsense-account بالمعرّف داخل <head>');
  if (clientInHead !== 2) missing.push(`عدد ظهور المعرّف في الرأس ${clientInHead} بدل 2 (سكربت + ميتا)`);
  if (adsenseTagInsideBody) missing.push('وسم AdSense ظهر داخل <body>');

  return {
    path: pagePath,
    ok: missing.length === 0,
    httpStatus,
    clientInHead,
    hasScript,
    hasAsync,
    hasCrossOrigin,
    hasAccountMeta,
    adsenseTagInsideBody,
    missing,
  };
}

async function auditPage(base: string, pagePath: string, client: string): Promise<PageAudit> {
  try {
    const html = await fetchText(new URL(pagePath, base).toString());
    return auditHtml(pagePath, html, 200, client);
  } catch (error) {
    return {
      path: pagePath,
      ok: false,
      httpStatus: null,
      clientInHead: 0,
      hasScript: false,
      hasAsync: false,
      hasCrossOrigin: false,
      hasAccountMeta: false,
      adsenseTagInsideBody: false,
      missing: ['تعذّر جلب الصفحة'],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const base = (parseArg('base') || process.env.NEMO_ADSENSE_BASE_URL || GATEWAY_SITE_URL).replace(/\/$/, '');
  const out = parseArg('out');

  const client = resolveAdsenseHeadClient();

  const pages = [...STATIC_PAGES, ...(await discoverPages(base)).filter((page) => !STATIC_PAGES.includes(page))];

  const results: PageAudit[] = [];
  for (const page of pages) {
    results.push(await auditPage(base, page, client));
  }

  const failures = results.filter((result) => !result.ok);
  const report = {
    testedAt: new Date().toISOString(),
    todayCairo: getTodayCairoDate(),
    base,
    client,
    expected: {
      placement: 'داخل <head> في كل الصفحات بين الوسمين',
      script: `adsbygoogle.js?client=${client} بخاصية async و crossorigin="anonymous"`,
      accountMeta: `meta name="google-adsense-account" content="${client}"`,
      clientOccurrencesInHead: 2,
      neverInsideBody: true,
    },
    summary: { pages: results.length, passed: results.length - failures.length, failed: failures.length },
    pages: results,
    ok: failures.length === 0,
  };

  for (const result of results) {
    const mark = result.ok ? '✔' : '✘';
    console.log(
      `${mark} ${result.path} — المعرّف في الرأس: ${result.clientInHead}/2 · سكربت: ${result.hasScript ? 'نعم' : 'لا'} · async: ${result.hasAsync ? 'نعم' : 'لا'} · crossorigin: ${result.hasCrossOrigin ? 'نعم' : 'لا'} · ميتا الحساب: ${result.hasAccountMeta ? 'نعم' : 'لا'}` +
        (result.ok ? '' : `\n    الناقص: ${result.missing.join(' · ')}${result.error ? ` (${result.error})` : ''}`)
    );
  }

  console.log(
    `\n${report.ok ? 'مطابِق' : 'غير مطابِق'}: ${report.summary.passed}/${report.summary.pages} صفحة · المعرّف: ${client} · الأساس: ${base}`
  );

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`حُفظ التقرير في ${out}`);
  }

  if (!report.ok) process.exitCode = 1;
}

main();
