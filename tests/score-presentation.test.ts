import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildMatchScoreView, scoreIsDisplayable } from '../lib/matches/score-view';
import {
  MANUAL_DOCUMENT_SCHEMA,
  buildCatalogEntryFromManual,
  buildMatchRecordFromManual,
  normalizeManualDocument,
  type ManualOverride,
} from '../lib/admin/manual-document';
import type { MatchFormInput } from '../lib/admin/service';
import { applyOverrideToMatch } from '../lib/admin/overrides';
import { stripComments } from './helpers/source-scan';
import MatchScoreView from '../components/MatchScoreView';
import MatchCard from '../components/MatchCard';
import type { MatchRecord, MatchScore, NemoLinkResolution } from '../lib/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  اقتران النتيجة بصاحبها: حفظًا وعرضًا (تدقيق «انعكاس النتائج بين الفريقين»)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  العلة الأصلية: نموذج الإدارة والمخزن يربطان الرقمين بالمفاتيح (`score.home`/`score.away`)
 *  صحيحًا، لكن بطاقة المباريات كانت تُجبر الرقمين على الترتيب اللاتيني `dir="ltr"` بينما
 *  عمود الفريق الأول يمينًا في صفحات RTL — فيقع رقم الفريق الأول ملاصقًا لعمود الثاني،
 *  فتظهر «1 - 0» للزائر وكأنها «0 - 1». هذه الاختبارات تُثبِت القواعد الثلاث للأبد:
 *
 *   1) الربط بالمفاتيح حصرًا: `score.home` لصاحب `homeTeam`، و`score.away` لصاحب `awayTeam`
 *      — من نموذج الإدخال حتى كل طبقة عرض، بما في ذلك جولة التخزين (JSON round-trip).
 *   2) كل رقم في عنصر مستقل يحمل هوية فريقه (`data-side` + `data-team-id`) بترتيب DOM منطقي
 *      ثابت [الأول، الثاني]، ولا `dir` مفروض على النتيجة في أي مكوّن — فلا قلب مزدوج.
 *   3) ممنوع على أي مكوّن عرض أن يبني سلسلة نتيجة نصية بنفسه؛ المصدر الوحيد هو
 *      `lib/matches/score-view.ts` عبر `components/MatchScoreView.tsx`.
 *
 *  مصفوفة النتائج المفروضة في التدقيق تُختبَر كاملة: (1,0) (0,1) (2,2) (4,1).
 */

// ── أدوات ─────────────────────────────────────────────────────────────────────

const MATRIX: Array<{ home: number; away: number; label: string }> = [
  { home: 1, away: 0, label: 'الفريق الأول 1، الفريق الثاني 0' },
  { home: 0, away: 1, label: 'الفريق الأول 0، الفريق الثاني 1' },
  { home: 2, away: 2, label: 'الفريق الأول 2، الفريق الثاني 2' },
  { home: 4, away: 1, label: 'الفريق الأول 4، الفريق الثاني 1' },
];

const HOME = { id: 'team-home-alpha', nameAr: 'نادي الشمال', nameEn: 'North Club' };
const AWAY = { id: 'team-away-south', nameAr: 'نادي الجنوب', nameEn: 'South Club' };

function formFor(home: number, away: number): MatchFormInput {
  return {
    status: 'finished',
    kickoffUtc: '2026-10-18T18:00:00Z',
    homeNameAr: HOME.nameAr,
    homeNameEn: HOME.nameEn,
    awayNameAr: AWAY.nameAr,
    awayNameEn: AWAY.nameEn,
    competitionCode: 'EGY',
    competitionNameAr: 'الدوري المصري الممتاز',
    competitionCountryAr: 'مصر',
    scoreHome: String(home),
    scoreAway: String(away),
  };
}

