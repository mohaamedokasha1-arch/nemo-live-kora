import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareCoverage,
  CoverageSiteMatch,
  normalizeStatus,
  nameSimilarity,
  ReferenceMatch,
} from '../lib/coverage/compare';
import { parseReferenceExport, refusedReferenceReason, toCoverageSiteMatch } from '../lib/coverage/reference';
import { renderCoverageMarkdown } from '../lib/coverage/render';
import type { MatchRecord } from '../lib/types';

const WINDOW = { from: '2026-10-14', to: '2026-10-16' };

function ref(overrides: Partial<ReferenceMatch> & Pick<ReferenceMatch, 'homeName' | 'awayName'>): ReferenceMatch {
  return {
    source: 'test-reference',
    competitionName: 'Egyptian Premier League',
    competitionCode: 'EGY',
    cairoDate: '2026-10-15',
    utcKickoff: '2026-10-15T15:00:00.000Z',
    status: 'SCHEDULED',
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

function site(overrides: Partial<CoverageSiteMatch> & Pick<CoverageSiteMatch, 'id' | 'homeNames' | 'awayNames'>): CoverageSiteMatch {
  return {
    competitionCode: 'EGY',
    competitionNameAr: 'الدوري المصري الممتاز',
    competitionNameEn: 'Egyptian Premier League',
    cairoDate: '2026-10-15',
    utcKickoff: '2026-10-15T15:00:00.000Z',
    kickoffConfirmed: true,
    status: 'not_started',
    homeScore: null,
    awayScore: null,
    externalIds: {},
    contributingSources: ['sportscore'],
    ...overrides,
  };
}

test('مطابقة تامة لمباراة واحدة: تغطية 100% بلا مشكلات', () => {
  const report = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Al Ahly', awayName: 'Zamalek' })],
    site: [site({ id: 's1', homeNames: ['Al Ahly', 'الأهلي'], awayNames: ['Zamalek SC', 'الزمالك'] })],
  });
  assert.equal(report.summary.matched, 1);
  assert.equal(report.summary.matchedExact, 1);
  assert.equal(report.summary.missing, 0);
  assert.equal(report.summary.coveragePct, 100);
  assert.deepEqual(report.issues, []);
});

test('مباراة موجودة في المرجع وغائبة عن الموقع تُسجَّل كنقص مع التاريخ والفريقين', () => {
  const report = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Pyramids', awayName: 'Smouha' })],
    site: [],
  });
  assert.equal(report.summary.missing, 1);
  assert.equal(report.summary.coveragePct, 0);
  const issue = report.issues.find((entry) => entry.kind === 'missing_match');
  assert.ok(issue);
  assert.equal(issue.cairoDate, '2026-10-15');
  assert.equal(issue.home, 'Pyramids');
  assert.equal(issue.away, 'Smouha');
  assert.ok(report.issues.some((entry) => entry.kind === 'missing_competition'), 'البطولة الغائبة تُسجَّل أيضًا');
});

test('اختلاف تهجئة الاسم يُعدّ مطابقة مع تنبيه team_name_difference لا نقصًا', () => {
  // «Pharco» ⊂ «Pharco FC Alexandria»: تشابه قوي وليس تطابقًا تامًا.
  const report = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Pharco', awayName: 'Ismaily' })],
    site: [site({ id: 's2', homeNames: ['Pharco FC Alexandria'], awayNames: ['Ismaily SC'] })],
  });
  assert.equal(report.summary.matched, 1);
  assert.equal(report.summary.matchedExact, 0);
  assert.ok(report.issues.some((issue) => issue.kind === 'team_name_difference' && issue.siteMatchId === 's2'));
});

test('الاسم المختلف تمامًا لا يُطابَق: يظهر كنقص واسم مشابه للتدقيق', () => {
  const report = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Al Masry', awayName: 'Ismaily' })],
    site: [site({ id: 's2b', homeNames: ['Al Mokawloon'], awayNames: ['Ismaily SC'] })],
  });
  assert.equal(report.summary.matched, 0);
  assert.equal(report.summary.missing, 1);
  const missing = report.issues.find((issue) => issue.kind === 'missing_match');
  assert.ok(missing, 'تُحسب ناقصة');
  assert.equal(missing.siteMatchId, 's2b', 'السجل القريب يُذكر كدليل للتدقيق');
});

