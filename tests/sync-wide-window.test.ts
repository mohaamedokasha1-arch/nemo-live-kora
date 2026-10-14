import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * تكامل المزامنة الواسعة: كل المصادر تفشل (لا شبكة)، والمطلوب أن تُطلب كل أيام النافذة،
 * وأن يُسجَّل كل فشل كخطأ مع سببه، وألا تُحذف المباريات المحفوظة.
 */
process.env.NEMO_GATEWAY_STORE_PERSIST = 'off';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nemo-wide-window-'));
process.env.NEMO_DATA_DIR = dataDir;
process.env.NEMO_SYNC_DAYS_BACK = '1';
process.env.NEMO_SYNC_DAYS_AHEAD = '2';
delete process.env.FOOTBALL_DATA_API_KEY;
delete process.env.API_FOOTBALL_KEY;

test('المزامنة المجدولة تطلب كل أيام النافذة وتسجّل كل فشل مصدر مع سببه دون حذف البيانات', async () => {
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    throw new TypeError('fetch failed');
  }) as typeof fetch;

  try {
    const engine = await import('../lib/sync/engine');
    const store = await import('../lib/db/store');
    await store.hydrateStore();
    const matchesBefore = store.getGatewayDatabase().matches.length;

    const log = await engine.runGatewaySync({ mode: 'daily', targetDate: '2026-10-14', trigger: 'اختبار النافذة' });

    // النافذة: 13 → 16 أكتوبر (الأمس واليوم وغدًا وبعد غد)
    assert.ok(log.dateWindow, 'السجل يحمل النافذة');
    assert.equal(log.dateWindow.profile, 'wide');
    assert.deepEqual(log.dateWindow.dates, ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    assert.deepEqual(log.dateWindow.skipped.sportscoreDays, []);
    assert.equal(log.dateWindow.skipped.thesportsdbDayCalls, 0);

    // كل يوم طُلب من المصدرين، لا أكثر ولا أقل.
    // كل يوم يُطلب مرة واحدة على الأقل؛ التكرار المسموح هو إعادة المحاولة الواحدة عند فشل الشبكة.
    const sportscoreDays = new Set(urls.filter((url) => url.includes('/api/v1/fixtures/')).map((url) => url.match(/date=([\d-]+)/)?.[1]));
    assert.deepEqual([...sportscoreDays].sort(), log.dateWindow.dates);
    const tsdbDays = new Set(urls.filter((url) => url.includes('eventsday.php')).map((url) => url.match(/d=([\d-]+)/)?.[1]));
    assert.deepEqual([...tsdbDays].sort(), log.dateWindow.dates, 'TheSportsDB لم يعد يُسقط الأيام بعد اليوم الثالث');

    // كل فشل مصدر مُسجَّل كخطأ مع سبب، لا كنجاح.
    const db = store.getGatewayDatabase();
    const recorded = db.sourceErrors.map((entry) => entry.sourceId);
    for (const source of ['sportscore', 'thesportsdb', 'google-news-rss'] as const) {
      const entry = db.sourceErrors.find((item) => item.sourceId === source);
      assert.ok(entry, `خطأ ${source} مسجّل`);
      assert.equal(entry.errorCode, 'source_unavailable');
      assert.ok(entry.message.length > 0, 'السبب موجود');
    }
    assert.ok(recorded.length >= 3);

    // لا ينجح أي مصدر: يُعاد usedCachedSnapshot، ولا تُحذف مباراة.
    assert.ok(log.sourceResults.every((source) => source.usedCachedSnapshot || source.matchesFetched === 0));
    assert.equal(db.matches.length, matchesBefore, 'المباريات السابقة محفوظة');
  } finally {
    globalThis.fetch = realFetch;
  }
});
