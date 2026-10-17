// Optional local audit tooling installed in .cache/browser, not production dependencies.
import { chromium as playwright } from '../.cache/browser/node_modules/playwright-core/index.mjs';
import chromium from '../.cache/browser/node_modules/@sparticuz/chromium/build/index.js';
import fs from 'node:fs';
const phase = process.argv[2] || 'before';
const dir = `.cache/seo-visual/${phase}`;
fs.mkdirSync(dir, { recursive: true });
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const results = [];
const routes = ['/', '/matches', '/matches/2026-10-20', '/matches/zed-vs-azam-2026-10-16', '/news', '/about', '/match/egy-2026-10-15-001'];
for (const width of [390, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Africa/Cairo', locale: 'ar-EG' });
  // External ads/analytics/providers are not exercised or contacted by this comparison.
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  for (const [index, path] of routes.entries()) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto('http://127.0.0.1:3000' + path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const dom = await page.evaluate(() => ({
      title: document.title, canonical: document.querySelector('link[rel=canonical]')?.href,
      robots: document.querySelector('meta[name=robots]')?.content,
      h1: [...document.querySelectorAll('h1')].map(x => x.textContent),
      links: [...document.querySelectorAll('main a')].map(x => ({ href: x.getAttribute('href'), text: x.textContent })),
      overflow: document.documentElement.scrollWidth > innerWidth,
      main: document.querySelector('main')?.innerHTML
    }));
    await page.screenshot({ path: `${dir}/${width}-${index}.png`, fullPage: true, animations: 'disabled' });
    results.push({ path, width, status: response.status(), errors, ...dom });
    await page.close();
  }
  await context.close();
}
await browser.close();
fs.writeFileSync(`${dir}/dom.json`, JSON.stringify(results, null, 2));
console.log(`Captured ${results.length} page/viewports in ${dir}; page errors: ${results.reduce((n,r)=>n+r.errors.length,0)}`);
