import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * مباريات اليوم والغد — تغطية كاملة من SportScore + التوقيت المصري + التحديث التلقائي.
 *
 * الشبكة مُستبدلة في كل الاختبارات (لا اتصال خارجي)؛ أشكال الاستجابة منسوخة من استجابات
 * `/api/v1/fixtures/` الحقيقية الملتقطة يوم 2026-10-15 (المفاتيح نفسها، والحد 200 نفسه، والترتيب
 * حسب الموعد نفسه). البيانات الحقيقية نفسها مُثبتة في تقرير التحقق الحي (docs/).
 */
process.env.NEMO_GATEWAY_STORE_PERSIST = 'off';
process.env.NEMO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nemo-today-tomorrow-'));
delete process.env.FOOTBALL_DATA_API_KEY;
delete process.env.API_FOOTBALL_KEY;

const realFetch = globalThis.fetch;
afterEach(async () => {
  globalThis.fetch = realFetch;
  const { clearHttpCache } = await import('../lib/sources/http-client');
  clearHttpCache();
});

interface RawFixture {
  home: string;
  away: string;
  time: string;
  status: string;
  status_text: string;
  competition: string;
  url: string;
  home_score: string | null;
  away_score: string | null;
  home_logo: string;
  away_logo: string;
  competition_logo: string;
}

function fixture(i: number, overrides: Partial<RawFixture> = {}): RawFixture {
  return {
    home: `Home Club ${i}`,
    away: `Away Club ${i}`,
    time: '2026-10-16T10:00:00+00:00',
    status: 'upcoming',
    status_text: 'Not started',
    competition: `Regional League ${i % 40}`,
    url: `/football/match/home-club-${i}-vs-away-club-${i}/trk${String(i).padStart(10, '0')}/`,
    home_score: null,
    away_score: null,
    home_logo: 'https://img.thesports.com/football/team/a.png',
    away_logo: 'https://img.thesports.com/football/team/b.png',
    competition_logo: 'https://img.thesports.com/football/competition/c.png',
    ...overrides,
  };
}

/** Emulates the provider: filter by status/competition, sort by kick-off, cap at `limit` (≤200). */
function fakeSportScore(day: Record<string, RawFixture[]>, log: string[], failStatus?: string) {
  return (async (input: string | URL | Request) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    log.push(href);
    const url = new URL(href);
    if (url.pathname === '/api/v1/fixtures/') {
      const date = url.searchParams.get('date') || '';
      const status = url.searchParams.get('status');
      const competition = url.searchParams.get('competition');
      if (failStatus && status === failStatus) {
        return new Response('upstream error', { status: 503 });
      }
      const limit = Math.min(Number(url.searchParams.get('limit') || 100), 200);
      let list = [...(day[date] || [])];
      if (status) list = list.filter((m) => m.status === status);
      if (competition) {
        list = list.filter(
          (m) => m.competition.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === competition
        );
      }
      list.sort((a, b) => a.time.localeCompare(b.time));
      const matches = list.slice(0, limit);
      return Response.json({ sport: 'football', date, count: matches.length, matches });
    }
    if (url.pathname.startsWith('/api/widget/matches') || url.pathname.startsWith('/api/v1/matches')) {
      return Response.json({ sport: 'football', count: 0, matches: [] });
    }
    throw new TypeError('fetch failed');
  }) as typeof fetch;
}

test('يوم صغير (< 200 مباراة): طلب واحد يكفي ويُعلَن اكتمال اليوم', async () => {
  const { fetchSportScoreDayCoverage } = await import('../lib/sources/sportscore');
  const log: string[] = [];
  const list = Array.from({ length: 40 }, (_, i) => fixture(i));
  globalThis.fetch = fakeSportScore({ '2026-10-16': list }, log);
  const res = await fetchSportScoreDayCoverage('2026-10-16', { retries: 0 });
  assert.equal(res.ok, true);
  assert.equal(res.complete, true);
  assert.equal(res.matches.length, 40);
  assert.equal(log.length, 1);
  assert.match(log[0], /limit=200/);
});

