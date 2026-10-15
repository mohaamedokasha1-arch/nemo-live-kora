/**
 * Live Google Analytics audit — يتحقّق من وسوم Google Analytics على الموقع **المنشور فعليًا**،
 * لا في الكود فقط. قراءة فقط: لا يكتب شيئًا في الموقع ولا في المخزن ولا يستدعي أي مسار إداري.
 *
 *   node --import tsx scripts/audit-analytics.ts
 *   node --import tsx scripts/audit-analytics.ts --base=https://nemo-live-kora.vercel.app
 *   node --import tsx scripts/audit-analytics.ts --out=docs/evidence/analytics.json
 *
 * ما يفحصه لكل صفحة (على HTML الخادم كما يستلمه المتصفح قبل أي جافاسكربت):
 *   ① وسما Google داخل `<head>`: سكربت المكتبة (`async`) وسكربت التهيئة.
 *   ② الرابط يحمل معرّف القياس نفسه (المصدر الواحد: lib/analytics/google-analytics.ts).
 *   ③ أمر `gtag('config', '<ID>');` موجود داخل السكربت الداخلي.
 *   ④ المعرّف يظهر **مرتين** في الرأس: مرة في وسم المكتبة ومرة في أمر config — لا أكثر.
 *   ⑤ ربط مسبق بـ `dns-prefetch` لنطاقَي Google (وبلا `preconnect` لجهة خارجية).
 *   ⑥ لا يظهر أي من الوسمين في `<body>` (الموضع المطلوب هو الرأس في كل الصفحات).
 *
 * وتُكتشف صفحات إضافية من الروابط الحقيقية في الصفحة الرئيسية (تاريخ + صفحة هبوط مباراة)
 * حتى لا يقتصر الفحص على مسارات ثابتة مكتوبة يدويًا.
 *
 * رمز الخروج 0 يعني أن كل الصفحات المفحوصة مطابقة. أي نقص ⇒ 1 مع بيان الصفحة والحقل الناقص
 * (يُستخدم مباشرةً بعد كل نشر).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  GA_COLLECT_HOST,
  GA_SCRIPT_HOST,
  buildGaScriptUrl,
  isGoogleAnalyticsEnabled,
  resolveGaMeasurementId,
} from '../lib/analytics/google-analytics';
import { GATEWAY_SITE_URL } from '../lib/site-url';
import { getTodayCairoDate } from '../lib/cairo-time';

/** الصفحات الثابتة التي تُفحص دائمًا (تمثّل كل أنماط المسارات في الموقع). */
const STATIC_PAGES = ['/', '/matches', '/news', '/about', '/contact', '/terms', '/privacy-policy'];

const REQUEST_TIMEOUT_MS = 20_000;

