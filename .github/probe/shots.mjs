import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const TOM = process.env.TOM;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox', '--lang=ar'] });
const report = [];
async function visit(name, url, viewport, ua, action) {
  const page = await browser.newPage();
  if (ua) await page.setUserAgent(ua);
  await page.setViewport(viewport);
  const errors = []; const failed = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 160)));
  page.on('requestfailed', (r) => { const u = r.url(); if (u.startsWith('http://127.0.0.1')) failed.push(u + ' ' + r.failure()?.errorText); });
  page.on('response', (r) => { const u = r.url(); if (u.startsWith('http://127.0.0.1') && r.status() >= 400) failed.push(u + ' HTTP ' + r.status()); });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => errors.push('GOTO ' + e.message));
  if (action) await action(page);
  const info = await page.evaluate(() => ({
    cards: document.querySelectorAll('.kl-match-card').length,
    h1: document.querySelector('h1')?.textContent?.trim(),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
    firstCards: Array.from(document.querySelectorAll('.kl-match-card')).slice(0, 4).map((c) => c.textContent.replace(/\s+/g, ' ').trim().slice(0, 140)),
  }));
  await page.screenshot({ path: `/tmp/${name}.png`, clip: { x: 0, y: 0, width: viewport.width, height: Math.min(viewport.height * 2, 1700) } });
  report.push({ name, url, viewport: `${viewport.width}x${viewport.height}`, ...info, consoleErrors: errors.slice(0, 6), failedLocalRequests: failed.slice(0, 6) });
  await page.close();
}
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
await visit('m-home', 'http://127.0.0.1:3000/', { width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 }, iphone);
await visit('m-tomorrow', `http://127.0.0.1:3000/matches/${TOM}`, { width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 }, iphone);
await visit('d-home', 'http://127.0.0.1:3000/', { width: 1366, height: 900 });
await visit('d-matches-tab', 'http://127.0.0.1:3000/matches', { width: 1366, height: 900 }, null, async (page) => {
  const buttons = await page.$$('button');
  for (const b of buttons) { const t = await b.evaluate((n) => n.textContent); if (t && t.includes('غدًا')) { await b.click(); break; } }
  await new Promise((r) => setTimeout(r, 800));
});
const firstId = JSON.parse(fs.readFileSync('/tmp/tom.json', 'utf8')).matches[0]?.id;
if (firstId) await visit('m-detail', `http://127.0.0.1:3000/matches/${firstId}`, { width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 }, iphone);
console.log(JSON.stringify(report, null, 1));
await browser.close();
