import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { clearHttpCache } from '../lib/sources/http-client';
import {
  fetchTheSportsDBEventById,
  resetTheSportsDBKeyState,
} from '../lib/sources/thesportsdb';
import {
  resolveMatchDetailTarget,
  resolveMatchDetailTargetSync,
} from '../lib/matches/resolve-match';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  استعادة المباراة من المزوّد — اختبار تكامل بمزوّد محاكٍ محلي (بلا إنترنت)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * يُثبت هذا الاختبار المسار كاملًا كما يحدث في الإنتاج على نسخة باردة:
 *   معرّف مباراة غير موجود في المخزن ← lookupevent.php?id= ← سجل كامل (نتيجة وأحداث)
 *   ← يُخزَّن في المخزن ← الصفحة تعرضه فورًا.
 *
 * المزوّد هنا خادم HTTP محلي (منفذ عشوائي) يحاكي TheSportsDB — فلا يعتمد الاختبار
 * على أي خدمة خارجية، ويعمل في CI بلا شبكة.
 */

process.env.NEMO_GATEWAY_STORE_PERSIST = 'off';

const EVENT_PAYLOAD = {
  idEvent: '9900001',
  strEvent: 'Al Masry vs Pyramids FC',
  strSport: 'soccer',
  strSeason: '2026-2027',
  idLeague: '4829',
  strLeague: 'Egyptian Premier League',
  strLeagueBadge: null,
  strHomeTeam: 'Al Masry',
  strAwayTeam: 'Pyramids FC',
  idHomeTeam: '134310',
  idAwayTeam: '134309',
  intRound: '9',
  intHomeScore: '2',
  intAwayScore: '1',
  strTimestamp: '2026-10-17T16:00:00',
  dateEvent: '2026-10-17',
  strTime: '16:00:00',
  strHomeTeamBadge: null,
  strAwayTeamBadge: null,
  strVenue: 'Stade de la Mock',
  strCountry: 'Egypt',
  strStatus: 'FT',
  strPostponed: 'no',
};

let server: http.Server;
let previousEndpoints: { sportscore: string | undefined; tsdb: string | undefined };

before(async () => {
  previousEndpoints = {
    sportscore: process.env.THESPORTSDB_BASE_URL,
    tsdb: process.env.API_FOOTBALL_BASE_URL,
  };

  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    res.setHeader('content-type', 'application/json');
    if (url.pathname.includes('lookupevent.php')) {
      res.end(
        JSON.stringify(
          url.searchParams.get('id') === '9900001' ? { events: [EVENT_PAYLOAD] } : { events: null }
        )
      );
      return;
    }
    if (url.pathname.includes('lookupleague.php')) {
      res.end(JSON.stringify({ leagues: [{ idLeague: '4829' }] }));
      return;
    }
    res.end(JSON.stringify({ events: [], matches: [], fixtures: [], response: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.THESPORTSDB_BASE_URL = `http://127.0.0.1:${port}/api/v1/json`;
  process.env.API_FOOTBALL_BASE_URL = `http://127.0.0.1:${port}`;

  resetTheSportsDBKeyState();
  clearHttpCache();
});

after(async () => {
  if (previousEndpoints.sportscore === undefined) delete process.env.THESPORTSDB_BASE_URL;
  else process.env.THESPORTSDB_BASE_URL = previousEndpoints.sportscore;
  if (previousEndpoints.tsdb === undefined) delete process.env.API_FOOTBALL_BASE_URL;
  else process.env.API_FOOTBALL_BASE_URL = previousEndpoints.tsdb;
  resetTheSportsDBKeyState();
  clearHttpCache();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('استعادة مباراة بالمعرّف من المزوّد: سجل كامل (نتيجة + ملعب) يُخزَّن ثم يُقرأ من المخزن', async () => {
  // ① نداء المزوّد المباشر بمعرّف الحدث.
  const fetched = await fetchTheSportsDBEventById('9900001');
  assert.ok(fetched, 'lookupevent يعيد المباراة كاملة');
  assert.ok(fetched.score.home === 2 && fetched.score.away === 1, 'النتيجة من المصدر');
  assert.equal(fetched.venue, 'Stade de la Mock');
  assert.equal(fetched.status, 'finished');

  // ② معرّف غير موجود في المخزن أصلًا (نسخة باردة) — يمر عبر محول الوجهة بالاستعادة.
  const requested = 'match-thesportsdb-9900001';
  assert.equal(resolveMatchDetailTargetSync(requested).kind, 'unavailable', 'غير موجود قبل الاستعادة');

  const target = await resolveMatchDetailTarget(requested, { refresh: false });
  assert.equal(target.kind, 'record', 'الاستعادة من المزوّد تصنع صفحة المباراة');
  if (target.kind === 'record') {
    assert.equal(target.record.id, requested);
    assert.ok(target.record.homeTeam.nameAr, 'اسم الفريق من طبقة التسمية المصرية الموثّقة');
    assert.equal(target.record.score.home, 2, 'النتيجة المعروضة هي نتيجة المصدر');
    assert.equal(target.record.score.away, 1);
  }

  // ③ بعد الاستعادة: الطلب التالي يُقرأ من المخزن مباشرة (بلا أي نداء شبكة).
  const second = resolveMatchDetailTargetSync(requested);
  assert.equal(second.kind, 'record', 'السجل بقي في المخزن بعد الاستعادة');
});

test('معرّف غير موجود لدى المزوّد يبقى حالة عدم توفّر (fallback) لا 404 مخترعًا', async () => {
  const missing = await fetchTheSportsDBEventById('4242424');
  assert.equal(missing, null, 'المزوّد لا يملك المباراة');

  const target = await resolveMatchDetailTarget('match-thesportsdb-4242424', { refresh: false });
  assert.equal(target.kind, 'unavailable');
  if (target.kind === 'unavailable') {
    assert.equal(target.hint.provider, 'thesportsdb');
  }
});