interface PageAudit {
  path: string;
  ok: boolean;
  httpStatus: number | null;
  /** عدد ظهور المعرّف داخل <head> (المتوقع 2). */
  measurementIdInHead: number;
  hasLoader: boolean;
  hasInlineInit: boolean;
  hasConfigCommand: boolean;
  hasDnsPrefetch: boolean;
  hasPreconnect: boolean;
  gaTagInsideBody: boolean;
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
    headers: { 'user-agent': 'nemo-analytics-audit/1.0 (+read-only)' },
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
 * لماذا لا تكفي مطابقة النص المجرّد (`region.includes('google-analytics-loader')`)؟
 * لأن Next.js يضع حمولة RSC (شجرة React مُسلسلة) في نهاية `<body>`، وتحتوي أسماء
 * معرّفات الوسوم **كهروب نصي** (`\"id\":\"google-analytics-loader\"`) لا كوسوم فعلية.
 * مطابقة النص كانت تُنتج إنذارًا كاذبًا «الوسم داخل <body>» في كل صفحة. المطابقة على
 * وسم `<script` حقيقي تفصل الحالتين بدقة.
 */
function hasRealScriptTag(region: string, id: string): boolean {
  return new RegExp(`<script[^>]*\\sid="${id}"`).test(region);
}

function auditHtml(pagePath: string, html: string, httpStatus: number, measurementId: string): PageAudit {
  const head = sliceBetween(html, '<head', '</head>');
  const body = sliceBetween(html, '<body', '</body>');

  const hasLoader = hasRealScriptTag(head, 'google-analytics-loader') && head.includes(buildGaScriptUrl(measurementId));
  const hasInlineInit = hasRealScriptTag(head, 'google-analytics-init');
  const hasConfigCommand = head.includes(`gtag('config', '${measurementId}');`);
  // معرّف القياس داخل `<head>`: html.slice قبل <body> احتياطًا للصفحات التي لا تُخرج <head> صريحًا
  const headRegion = head || html.slice(0, html.indexOf('<body'));
  const measurementIdInHead = headRegion.split(measurementId).length - 1;
  const hasDnsPrefetch =
    headRegion.includes(`dns-prefetch" href="//${GA_SCRIPT_HOST}`) &&
    headRegion.includes(`dns-prefetch" href="//${GA_COLLECT_HOST}`);
  // preconnect لجهة خارجية ممنوع بقرار المشروع (لا نفتح اتصالًا لكل زائر)
  const hasPreconnect =
    headRegion.includes(`preconnect" href="//${GA_SCRIPT_HOST}`) ||
    headRegion.includes(`preconnect" href="//${GA_COLLECT_HOST}`);
  const gaTagInsideBody =
    hasRealScriptTag(body, 'google-analytics-loader') || hasRealScriptTag(body, 'google-analytics-init');

  const missing: string[] = [];
  if (!hasLoader) missing.push('سكربت المكتبة (id=google-analytics-loader) بمعرّف صحيح داخل <head>');
  if (!hasInlineInit) missing.push('سكربت التهيئة (id=google-analytics-init) داخل <head>');
  if (!hasConfigCommand) missing.push(`أمر gtag('config', '${measurementId}') داخل السكربت الداخلي`);
  if (measurementIdInHead !== 2) missing.push(`عدد ظهور المعرّف في الرأس ${measurementIdInHead} بدل 2`);
  if (!hasDnsPrefetch) missing.push('ربط مسبق (dns-prefetch) لنطاقَي Google');
  if (hasPreconnect) missing.push('preconnect لجهة خارجية (مخالف لقرار المشروع)');
  if (gaTagInsideBody) missing.push('وسم Google ظهر داخل <body>');

  return {
    path: pagePath,
    ok: missing.length === 0,
    httpStatus,
    measurementIdInHead,
    hasLoader,
    hasInlineInit,
    hasConfigCommand,
    hasDnsPrefetch,
    hasPreconnect,
    gaTagInsideBody,
    missing,
  };
}

async function auditPage(base: string, pagePath: string, measurementId: string): Promise<PageAudit> {
  try {
    const html = await fetchText(new URL(pagePath, base).toString());
    return auditHtml(pagePath, html, 200, measurementId);
  } catch (error) {
    return {
      path: pagePath,
      ok: false,
      httpStatus: null,
      measurementIdInHead: 0,
      hasLoader: false,
      hasInlineInit: false,
      hasConfigCommand: false,
      hasDnsPrefetch: false,
      hasPreconnect: false,
      gaTagInsideBody: false,
      missing: ['تعذّر جلب الصفحة'],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const base = (parseArg('base') || process.env.NEMO_ANALYTICS_BASE_URL || GATEWAY_SITE_URL).replace(/\/$/, '');
  const out = parseArg('out');

  const measurementId = resolveGaMeasurementId();
  const enabled = isGoogleAnalyticsEnabled();

  const pages = [...STATIC_PAGES, ...(await discoverPages(base)).filter((page) => !STATIC_PAGES.includes(page))];

  const results: PageAudit[] = [];
  for (const page of pages) {
    results.push(await auditPage(base, page, measurementId ?? ''));
  }

  const failures = results.filter((result) => !result.ok);
  const report = {
    testedAt: new Date().toISOString(),
    todayCairo: getTodayCairoDate(),
    base,
    measurementId,
    tagEnabled: enabled,
    expected: {
      placement: 'داخل <head> في كل الصفحات',
      tagsPerPage: ['google-analytics-loader (async gtag.js)', 'google-analytics-init (dataLayer + js + config)'],
      measurementIdOccurrencesInHead: 2,
      dnsPrefetchHosts: [GA_SCRIPT_HOST, GA_COLLECT_HOST],
    },
    summary: { pages: results.length, passed: results.length - failures.length, failed: failures.length },
    pages: results,
    ok: failures.length === 0,
  };

  for (const result of results) {
    const mark = result.ok ? '✔' : '✘';
    console.log(
      `${mark} ${result.path} — المعرّف في الرأس: ${result.measurementIdInHead}/2 · مكتبة: ${result.hasLoader ? 'نعم' : 'لا'} · تهيئة: ${result.hasInlineInit ? 'نعم' : 'لا'} · config: ${result.hasConfigCommand ? 'نعم' : 'لا'}` +
        (result.ok ? '' : `\n    الناقص: ${result.missing.join(' · ')}${result.error ? ` (${result.error})` : ''}`)
    );
  }

  console.log(
    `\n${report.ok ? 'مطابِق' : 'غير مطابِق'}: ${report.summary.passed}/${report.summary.pages} صفحة · المعرّف: ${measurementId ?? 'غير صالح'} · الوسم: ${enabled ? 'مفعّل' : 'موقوف (NEXT_PUBLIC_GA_ENABLED=off)'} · الأساس: ${base}`
  );

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`حُفظ التقرير في ${out}`);
  }

  if (!report.ok) process.exitCode = 1;
}

main();