test('يوم مزدحم: القوائم تُقسَّم بالحالة، ومباريات المساء المصرية/العربية/الأوروبية لا تسقط بحد المزوّد', async () => {
  const { fetchSportScoreDayCoverage, SPORTSCORE_FIXTURES_MAX_LIMIT } = await import('../lib/sources/sportscore');
  const log: string[] = [];
  // 260 مباراة مبكرة لم تبدأ (قبل 16:00 UTC) + مباريات مساء ذات أولوية — بالضبط ما رُصد يوم 2026-10-16.
  const early = Array.from({ length: 260 }, (_, i) =>
    fixture(i, { time: `2026-10-16T${String(8 + Math.floor(i / 40)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00+00:00` })
  );
  const evening = [
    fixture(1001, { home: 'APR FC', away: 'Zamalek SC', competition: 'CAF Champions League', time: '2026-10-16T16:00:00+00:00' }),
    fixture(1002, { home: 'Marekh', away: 'Pyramids FC', competition: 'CAF Champions League', time: '2026-10-16T13:00:00+00:00' }),
    fixture(1003, { home: 'RC Deportivo', away: 'Levante', competition: 'Spanish La Liga', time: '2026-10-16T19:00:00+00:00' }),
    fixture(1004, { home: 'El Sekka El Hadid', away: 'Ismaily SC', competition: 'Egyptian Division 2', time: '2026-10-16T12:30:00+00:00' }),
  ];
  const finished = Array.from({ length: 30 }, (_, i) =>
    fixture(2000 + i, { status: 'finished', status_text: 'Finished', home_score: '1', away_score: '0', time: '2026-10-16T01:00:00+00:00' })
  );
  globalThis.fetch = fakeSportScore({ '2026-10-16': [...early, ...evening, ...finished] }, log);

  const res = await fetchSportScoreDayCoverage('2026-10-16', { retries: 0, concurrency: 6 });
  const names = new Set(res.matches.map((m) => `${m.homeTeam.nameEn}|${m.awayTeam.nameEn}`));
  for (const pair of ['APR FC|Zamalek SC', 'Marekh|Pyramids FC', 'RC Deportivo|Levante', 'El Sekka El Hadid|Ismaily SC']) {
    assert.ok(names.has(pair), `مباراة ذات أولوية مفقودة: ${pair}`);
  }
  assert.ok(log.some((u) => u.includes('status=finished')));
  assert.ok(log.some((u) => u.includes('status=upcoming')));
  assert.ok(log.some((u) => u.includes('competition=caf-champions-league')));
  assert.ok(log.some((u) => u.includes('competition=egyptian-division-2')));
  // ما زال جزء من مباريات البطولات الصغيرة فوق الحد ⇒ لا يُدّعى اكتمال اليوم.
  assert.equal(res.complete, false);
  assert.ok(res.requests.some((r) => r.capped && r.count === SPORTSCORE_FIXTURES_MAX_LIMIT));
  // لا تكرار: كل مباراة مرة واحدة رغم ورودها في أكثر من قائمة.
  assert.equal(new Set(res.matches.map((m) => m.id)).size, res.matches.length);
});

test('فشل طلب واحد لا يُسقط بقية اليوم، ويُعلَن اليوم غير مكتمل بلا ادعاء', async () => {
  const { fetchSportScoreDayCoverage } = await import('../lib/sources/sportscore');
  const log: string[] = [];
  const list = Array.from({ length: 230 }, (_, i) =>
    fixture(i, i < 20 ? { status: 'live', status_text: '1st half', home_score: '0', away_score: '0', time: '2026-10-15T12:00:00+00:00' } : { time: '2026-10-15T15:00:00+00:00' })
  );
  globalThis.fetch = fakeSportScore({ '2026-10-15': list }, log, 'live');
  const res = await fetchSportScoreDayCoverage('2026-10-15', { retries: 0, prioritySweep: false });
  assert.equal(res.ok, true);
  assert.equal(res.complete, false);
  assert.ok(res.matches.length >= 200, 'القائمة الأولى والقوائم الناجحة محفوظة');
  assert.ok(res.requests.some((r) => !r.ok && r.httpStatus === 503));
});