test('الفريقان معكوسان بين المصدرين: تُطابَق المباراة وتُعلَّم reversed_orientation', () => {
  const report = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Smouha', awayName: 'Pyramids' })],
    site: [site({ id: 's3', homeNames: ['Pyramids'], awayNames: ['Smouha'] })],
  });
  assert.equal(report.summary.matched, 1);
  assert.ok(report.issues.some((issue) => issue.kind === 'reversed_orientation'));
});

test('فرق الموعد أكبر من السماح يُسجَّل، والفرق الصغير لا يُسجَّل', () => {
  const big = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Ghazl', awayName: 'Enppi' })],
    site: [site({ id: 's4', homeNames: ['Ghazl El Mahalla'], awayNames: ['Enppi'], utcKickoff: '2026-10-15T16:00:00.000Z' })],
  });
  assert.ok(big.issues.some((issue) => issue.kind === 'time_mismatch'));

  const small = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Ghazl', awayName: 'Enppi' })],
    site: [site({ id: 's5', homeNames: ['Ghazl El Mahalla'], awayNames: ['Enppi'], utcKickoff: '2026-10-15T15:03:00.000Z' })],
  });
  assert.ok(!small.issues.some((issue) => issue.kind === 'time_mismatch'));
});

test('الموعد غير المؤكد في الموقع لا يُقارَن أبدًا (لا تخمين)', () => {
  const report = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Ghazl', awayName: 'Enppi' })],
    site: [site({ id: 's6', homeNames: ['Ghazl El Mahalla'], awayNames: ['Enppi'], kickoffConfirmed: false, utcKickoff: '2026-10-15T18:00:00.000Z' })],
  });
  assert.ok(!report.issues.some((issue) => issue.kind === 'time_mismatch'));
});

test('حالة ونتيجة: اختلاف الحالة وغياب النتيجة يُسجَّلان؛ النتيجة الغائبة في المرجع لا تُخترع', () => {
  const report = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Al Ahly', awayName: 'Zamalek', cairoDate: '2026-10-14', utcKickoff: '2026-10-14T16:00:00.000Z', status: 'FINISHED', homeScore: 2, awayScore: 1 })],
    site: [site({ id: 's7', homeNames: ['Al Ahly'], awayNames: ['Zamalek'], cairoDate: '2026-10-14', utcKickoff: '2026-10-14T16:00:00.000Z', status: 'live', homeScore: null, awayScore: null })],
  });
  assert.ok(report.issues.some((issue) => issue.kind === 'status_mismatch'));
  assert.ok(report.issues.some((issue) => issue.kind === 'score_missing_on_site'));
  assert.ok(!report.issues.some((issue) => issue.kind === 'score_mismatch'), 'لا تُقارن نتيجة غير موجودة');
});

test('نتيجة مختلفة بين المصدرين تُسجَّل score_mismatch', () => {
  const report = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Al Ahly', awayName: 'Zamalek', cairoDate: '2026-10-14', utcKickoff: '2026-10-14T16:00:00.000Z', status: 'FINISHED', homeScore: 2, awayScore: 1 })],
    site: [site({ id: 's8', homeNames: ['Al Ahly'], awayNames: ['Zamalek'], cairoDate: '2026-10-14', utcKickoff: '2026-10-14T16:00:00.000Z', status: 'finished', homeScore: 1, awayScore: 1 })],
  });
  assert.ok(report.issues.some((issue) => issue.kind === 'score_mismatch' && issue.detail.includes('2-1')));
});

test('سجلان للمباراة نفسها بمعرّفين مختلفين يُكشفان كتكرار', () => {
  const report = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Al Ahly', awayName: 'Zamalek' })],
    site: [
      site({ id: 'match-sportscore-1', homeNames: ['Al Ahly'], awayNames: ['Zamalek'] }),
      site({ id: 'match-thesportsdb-99', homeNames: ['Al Ahly'], awayNames: ['Zamalek'] }),
    ],
  });
  const duplicate = report.issues.find((issue) => issue.kind === 'duplicate_site_record');
  assert.ok(duplicate);
  assert.deepEqual(duplicate.siteMatchIds?.sort(), ['match-sportscore-1', 'match-thesportsdb-99']);
  assert.equal(report.summary.matched, 1, 'مباراة واحدة في المرجع تُطابَق بسجل واحد فقط');
  assert.equal(report.summary.siteOnly, 1, 'السجل الثاني يبقى موقعًا فقط ولا يُحسب تغطية مزدوجة');
});

