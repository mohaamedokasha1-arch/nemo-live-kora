#!/usr/bin/env node
/**
 * audit-routes.mjs — أداة تدقيق مسارات (تقريرية فقط، لا تُعدّل شيئًا).
 *
 * تفحص كل مسار عام على خادم HTTP حقيقي (محلي أو منشور) وتسجّل:
 * رمز الحالة، الوجهة الفعلية بعد التحويلات، سلسلة التحويلات، رابط canonical،
 * توجيهات الفهرسة (meta robots + X-Robots-Tag)، العنوان، الوصف، عدد وسوم H1،
 * وجود المحتوى في HTML الأوّلي (لا بعد الجافاسكربت)، وعدد روابط <a href>.
 *
 * التشغيل:  node scripts/audit-routes.mjs https://example.com [ملف-المخرجات.json]
 */
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const OUT = process.argv[3] || null;

/** يستخرج وسمًا واحدًا من HTML. */
function firstMatch(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}

function decodeEntities(value) {
  if (!value) return value;
  return value
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function extract(html, headers) {
  const title = decodeEntities(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = decodeEntities(
    firstMatch(html, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
  );
  const robotsMeta = firstMatch(
    html,
    /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i
  );
  const canonical = decodeEntities(
    firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i)
  );
  const h1s = [...html.matchAll(/<h1[\s>][\s\S]*?<\/h1>/gi)].map((m) =>
    decodeEntities(m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  );
  const hrefs = [...html.matchAll(/<a\b[^>]*\shref=["']([^"']+)["']/gi)].map((m) => m[1]);
  const jsonLd = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => {
      try {
        return JSON.parse(m[1]);
      } catch {
        return { __parseError: true };
      }
    }
  );
  const textOnly = decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title,
    description,
    robotsMeta,
    xRobotsTag: headers.get('x-robots-tag'),
    canonical,
    h1s,
    h1Count: h1s.length,
    hrefCount: hrefs.length,
    internalHrefs: hrefs.filter((h) => h.startsWith('/')),
    jsonLdTypes: jsonLd.flatMap((node) => {
      const graph = node && node['@graph'];
      const items = Array.isArray(graph) ? graph : [node];
      return items.map((item) => item && item['@type']).filter(Boolean);
    }),
    visibleTextChars: textOnly.length,
    // نص تعليمي لصفحات «غير موجود» التي ترجع 200 (soft 404)
    softNotFoundHint: /لم نجد المباراة|لم نجد الصفحة|غير موجود|الصفحة غير موجودة|حدث خطأ/.test(textOnly),
  };
}

async function probe(path) {
  const url = `${BASE}${path}`;
  const chain = [];
  let current = url;
  let response;
  for (let hop = 0; hop < 8; hop += 1) {
    response = await fetch(current, {
      redirect: 'manual',
      headers: { 'user-agent': 'NemoAuditBot/1.0 (+seo audit)' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      chain.push({ from: current, status: response.status, location });
      if (!location) break;
      current = new URL(location, current).toString();
      continue;
    }
    break;
  }

  let html = '';
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('html')) html = await response.text();
  else html = await response.text();

  const isHtml = contentType.includes('html');
  const info = isHtml
    ? extract(html, response.headers)
    : { raw: html.slice(0, 400), contentType, bytes: html.length };

  return {
    requested: path,
    finalUrl: current,
    status: response.status,
    redirected: chain.length > 0,
    hops: chain.length,
    redirectChain: chain,
    contentType,
    bytes: html.length,
    cacheControl: response.headers.get('cache-control'),
    ...info,
  };
}

async function main() {
  const { readFileSync, existsSync } = await import('node:fs');
  const listFile = process.env.ROUTE_LIST || 'scripts/audit-routes.txt';
  if (!existsSync(listFile)) {
    console.error(`missing route list: ${listFile}`);
    process.exit(1);
  }
  const routes = readFileSync(listFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const results = [];
  for (const route of routes) {
    try {
      results.push(await probe(route));
    } catch (error) {
      results.push({ requested: route, error: String(error && error.message ? error.message : error) });
    }
  }

  const summary = results.reduce((acc, r) => {
    const key = r.error ? 'ERR' : String(r.status);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  console.log(`BASE=${BASE}`);
  console.log(`routes=${results.length}`, JSON.stringify(summary));
  for (const r of results) {
    const flag = r.error
      ? `ERROR ${r.error}`
      : [
          r.status,
          r.hops ? `→${r.hops}hop` : '',
          r.robotsMeta ? `robots=${r.robotsMeta}` : '',
          r.xRobotsTag ? `xrobots=${r.xRobotsTag}` : '',
          r.h1Count !== undefined ? `h1=${r.h1Count}` : '',
          r.softNotFoundHint ? 'SOFT404?' : '',
          r.canonical ? '' : 'NO-CANONICAL',
        ]
          .filter(Boolean)
          .join(' ');
    console.log(`  ${r.requested}  ${flag}`);
  }

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), results }, null, 2));
    console.log(`\nwrote ${OUT}`);
  }
}

main();