test('الميزانية الزمنية: بطولات لم تُطلب في الوقت تُسجَّل بأسمائها ولا تُعدّ مطلوبة', async () => {
  const { fetchSportScoreDayCoverage } = await import('../lib/sources/sportscore');
  const log: string[] = [];
  const list = Array.from({ length: 450 }, (_, i) => fixture(i));
  globalThis.fetch = fakeSportScore({ '2026-10-16': list }, log);
  const res = await fetchSportScoreDayCoverage('2026-10-16', { retries: 0, budgetMs: 0 });
  assert.ok(res.skippedCompetitions.length > 0);
  assert.ok(res.skippedCompetitions.includes('egyptian-premier-league'));
  assert.equal(log.filter((u) => u.includes('competition=')).length, 0);
});

test('التوقيت: تصنيف اليوم/الغد بتاريخ القاهرة مع التوقيت الصيفي والشتوي بلا إضافة الفرق مرتين', async () => {
  const { mapSportScoreMatchToRecord } = await import('../lib/sources/sportscore');
  const { toCairoTime24, getTodayCairoDate, shiftDateString } = await import('../lib/cairo-time');
  // 15 أكتوبر 2026: مصر على التوقيت الصيفي (UTC+3) حتى آخر خميس من أكتوبر.
  const lateUtc = mapSportScoreMatchToRecord(fixture(1, { time: '2026-10-15T21:30:00+00:00' }));
  assert.equal(lateUtc.cairoDate, '2026-10-16', '21:30Z = 00:30 بتوقيت القاهرة ⇒ مباراة الغد لا اليوم');
  assert.equal(toCairoTime24(lateUtc.utcKickoff), '00:30');
  const beforeMidnight = mapSportScoreMatchToRecord(fixture(2, { time: '2026-10-15T20:59:00+00:00' }));
  assert.equal(beforeMidnight.cairoDate, '2026-10-15');
  assert.equal(toCairoTime24(beforeMidnight.utcKickoff), '23:59');
  // وقت مع إزاحة صريحة: لا تُضاف الإزاحة مرة ثانية.
  const offset = mapSportScoreMatchToRecord(fixture(3, { time: '2026-10-15T19:00:00+03:00' }));
  assert.equal(offset.utcKickoff, '2026-10-15T16:00:00.000Z');
  assert.equal(toCairoTime24(offset.utcKickoff), '19:00');
  // الشتاء (UTC+2): 22:30Z = 00:30 من اليوم التالي.
  const winter = mapSportScoreMatchToRecord(fixture(4, { time: '2026-12-01T22:30:00+00:00' }));
  assert.equal(winter.cairoDate, '2026-12-02');
  assert.equal(toCairoTime24(winter.utcKickoff), '00:30');
  const winterEvening = mapSportScoreMatchToRecord(fixture(5, { time: '2026-12-01T21:59:00+00:00' }));
  assert.equal(winterEvening.cairoDate, '2026-12-01');
  // منتصف الليل: «اليوم» ينتقل عند 00:00 بتوقيت القاهرة لا بتوقيت UTC.
  assert.equal(getTodayCairoDate(new Date('2026-10-15T20:59:59Z')), '2026-10-15');
  assert.equal(getTodayCairoDate(new Date('2026-10-15T21:00:00Z')), '2026-10-16');
  assert.equal(getTodayCairoDate(new Date('2026-12-01T21:59:59Z')), '2026-12-01');
  assert.equal(getTodayCairoDate(new Date('2026-12-01T22:00:00Z')), '2026-12-02');
  assert.equal(shiftDateString('2026-12-31', 1), '2027-01-01');
});