test('معرّف خارجي يشير إلى مباراة بفريقين مختلفين يُكشف كربط خاطئ (id_conflict)', () => {
  const report = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Pyramids', awayName: 'Smouha', externalRef: { key: 'footballDataMatchId', value: '555' } })],
    site: [site({ id: 's9', homeNames: ['Al Ahly'], awayNames: ['Zamalek'], externalIds: { footballDataMatchId: '555' } })],
  });
  assert.ok(report.issues.some((issue) => issue.kind === 'id_conflict' && issue.siteMatchId === 's9'));
  assert.equal(report.summary.matched, 0);
});

test('مباراة في الموقع خارج نطاق المرجع تبقى site_only، والمرجع خارج النافذة يُستبعد ويُعد', () => {
  const report = compareCoverage({
    window: WINDOW,
    reference: [
      ref({ homeName: 'Al Ahly', awayName: 'Zamalek' }),
      ref({ homeName: 'Old A', awayName: 'Old B', cairoDate: '2026-09-01' }),
    ],
    site: [
      site({ id: 'inside-only', homeNames: ['Ghazl'], awayNames: ['Enppi'], cairoDate: '2026-10-16' }),
      site({ id: 'outside', homeNames: ['X'], awayNames: ['Y'], cairoDate: '2026-11-01' }),
    ],
  });
  assert.equal(report.summary.referenceTotal, 1);
  assert.equal(report.summary.referenceOutOfWindow, 1);
  assert.equal(report.summary.siteTotalInWindow, 1, 'السجل خارج النافذة لا يدخل المقارنة');
  assert.ok(report.issues.some((issue) => issue.kind === 'site_only' && issue.siteMatchId === 'inside-only'));
});

test('بطولة متوفرة بالاسم الإنجليزي نفسه تُعد مغطاة، و«Premier League» لا تطابق الدوري المصري', () => {
  const report = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Al Ahly', awayName: 'Zamalek', competitionName: 'Premier League', competitionCode: undefined })],
    site: [site({ id: 's10', homeNames: ['Al Ahly'], awayNames: ['Zamalek'] })],
  });
  assert.equal(report.summary.matched, 0, 'اسم جزئي لا يكفي لمطابقة البطولة');
  assert.ok(report.issues.some((issue) => issue.kind === 'missing_competition'));
});

test('تقرير التغطية لكل تاريخ يحسب النسبة بدقة، ويحذّر إذا كان المرجع يغذي الموقع', () => {
  const report = compareCoverage({
    window: WINDOW,
    reference: [
      ref({ homeName: 'Al Ahly', awayName: 'Zamalek', cairoDate: '2026-10-15', utcKickoff: null }),
      ref({ homeName: 'Pyramids', awayName: 'Smouha', cairoDate: '2026-10-15', utcKickoff: null }),
    ],
    site: [site({ id: 's11', homeNames: ['Al Ahly'], awayNames: ['Zamalek'], cairoDate: '2026-10-15', contributingSources: ['football-data'] })],
  });
  const row = report.perDate.find((entry) => entry.cairoDate === '2026-10-15');
  assert.ok(row);
  assert.equal(row.reference, 2);
  assert.equal(row.matched, 1);
  assert.equal(row.coveragePct, 50);
  assert.equal(report.referenceFeedsSite, false, 'اسم المرجع test-reference لا يطابق مصدر الموقع');

  const same = compareCoverage({
    window: WINDOW,
    reference: [ref({ homeName: 'Al Ahly', awayName: 'Zamalek', source: 'football-data.org' })],
    site: [site({ id: 's12', homeNames: ['Al Ahly'], awayNames: ['Zamalek'], contributingSources: ['football-data.org'] })],
  });
  assert.equal(same.referenceFeedsSite, true);
  const md = renderCoverageMarkdown(same, { source: 'football-data.org' });
  assert.ok(md.includes('المرجع نفسه يغذّي الموقع'));
});

test('لا توجد مباريات في المرجع: التغطية غير محسوبة (null) وليست 100%', () => {
  const report = compareCoverage({ window: WINDOW, reference: [], site: [] });
  assert.equal(report.summary.coveragePct, null);
});