function baseRecord(score: MatchScore): MatchRecord {
  const link: NemoLinkResolution = {
    url: null,
    linkType: 'unavailable',
    labelAr: 'شاهد مباشرة على NEMO Sports',
    subLabelAr: 'صفحة المشاهدة الموحّدة',
    verified: false,
    matchedBy: [],
    competitionUrl: null,
    scheduleUrl: null,
  };
  return {
    id: 'presentation-test-match',
    competitionId: 'comp-egy',
    competitionCode: 'EGY',
    competitionNameAr: 'الدوري المصري الممتاز',
    competitionNameEn: 'Egyptian Premier League',
    competitionLogo: null,
    countryAr: 'مصر',
    region: 'egypt',
    priority: 10,
    isEgyptianInterest: true,
    seasonLabel: '2026-2027',
    roundLabelAr: null,
    utcKickoff: '2026-10-18T18:00:00.000Z',
    kickoffConfirmed: true,
    cairoDate: '2026-10-18',
    cairoTime: '٠٩:٠٠ م',
    homeTeam: { ...HOME, isEgyptian: true, logoUrl: null },
    awayTeam: { ...AWAY, isEgyptian: true, logoUrl: null },
    status: 'finished',
    statusLabelAr: 'انتهت المباراة',
    statusNoteAr: null,
    liveMinute: null,
    score,
    venue: null,
    primarySource: 'sportscore',
    contributingSources: ['sportscore'],
    externalIds: {},
    nemoLink: link,
    lastUpdatedAt: '2026-10-18T21:00:00.000Z',
  };
}

function expectAt(html: string, needle: string, label: string): number {
  const i = html.indexOf(needle);
  assert.notEqual(i, -1, `${label}: expected to find "${needle}" in rendered HTML`);
  return i;
}

/** يستخرج عناصر [data-side] بترتيبها في DOM: من أي عنصر «side» وقيمته النصية. */
function scoreDigits(html: string): Array<{ side: string; value: string; at: number }> {
  const out: Array<{ side: string; value: string; at: number }> = [];
  const re = /data-side="(home|away)"[^>]*>([^<]*)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push({ side: m[1], value: m[2], at: m.index });
  return out;
}

// ── 1) طبقة البيانات: الربط بالمفاتيح من النموذج حتى السجل العام ──────────────

test('score-view: كل حالة من المصفوفة المفروضة تُربط بالمفاتيح لا بالاسم ولا بالموضع', () => {
  for (const { home, away, label } of MATRIX) {
    const view = buildMatchScoreView({
      score: { home, away },
      status: 'finished',
      homeTeam: HOME,
      awayTeam: AWAY,
    });
    assert.ok(view.hasScore, label);
    assert.equal(view.sides[0].side, 'home', `${label}: العنصر الأول هو الأول`);
    assert.equal(view.sides[0].display, String(home), `${label}: رقم الفريق الأول`);
    assert.equal(view.sides[0].teamId, HOME.id, `${label}: رقم الأول يحمل معرّف الأول`);
    assert.equal(view.sides[1].side, 'away', `${label}: العنصر الثاني هو الثاني`);
    assert.equal(view.sides[1].display, String(away), `${label}: رقم الفريق الثاني`);
    assert.equal(view.sides[1].teamId, AWAY.id, `${label}: رقم الثاني يحمل معرّف الثاني`);
    assert.equal(view.summaryText, `${home} - ${away}`, `${label}: الملخص المنطقي home-first`);
  }

  // إثبات أن الملكية بالمفتاح: تبديل الأسماء المعروضة لا ينقل الأرقام بين المفاتيح.
  const swappedNames = buildMatchScoreView({
    score: { home: 1, away: 0 },
    status: 'finished',
    homeTeam: { ...HOME, nameAr: AWAY.nameAr },
    awayTeam: { ...AWAY, nameAr: HOME.nameAr },
  });
  assert.equal(swappedNames.sides[0].display, '1');
  assert.equal(swappedNames.sides[1].display, '0');
});