test('حالات SportScore: الشوط الأول/الاستراحة/الثاني/المؤجلة/الملغاة/المتوقفة/المتأخرة تُعرض بحالتها الصحيحة', async () => {
  const { normalizeMatchStatus } = await import('../lib/cairo-time');
  const now = new Date('2026-10-15T13:00:00Z');
  const kickoff = '2026-10-15T12:30:00Z';
  assert.deepEqual(
    [normalizeMatchStatus('live', '1st half', kickoff, now).statusNoteAr, normalizeMatchStatus('live', '1st half', kickoff, now).status],
    ['الشوط الأول', 'live']
  );
  assert.equal(normalizeMatchStatus('live', 'Half time', kickoff, now).statusNoteAr, 'استراحة بين الشوطين');
  assert.equal(normalizeMatchStatus('live', '2nd half', kickoff, now).statusNoteAr, 'الشوط الثاني');
  assert.equal(normalizeMatchStatus('upcoming', 'Postponed', kickoff, now).status, 'postponed');
  assert.equal(normalizeMatchStatus('upcoming', 'Cancelled', kickoff, now).status, 'cancelled');
  assert.equal(normalizeMatchStatus('upcoming', 'Interrupted', kickoff, now).status, 'suspended');
  assert.equal(normalizeMatchStatus('finished', 'Finished', kickoff, now).status, 'finished');
  const delayed = normalizeMatchStatus('upcoming', 'Delayed', '2026-10-15T13:10:00Z', now);
  assert.equal(delayed.status, 'not_started');
  assert.match(delayed.statusNoteAr || '', /تأخر/);
  assert.equal(normalizeMatchStatus('upcoming', 'Not started', '2026-10-15T15:00:00Z', now).statusNoteAr, null);
});

test('أولوية الكرة المصرية والعربية: بطولات المصدر تُترجم وتتقدّم الجدول بلا تغيير معرّفاتها', async () => {
  const { resolveCompetitionByMeta } = await import('../lib/catalog');
  const { mapSportScoreMatchToRecord } = await import('../lib/sources/sportscore');
  const d2 = resolveCompetitionByMeta({ nameEn: 'Egyptian Division 2' });
  assert.equal(d2.countryAr, 'مصر');
  assert.equal(d2.isEgyptianPriority, true);
  assert.equal(d2.code, 'EGYPTIAN-DIVISION-2', 'الكود (ومن ثم المعرّفات والروابط) لم يتغيّر');
  const record = mapSportScoreMatchToRecord(fixture(9, { home: 'Tanta', away: 'Dayrot', competition: 'Egyptian Division 2' }));
  assert.equal(record.isEgyptianInterest, true);
  const minor = resolveCompetitionByMeta({ nameEn: 'Norwegian Junior U19' });
  assert.ok(record.priority < minor.priority, 'الدوري المصري قبل البطولات الصغيرة');
  assert.equal(resolveCompetitionByMeta({ nameEn: 'CAF Africa Cup of Nations' }).id, 'comp-afcon');
  assert.equal(resolveCompetitionByMeta({ nameEn: 'FIFA World Cup qualification (CAF)' }).id, 'comp-wcq-caf');
  assert.equal(resolveCompetitionByMeta({ nameEn: 'United Arab Emirates Adnoc Pro-League' }).countryAr, 'الإمارات');
  assert.equal(resolveCompetitionByMeta({ nameEn: 'Qatar Stars League' }).countryAr, 'قطر');
  assert.equal(resolveCompetitionByMeta({ nameEn: 'Saudi Professional League' }).id, 'comp-spl');
  // المطابقة تامة: نسخة الناشئين لا تُلتقط باسم البطولة الأولى.
  assert.notEqual(resolveCompetitionByMeta({ nameEn: 'Qatar Stars League U23' }).countryAr, 'قطر');
});