test('تطبيع الحالات: الحالات المجهولة لا تُقارَن', () => {
  assert.equal(normalizeStatus('IN_PLAY'), 'live');
  assert.equal(normalizeStatus('not_started'), 'scheduled');
  assert.equal(normalizeStatus('unconfirmed'), 'unknown');
  assert.equal(normalizeStatus(''), 'unknown');
});

test('تشابه الأسماء: التطابق بعد إزالة FC/SC والهمزات، والأسماء المختلفة لا تتشابه', () => {
  assert.equal(nameSimilarity('Zamalek SC', 'Zamalek'), 1);
  assert.equal(nameSimilarity('الأهلي', 'الاهلي'), 1);
  assert.ok(nameSimilarity('Al Masry', 'Al Mokawloon') < 0.5);
});

test('ملف مرجع JSON: يقبل الصفوف الصالحة ويرفض الناقصة بسبب واضح', () => {
  const parsed = parseReferenceExport(
    [
      { competition: 'Egyptian Premier League', competitionCode: 'EGY', date: '2026-10-15', home: 'Al Ahly', away: 'Zamalek', homeScore: null, awayScore: null, status: 'SCHEDULED' },
      { competition: 'Egyptian Premier League', utcKickoff: '2026-10-15T15:00:00Z', home: 'Pyramids', away: 'Smouha' },
      { competition: 'Egyptian Premier League', home: 'Missing Away' },
      { competition: 'X', home: 'A', away: 'B', date: '15/10/2026' },
      { competition: 'X', home: 'A', away: 'B', utcKickoff: 'not-a-date' },
      { competition: 'X', home: 'A', away: 'B', date: '2026-10-15', homeScore: 'two' },
      'not an object',
    ],
    'file:test.json'
  );
  assert.equal(parsed.matches.length, 2);
  assert.equal(parsed.matches[1].cairoDate, '2026-10-15', 'التاريخ يُشتق من utcKickoff بتوقيت القاهرة');
  assert.equal(parsed.rejected.length, 5);
  assert.ok(parsed.rejected.some((entry) => entry.reason.includes('حقول إلزامية')));
  assert.ok(parsed.rejected.some((entry) => entry.reason.includes('YYYY-MM-DD')));
  assert.ok(parsed.rejected.some((entry) => entry.reason.includes('utcKickoff')));
  assert.ok(parsed.rejected.some((entry) => entry.reason.includes('homeScore')));
  assert.ok(parsed.rejected.some((entry) => entry.reason === 'الصف ليس كائنًا'));
});

test('كووورة مرفوضة كمرجع آلي بسبب شروط الاستخدام، وأي مرجع آخر غير مرفوض', () => {
  assert.ok(refusedReferenceReason('kooora'));
  assert.ok(refusedReferenceReason('www.kooora.com'));
  assert.equal(refusedReferenceReason('football-data'), null);
  assert.equal(refusedReferenceReason('file:exports/reference.json'), null);
});

test('تحويل سجل الموقع: الأسماء العربية والإنجليزية والمصدر والموعد المؤكد', () => {
  const record = {
    id: 'match-x',
    competitionCode: 'EGY',
    competitionNameAr: 'الدوري المصري الممتاز',
    competitionNameEn: 'Egyptian Premier League',
    cairoDate: '2026-10-15',
    utcKickoff: '2026-10-15T15:00:00.000Z',
    kickoffConfirmed: true,
    homeTeam: { nameEn: 'Al Ahly', nameAr: 'الأهلي' },
    awayTeam: { nameEn: 'Zamalek', nameAr: 'الزمالك' },
    status: 'not_started',
    score: { home: null, away: null },
    primarySource: 'sportscore',
    contributingSources: ['sportscore', 'thesportsdb'],
    externalIds: { thesportsdbEventId: '1' },
  } as unknown as MatchRecord;
  const mapped = toCoverageSiteMatch(record);
  assert.deepEqual(mapped.homeNames, ['Al Ahly', 'الأهلي']);
  assert.equal(mapped.kickoffConfirmed, true);
  assert.ok(mapped.contributingSources.includes('thesportsdb'));
  assert.equal(mapped.externalIds.thesportsdbEventId, '1');
});