test('score-view: الحجب عن الحالات غير المؤهلة قاعدة واحدة (لا رقم لمباراة لم تبدأ)', () => {
  assert.equal(scoreIsDisplayable({ home: 0, away: 0 }, 'not_started'), false);
  assert.equal(scoreIsDisplayable({ home: 1, away: 0 }, 'finished'), true);
  assert.equal(scoreIsDisplayable({ home: 1, away: null }, 'live'), false);
  const view = buildMatchScoreView({
    score: { home: 1, away: 0 },
    status: 'not_started',
    homeTeam: HOME,
    awayTeam: AWAY,
  });
  assert.equal(view.hasScore, false, 'لم تبدأ ⇒ لا تُعرض أرقام حتى لو وجدت في السجل');
  assert.equal(view.sides[0].display, '—');
});

test('الحفظ اليدوي (إنشاءً): الأرقام تُخزَّن مرتبطة بصاحبيها ثم تعود بنفس الاقتران من التخزين', async () => {
  const { buildManualMatchFromForm } = await import('../lib/admin/service');
  for (const { home, away, label } of MATRIX) {
    const { record } = buildManualMatchFromForm(formFor(home, away), 'auditor');
    assert.ok(record, `${label}: النموذج يجب أن يجتاز التحقق`);
    assert.equal(record!.score.home, home, `${label}: score.home يحفظ رقم الأول`);
    assert.equal(record!.score.away, away, `${label}: score.away يحفظ رقم الثاني`);
    assert.equal(record!.homeTeam.nameAr, HOME.nameAr, `${label}: الفريق الأول بصاحبه`);

    // جولة التخزين: التسلسل في JSON ثم إعادة التطبيع لا تعكس ولا تُغيّر شيئًا.
    const serialized = JSON.stringify({
      schemaVersion: MANUAL_DOCUMENT_SCHEMA,
      revision: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: 'auditor',
      matches: [record],
      overrides: [],
      news: [],
      competitionOverrides: {},
    });
    const normalized = normalizeManualDocument(JSON.parse(serialized));
    const roundTripped = normalized.matches[0];
    assert.equal(roundTripped.score.home, home, `${label}: بعد القراءة رقم الأول باقٍ لصاحبه`);
    assert.equal(roundTripped.score.away, away, `${label}: بعد القراءة رقم الثاني باقٍ لصاحبه`);
    assert.equal(roundTripped.homeTeam.nameAr, HOME.nameAr, `${label}: الفريق الأول لم يتبدل`);
    assert.equal(roundTripped.awayTeam.nameAr, AWAY.nameAr, `${label}: الفريق الثاني لم يتبدل`);

    // سجل العرض العام المبني من نفس السجل يحمل نفس الاقتران.
    const matchRecord = buildMatchRecordFromManual(roundTripped);
    assert.equal(matchRecord.homeTeam.nameAr, HOME.nameAr);
    assert.equal(matchRecord.score.home, home, `${label}: سجل الموقع: رقم الأول مع الأول`);
    assert.equal(matchRecord.score.away, away, `${label}: سجل الموقع: رقم الثاني مع الثاني`);

    // سجل الكتالوج والبيانات المنظمة: نفس المفاتيح (homeScore للأول).
    const catalog = buildCatalogEntryFromManual(roundTripped);
    assert.equal(catalog.schema?.homeScore, home, `${label}: schema.homeScore = نتيجة الأول`);
    assert.equal(catalog.schema?.awayScore, away, `${label}: schema.awayScore = نتيجة الثاني`);
    assert.equal(catalog.homeTeam.nameAr, HOME.nameAr);
    assert.equal(catalog.awayTeam.nameAr, AWAY.nameAr);
  }
});

// ── 2) طبقة العرض: كل رقم في عنصر مستقل بمفتاح صاحبه، بلا فرض اتجاه ───────────