test('التحديث التلقائي للصفحة المفتوحة: فوري عند منتصف الليل بتوقيت القاهرة، وأسرع أثناء المباريات الجارية', async () => {
  const { shouldRefreshSchedule, LIVE_SCHEDULE_REFRESH_MS, IDLE_SCHEDULE_REFRESH_MS } = await import(
    '../components/ScheduleAutoRefresh'
  );
  assert.equal(
    shouldRefreshSchedule({ renderedTodayCairo: '2026-10-15', nowCairo: '2026-10-16', msSinceLastRefresh: 1000, hasLiveMatches: false }),
    true
  );
  assert.equal(
    shouldRefreshSchedule({ renderedTodayCairo: '2026-10-15', nowCairo: '2026-10-15', msSinceLastRefresh: LIVE_SCHEDULE_REFRESH_MS, hasLiveMatches: true }),
    true
  );
  assert.equal(
    shouldRefreshSchedule({ renderedTodayCairo: '2026-10-15', nowCairo: '2026-10-15', msSinceLastRefresh: LIVE_SCHEDULE_REFRESH_MS, hasLiveMatches: false }),
    false
  );
  assert.equal(
    shouldRefreshSchedule({ renderedTodayCairo: '2026-10-15', nowCairo: '2026-10-15', msSinceLastRefresh: IDLE_SCHEDULE_REFRESH_MS, hasLiveMatches: false }),
    true
  );
});

test('التحديث عند الطلب يجلب مباريات اليوم والغد كاملة (لا نافذة الـ50 فقط) ويحفظها مرة واحدة لكل مباراة', async () => {
  const log: string[] = [];
  const today = Array.from({ length: 12 }, (_, i) =>
    fixture(500 + i, { time: '2026-10-15T14:00:00+00:00', competition: i < 3 ? 'Saudi Professional League' : 'Iraq Premier Division' })
  );
  const tomorrow = [
    fixture(600, { home: 'APR FC', away: 'Zamalek SC', competition: 'CAF Champions League', time: '2026-10-16T16:00:00+00:00' }),
    fixture(601, { home: 'RC Deportivo', away: 'Levante', competition: 'Spanish La Liga', time: '2026-10-16T19:00:00+00:00' }),
  ];
  // نفس مباراة اليوم تصل أيضًا من «قائمة الأمس» بتوقيت UTC (مباراة بعد منتصف ليل القاهرة) — تُحفظ مرة.
  const yesterdayUtc = [fixture(700, { time: '2026-10-14T21:30:00+00:00', competition: 'Egyptian Division 2' })];
  globalThis.fetch = fakeSportScore({ '2026-10-14': yesterdayUtc, '2026-10-15': today, '2026-10-16': tomorrow }, log);

  const engine = await import('../lib/sync/engine');
  const store = await import('../lib/db/store');
  await store.hydrateStore();
  await engine.runGatewaySync({ mode: 'live', quick: true, skipNews: true, targetDate: '2026-10-15', trigger: 'اختبار' });

  const fixtureDays = new Set(log.filter((u) => u.includes('/api/v1/fixtures/')).map((u) => new URL(u).searchParams.get('date')));
  assert.deepEqual([...fixtureDays].sort(), ['2026-10-14', '2026-10-15', '2026-10-16'], 'المسار السريع صار يطلب قوائم الأيام');

  const todayRes = store.queryGatewayMatches({ cairoDate: '2026-10-15' });
  const tomorrowRes = store.queryGatewayMatches({ cairoDate: '2026-10-16' });
  const todayNames = todayRes.matches.map((m) => m.homeTeam.nameEn);
  assert.ok(todayNames.includes('Home Club 700'), '21:30Z أمس بتوقيت UTC = 00:30 اليوم بتوقيت القاهرة');
  assert.ok(todayNames.includes('Home Club 500'));
  assert.ok(tomorrowRes.matches.some((m) => m.awayTeam.nameEn === 'Zamalek SC'));
  assert.ok(tomorrowRes.matches.some((m) => m.homeTeam.nameEn === 'RC Deportivo'));
  assert.ok(!tomorrowRes.matches.some((m) => m.homeTeam.nameEn === 'Home Club 500'), 'لا مباراة من اليوم في قسم الغد');
  assert.ok(!todayRes.matches.some((m) => m.awayTeam.nameEn === 'Zamalek SC'), 'لا مباراة من الغد في قسم اليوم');
  // الكرة المصرية أولًا في ترتيب اليوم.
  assert.equal(todayRes.matches[0].homeTeam.nameEn, 'Home Club 700');
  // كل مباراة مرة واحدة.
  const ids = todayRes.matches.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);

  // تحديث النتيجة والحالة: مزامنة ثانية بعد بدء مباراة تُحدّث السجل نفسه ولا تضيف سجلًا جديدًا.
  const { clearHttpCache } = await import('../lib/sources/http-client');
  clearHttpCache();
  today[0] = { ...today[0], status: 'live', status_text: '2nd half', home_score: '2', away_score: '1' };
  const countBefore = store.getGatewayDatabase().matches.length;
  await engine.runGatewaySync({ mode: 'live', quick: true, skipNews: true, targetDate: '2026-10-15', trigger: 'اختبار 2' });
  const updated = store.getGatewayDatabase().matches.find((m) => m.homeTeam.nameEn === 'Home Club 500');
  assert.equal(updated?.score.home, 2);
  assert.equal(updated?.score.away, 1);
  assert.equal(store.getGatewayDatabase().matches.length, countBefore, 'لا سجلات مكررة بعد التحديث');

  // تعطل المصدر: فشل كل الطلبات لا يمسح ما حُفظ.
  clearHttpCache();
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  await engine.runGatewaySync({ mode: 'live', quick: true, skipNews: true, targetDate: '2026-10-15', trigger: 'اختبار تعطل' });
  assert.equal(store.queryGatewayMatches({ cairoDate: '2026-10-16' }).matches.length, tomorrowRes.matches.length);
});

