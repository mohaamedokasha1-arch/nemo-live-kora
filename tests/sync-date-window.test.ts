import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWindowDays,
  readSyncWindowConfig,
  resolveQuickSyncWindow,
  resolveSyncWindowForRun,
  resolveWideSyncWindow,
  SYNC_WINDOW_DEFAULT_DAYS_AHEAD,
  SYNC_WINDOW_MAX_DAYS_AHEAD,
  SYNC_WINDOW_MAX_DAYS_BACK,
} from '../lib/sync/date-window';
import { buildTheSportsDBEndpoints } from '../lib/sources/thesportsdb';

test('متغيرات النافذة: القيم الصالحة تُقبل، وغير الصالحة ترجع للافتراضي، والكبيرة تُقصّ للحد', () => {
  assert.equal(parseWindowDays('3', 1, 30), 3);
  assert.equal(parseWindowDays(' 0 ', 1, 30), 0);
  assert.equal(parseWindowDays('-2', 1, 30), 1, 'السالب غير صالح');
  assert.equal(parseWindowDays('abc', 7, 14), 7);
  assert.equal(parseWindowDays('2.5', 7, 14), 7, 'الكسر غير صالح');
  assert.equal(parseWindowDays('', 7, 14), 7);
  assert.equal(parseWindowDays('999', 7, 14), 14, 'القصّ للحد الأقصى');
  assert.equal(parseWindowDays(undefined, 1, 30), 1);

  const config = readSyncWindowConfig({ NEMO_SYNC_DAYS_BACK: '5', NEMO_SYNC_DAYS_AHEAD: '100' });
  assert.deepEqual(config, { daysBack: 5, daysAhead: SYNC_WINDOW_MAX_DAYS_AHEAD });
  assert.deepEqual(readSyncWindowConfig({}), {
    daysBack: 1,
    daysAhead: SYNC_WINDOW_DEFAULT_DAYS_AHEAD,
  });
});

test('النافذة الواسعة تغطي الأمس واليوم وغدًا وبعد غد وما بعده بترتيب تصاعدي', () => {
  const window = resolveWideSyncWindow('2026-10-14', { daysBack: 1, daysAhead: 7 });
  assert.equal(window.profile, 'wide');
  assert.equal(window.dates.length, 9);
  assert.equal(window.from, '2026-10-13');
  assert.equal(window.to, '2026-10-21');
  assert.ok(window.dates.includes('2026-10-15'), 'الغد');
  assert.ok(window.dates.includes('2026-10-16'), 'بعد الغد');
  assert.deepEqual([...window.dates].sort(), window.dates, 'مرتبة');
});

test('النافذة تعبر حدود الشهر والسنة بصحة، ومدى الماضي يُقصّ عند 30 يومًا', () => {
  const window = resolveWideSyncWindow('2026-01-01', { daysBack: 2, daysAhead: 1 });
  assert.deepEqual(window.dates, ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
  const capped = resolveWideSyncWindow('2026-10-14', { daysBack: 999, daysAhead: 0 });
  assert.equal(capped.daysBack, SYNC_WINDOW_MAX_DAYS_BACK);
  assert.equal(capped.dates.length, SYNC_WINDOW_MAX_DAYS_BACK + 1);
});

test('التحديث عند الطلب يبقى الأمس/اليوم/غدًا، والتشغيل المجدول يستخدم النافذة الكاملة', () => {
  const quick = resolveQuickSyncWindow('2026-10-14');
  assert.equal(quick.profile, 'quick');
  assert.deepEqual(quick.dates, ['2026-10-13', '2026-10-14', '2026-10-15']);

  const env = { NEMO_SYNC_DAYS_AHEAD: "3" };
  const wide = resolveSyncWindowForRun({ todayCairo: '2026-10-14', wide: true, env });
  assert.equal(wide.profile, 'wide');
  assert.equal(wide.to, '2026-10-17');
  const notWide = resolveSyncWindowForRun({ todayCairo: '2026-10-14', wide: false, env });
  assert.equal(notWide.profile, 'quick');
});

test('TheSportsDB: الحد الافتراضي 3 أيام للتوافق، والنافذة الكاملة تُطلب بالكامل مع الإبلاغ', () => {
  const dates = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'];
  const legacy = buildTheSportsDBEndpoints(dates, null, '123').filter((e) => e.kind === 'day');
  assert.equal(legacy.length, 3, 'السلوك القديم لم يتغير');

  const wide = buildTheSportsDBEndpoints(dates, null, '123', dates.length).filter((e) => e.kind === 'day');
  assert.equal(wide.length, 5);
  assert.ok(wide.some((e) => e.url.includes('d=2026-10-17&s=Soccer')), 'اليوم الخامس لم يعد يُسقَط');
});