test('MatchScoreView: DOM منطقي [الأول، الفاصل، الثاني] وهوية لكل رقم وبلا dir مفروض', () => {
  for (const { home, away, label } of MATRIX) {
    const html = renderToStaticMarkup(
      React.createElement(MatchScoreView, {
        score: { home, away } as MatchScore,
        status: 'finished',
        homeTeam: HOME,
        awayTeam: AWAY,
      })
    );
    assert.ok(!/dir="ltr"/.test(html), `${label}: لا يُفرض اتجاه لاتيني على النتيجة`);
    const digits = scoreDigits(html);
    assert.equal(digits.length, 2, `${label}: رقمان مستقلان`);
    assert.equal(digits[0].side, 'home');
    assert.equal(digits[0].value, String(home));
    assert.ok(digits[0].at < digits[1].at, `${label}: رقم الأول قبل رقم الثاني في DOM`);
    assert.equal(digits[1].side, 'away');
    assert.equal(digits[1].value, String(away));
    assert.ok(html.includes(`data-team-id="${HOME.id}"`), `${label}: رقم الأول يحمل معرّف فريقه`);
    assert.ok(html.includes(`data-team-id="${AWAY.id}"`), `${label}: رقم الثاني يحمل معرّف فريقه`);
    assert.ok(
      html.includes(`نتيجة ${HOME.nameAr}: ${home}`) && html.includes(`نتيجة ${AWAY.nameAr}: ${away}`),
      `${label}: aria-label يقترن بالاسم والرقم الصحيحين`
    );
  }
});

test('MatchCard: الاقتران البصري — رقم الأول في تدفق DOM بجانب عمود الفريق الأول لا عمود الثاني', () => {
  for (const { home, away, label } of MATRIX) {
    const html = renderToStaticMarkup(React.createElement(MatchCard, { match: baseRecord({ home, away }) }));
    const digits = scoreDigits(html);
    assert.equal(digits.length, 2, `${label}: بطاقة واحدة برقمين`);
    assert.equal(digits[0].side, 'home');
    assert.equal(digits[0].value, String(home), `${label}: رقم الأول صحيح ومربوط به`);
    assert.equal(digits[1].side, 'away');
    assert.equal(digits[1].value, String(away), `${label}: رقم الثاني صحيح ومربوط به`);
    // عمود الفريق الأول (aria-label درعه) يسبق الرقم الأول، والرقم الثاني يسبق عمود الفريق الثاني.
    const homeCrestAt = expectAt(html, `aria-label="${HOME.nameAr}"`, label);
    const awayCrestAt = expectAt(html, `aria-label="${AWAY.nameAr}"`, label);
    assert.ok(homeCrestAt < digits[0].at, `${label}: رقم الفريق الأول يقع بعد عمود الأول في التدفق`);
    assert.ok(digits[1].at < awayCrestAt, `${label}: رقم الفريق الثاني يقع بعد عمود الثاني في التدفق`);
    assert.ok(!/kl-score-badge[^>]*dir="ltr"/.test(html), `${label}: لا فرض اتجاه على شارة النتيجة`);
  }
});