test('صفحة «جدول المباريات» تعرض بيانات المخزن الحقيقية لتاريخَي اليوم والغد (لا قائمة ثابتة)', async () => {
  const { default: MatchesScheduleTabs } = await import('../components/matches/MatchesScheduleTabs');
  const { mapSportScoreMatchToRecord } = await import('../lib/sources/sportscore');
  const todayMatch = mapSportScoreMatchToRecord(fixture(800, { home: 'Tanta', away: 'Dayrot', competition: 'Egyptian Division 2', time: '2026-10-15T12:30:00+00:00' }));
  const tomorrowMatch = mapSportScoreMatchToRecord(fixture(801, { home: 'APR FC', away: 'Zamalek SC', competition: 'CAF Champions League', time: '2026-10-16T16:00:00+00:00' }));
  // مكوّن التحديث التلقائي يحتاج سياق موجّه App Router — يُوفَّر هنا بموجّه صامت للاختبار.
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime');
  const noop = () => {};
  const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
  const html = renderToStaticMarkup(
    React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(MatchesScheduleTabs, {
      todayCairo: '2026-10-15',
      tomorrowCairo: '2026-10-16',
      todayMatches: [todayMatch],
      tomorrowMatches: [tomorrowMatch],
    }))
  );
  assert.ok(html.includes('الدوري المصري — الدرجة الثانية'));
  assert.ok(html.includes(`href="/matches/${todayMatch.id}"`), 'البطاقة تقود إلى صفحة تفاصيل المباراة الديناميكية');
  assert.ok(!html.includes('cdn.example.com'), 'لا شعارات وهمية');
  assert.ok(!html.includes('ON Time Sports'), 'لا قنوات مُفترضة');
  assert.ok(html.includes('href="https://sportscore.com/"'), 'نسب البيانات المطلوب في شروط SportScore');
  assert.ok(!fs.readFileSync(path.join(process.cwd(), 'app/matches/page.tsx'), 'utf-8').includes('2026-10-15'), 'لا تاريخ ثابت في الصفحة');
});