test('مكونات العرض العامة كلها تعرض النتيجة عبر الاقتران المرجعي ولا تبني نصها بنفسها', () => {
  const repoRoot = process.cwd();
  const displayFiles = [
    'components/MatchCard.tsx',
    'components/MatchLandingView.tsx',
    'components/LiveBroadcastView.tsx',
    'components/SourceMatchDetails.tsx',
    'app/admin/matches/page.tsx',
  ];
  for (const rel of displayFiles) {
    const code = stripComments(fs.readFileSync(path.join(repoRoot, rel), 'utf-8'));
    assert.ok(
      code.includes('MatchScoreView'),
      `${rel}: يجب أن يعرض النتيجة عبر المكوّن المرجعي الوحيد`
    );
    // ممنوع: بناء سلسلة «home - away» يدويًا داخل JSX (هو ما كان يُقرأ معكوسًا في RTL).
    const manualScoreString = code.match(/`\$\{[\w.]*score\.home[\s\S]{0,60}?score\.away[^`]*`/);
    assert.equal(manualScoreString, null, `${rel}: لا سرد نصي يدوي للنتيجة`);
    // ممنوع: فرض dir على حاويات النتيجة.
    assert.ok(!/kl-score-badge[^>]*dir=/.test(code), `${rel}: لا dir مفروض على شارة النتيجة`);
    assert.ok(!/kl-live-score[^>]*dir=/.test(code), `${rel}: لا dir مفروض على نتيجة صفحة البث`);
  }
});

test('بطاقة OG تعرض الرقمين بنفس ترتيب السجل وموازيةً لعمودَي الفريقين', () => {
  const code = stripComments(
    fs.readFileSync(path.join(process.cwd(), 'app/matches/[id]/opengraph-image.tsx'), 'utf-8')
  );
  assert.ok(code.includes('buildMatchScoreView'), 'بطاقة OG تقرأ الاقتران المرجعي');
  assert.match(code, /sides\[0\][\s\S]{0,200}?sides\[1\]/, 'ترتيب الأبناء: الأول ثم الثاني في DOM');
  assert.match(code, /flexDirection: 'row-reverse'/, 'صف النتيجة يسير عكس اتجاه الأبناء كما يسير صف الفريقين');
});

// ── 3) التثبيت اليدوي فوق سجل مصدر: لا قلب ولا قلب مزدوج ──────────────────────

test('applyOverrideToMatch: النتيجة المثبَّتة تُطبَّق بالمفاتيح، وتكرار التطبيق لا يعكسها', () => {
  const override: ManualOverride = {
    matchId: 'presentation-test-match',
    lockAll: false,
    locked: ['score'],
    values: {
      score: { home: 4, away: 1, halfTimeHome: null, halfTimeAway: null },
    },
    suppressedSources: [],
    noteAr: null,
    updatedAt: new Date().toISOString(),
    updatedBy: 'auditor',
  };
  const source = baseRecord({ home: 1, away: 0 });

  const once = applyOverrideToMatch(source, override);
  assert.equal(once.score.home, 4);
  assert.equal(once.score.away, 1);
  assert.equal(once.homeTeam.nameAr, HOME.nameAr, 'التثبيت لا يمس هوية الفرق');

  // التطبيق مرة ثانية (تكرار الدمج في مزامنة تالية) لا يعكس ولا يغيّر شيئًا — idempotent.
  const twice = applyOverrideToMatch(once, override);
  assert.deepEqual(twice.score, once.score);
  assert.equal(twice.homeTeam.nameAr, once.homeTeam.nameAr);
  assert.equal(twice.awayTeam.nameAr, once.awayTeam.nameAr);

  // والنتيجة بعد التثبيت تُقرأ في العرض بنفس الاقتران: 4 مع «الشمال» و1 مع «الجنوب».
  const view = buildMatchScoreView({
    score: twice.score,
    status: 'finished',
    homeTeam: twice.homeTeam,
    awayTeam: twice.awayTeam,
  });
  assert.equal(view.sides[0].display, '4');
  assert.equal(view.sides[0].teamName, HOME.nameAr);
  assert.equal(view.sides[1].display, '1');
  assert.equal(view.sides[1].teamName, AWAY.nameAr);
});

// ── 4) حارس البنية: لا نمط «شارة بلاتينية» يرجع مستقبلًا ──────────────────────

test('المسح الشامل: لا مكوّن عرض يبقي dir="ltr" على شارة نتيجة اليوم', () => {
  const repoRoot = process.cwd();
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(tsx|ts)$/.test(entry.name)) files.push(rel);
    }
  };
  walk('components');
  walk('app');
  const violations: string[] = [];
  for (const rel of files) {
    const code = stripComments(fs.readFileSync(path.join(repoRoot, rel), 'utf-8'));
    if (/kl-score-badge[^>]{0,80}dir="ltr"/.test(code)) violations.push(rel);
    // أي محاولة لفرض اتجاه على حاوية أرقام النتيجة (أوقات/روابط LTR المشروعة لا تتأثر).
    if (/kl-score-pair[^>]{0,40}dir=/.test(code)) violations.push(`${rel}: dir على kl-score-pair`);
  }
  assert.deepEqual(violations, [], 'لا سطح عرض يفرض اتجاهًا على النتيجة بعد الإصلاح');
});
