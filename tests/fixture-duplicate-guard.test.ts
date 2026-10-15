import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCompetitionIdentityKey,
  buildMatchDedupKey,
  buildTeamIdentityKey,
  compareFixtureIdentity,
  findDuplicateFixtureGroups,
} from '../lib/match-identity';
import { consolidateDuplicateFixtures } from '../lib/matches/fixture-consolidation';
import { defaultSourceRank } from '../lib/sources/priority';
import type { MatchRecord, NemoLinkResolution } from '../lib/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  حارس منع تكرار المباريات عبر المصادر  (تدقيق 2026-10-15)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  العطل الذي تمنعه هذه الاختبارات (مرصود من الإنتاج):
 *    • `match-api-football-1490533` و`match-sportscore-1l4rjnh9lgo0m7v` — مباراة واحدة
 *      (Chicago Fire ضد Philadelphia Union) ظهرت مرتين في جدول 2026-10-15.
 *    • السبب: مفتاح المطابقة القديم كان يشترط تطابق كود البطولة حرفيًا (`TSDB-4346` مقابل
 *      `UNITED-STATES-MAJOR-LEAGUE-SOCCER`) وتطابق الموعد بالثانية (٠٣:٣٠ مقابل ٠٣:٤٠)
 *      وتطابق ملصق الموسم (`2026` مقابل ``)، فلم يتحقق أي شرط رغم أن المباراة واحدة.
 *
 *  الاختبارات تعمل على **سجلات حقيقية مقتطفة من مخرجات الإنتاج** (tests/fixtures/live)
 *  حتى لا يكون الحكم مبنيًا على بيانات مُصنّعة.
 */

interface LiveFixtureFile {
  records: Array<Partial<MatchRecord> & Pick<MatchRecord, 'id' | 'utcKickoff' | 'cairoDate'>>;
}

function loadLiveRecords(): MatchRecord[] {
  const file = path.join(process.cwd(), 'tests/fixtures/live/duplicate-fixtures-2026-10-15.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as LiveFixtureFile;
  return parsed.records.map((record) => ({
    statusNoteAr: null,
    liveMinute: null,
    incidents: undefined,
    region: 'world',
    priority: 75,
    isEgyptianInterest: false,
    competitionLogo: null,
    nemoLink: unverifiedLink(),
    contributingSources: [record.primarySource ?? 'sportscore'],
    ...record,
  })) as MatchRecord[];
}

function unverifiedLink(): NemoLinkResolution {
  return {
    url: null,
    linkType: 'unavailable',
    labelAr: 'شاهد مباشرة على NEMO Sports',
    subLabelAr: 'شاهد المباراة عبر منصة NEMO Sports، واختر المباراة من صفحة المشاهدة.',
    verified: false,
    matchedBy: [],
    competitionUrl: null,
    scheduleUrl: null,
  };
}

const rank = defaultSourceRank;
const liveRecords = loadLiveRecords();
const byId = new Map(liveRecords.map((record) => [record.id, record]));
const chicagoTsdb = byId.get('match-api-football-1490533') as MatchRecord;
const chicagoSportscore = byId.get('match-sportscore-1l4rjnh9lgo0m7v') as MatchRecord;
const dallasTsdb = byId.get('match-api-football-1490532') as MatchRecord;
const dallasSportscore = byId.get('match-sportscore-ednm9whw0oynryo') as MatchRecord;

test('المباراتان المذكورتان في التقرير مباراة واحدة فعلًا من مصدرين (لا حدثان مختلفان)', () => {
  for (const [a, b, label] of [
    [chicagoTsdb, chicagoSportscore, 'Chicago Fire ضد Philadelphia Union'],
    [dallasTsdb, dallasSportscore, 'FC Dallas ضد Seattle Sounders'],
  ] as Array<[MatchRecord, MatchRecord, string]>) {
    const verdict = compareFixtureIdentity(a, b);
    assert.equal(verdict.same, true, label);
    assert.equal(verdict.confidence, 'strong', label);
    assert.ok(verdict.matchedOn.includes('teams'));
    assert.ok(verdict.matchedOn.includes('kickoff_window'));
    assert.equal(verdict.kickoffDeltaMinutes, 10, `${label}: فارق الموعد بين المصدرين 10 دقائق`);

    // نفس المعرّفات التي تثبت أنها المباراة ذاتها: نفس الفريقين بنفس الترتيب ونفس اليوم.
    assert.equal(buildTeamIdentityKey(a.homeTeam), buildTeamIdentityKey(b.homeTeam));
    assert.equal(buildTeamIdentityKey(a.awayTeam), buildTeamIdentityKey(b.awayTeam));
    assert.equal(a.cairoDate, b.cairoDate);
    // ويجب أن تكون النتيجة المعلنة من المصدرين متطابقة (لا تعارض بيانات).
    assert.deepEqual(
      { home: a.score.home, away: a.score.away },
      { home: b.score.home, away: b.score.away }
    );
  }
});

test('هوية البطولة تُوحّد أسماء المزوّدين المختلفة لنفس الدوري', () => {
  const tsdb = buildCompetitionIdentityKey({
    code: 'TSDB-4346',
    nameEn: 'American Major League Soccer',
  });
  const sportscore = buildCompetitionIdentityKey({
    code: 'UNITED-STATES-MAJOR-LEAGUE-SOCCER',
    nameEn: 'United States Major League Soccer',
  });
  assert.equal(tsdb, sportscore, 'الدوري الأمريكي واحد مهما اختلف اسم المزوّد');

  // بطولات الكتالوج الرسمي تبقى مميزة: لا خلط بين الدوري المصري وكأس مصر.
  assert.notEqual(
    buildCompetitionIdentityKey({ code: 'EGY', nameEn: 'Egyptian Premier League' }),
    buildCompetitionIdentityKey({ code: 'EGY_CUP', nameEn: 'Egypt Cup' })
  );
});

test('مفتاح المطابقة القديم لم يُحذف: سلوكه القديم محفوظ لمن يعتمد عليه', () => {
  // نفس المصدر ونفس الحقول حرفيًا ⇒ مفتاح واحد (السلوك القديم قائم بلا تغيير).
  assert.equal(buildMatchDedupKey(chicagoTsdb), buildMatchDedupKey({ ...chicagoTsdb }));
  // وبين المصدرين يبقى مختلفًا — وهذا هو سبب الحاجة إلى الحكم الجديد أعلاه.
  assert.notEqual(buildMatchDedupKey(chicagoTsdb), buildMatchDedupKey(chicagoSportscore));
});

test('درع الدمج: لا يُدمج ما ليس مباراة واحدة', () => {
  const base = chicagoTsdb;

  // ① فريقان مختلفان في نفس التوقيت ⇒ حدثان مختلفان.
  const otherTeams: MatchRecord = {
    ...base,
    id: 'match-x-other-teams',
    awayTeam: { ...base.awayTeam, id: 'team-ss-new-york-city', nameEn: 'New York City FC', nameAr: 'New York City FC' },
  };
  assert.equal(compareFixtureIdentity(base, otherTeams).same, false);

  // ② نفس الفريقين بيومين مختلفين ⇒ مباراتان (ذهاب/عودة).
  const otherDay: MatchRecord = { ...base, id: 'match-x-other-day', cairoDate: '2026-10-16', utcKickoff: '2026-10-16T00:30:00.000Z' };
  assert.equal(compareFixtureIdentity(base, otherDay).same, false);

  // ③ نفس الفريقين ونفس اليوم بفارق ساعتين ⇒ حدثان مختلفان.
  const farApart: MatchRecord = { ...base, id: 'match-x-far', utcKickoff: '2026-10-15T02:35:00.000Z' };
  assert.equal(compareFixtureIdentity(base, farApart).same, false);

  // ④ بطولتان معروفتان مختلفتان (دوري وكأس) بنفس الفريقين واليوم ⇒ لا دمج تلقائي.
  const cup: MatchRecord = {
    ...base,
    id: 'match-x-cup',
    competitionCode: 'EGY_CUP',
    competitionId: 'comp-egy-cup',
    competitionNameEn: 'Egypt Cup',
    competitionNameAr: 'كأس مصر',
  };
  const league: MatchRecord = { ...base, competitionCode: 'EGY', competitionId: 'comp-egy-pl', competitionNameEn: 'Egyptian Premier League', competitionNameAr: 'الدوري المصري الممتاز' };
  assert.equal(compareFixtureIdentity(league, cup).same, false);
  assert.equal(compareFixtureIdentity(league, cup).rejectedBy, 'different_known_competition');

  // ⑤ فريق نسائي وفريق رجالي بنفس الاسم الجذري ⇒ ليسا فريقًا واحدًا.
  const women: MatchRecord = {
    ...base,
    id: 'match-x-women',
    homeTeam: { ...base.homeTeam, id: 'team-ss-chicago-fire-women', nameEn: 'Chicago Fire Women', nameAr: 'Chicago Fire Women' },
  };
  assert.equal(compareFixtureIdentity(base, women).same, false);

  // ⑥ نتيجتان نهائيتان متعارضتان ⇒ لا دمج (خطأ مصدر لا تكرار مؤكد) بل مراجعة.
  const conflict: MatchRecord = { ...base, id: 'match-x-conflict', score: { home: 4, away: 0 } };
  const verdict = compareFixtureIdentity(base, conflict);
  assert.equal(verdict.same, false);
  assert.equal(verdict.rejectedBy, 'conflicting_final_score');
});

test('التوحيد ينتج سجلًا واحدًا يُعرض ويحفظ السجل الثاني ببيانات مصدره (بلا حذف)', () => {
  const { matches, report } = consolidateDuplicateFixtures(liveRecords, { sourceRank: rank });

  assert.equal(report.consolidated.length, 2, 'مجموعتان: كل مباراة كانت في سجلين');
  assert.equal(report.markedDuplicates, 2, 'سجلان عُلِّما كتكرار');
  assert.equal(matches.length, liveRecords.length, 'لا سجل حُذف من المخزن');

  const active = matches.filter((match) => !match.duplicateOfId);
  assert.equal(active.length, 2, 'مباراة واحدة لكل مجموعة بعد التوحيد');

  const chicago = active.find((match) => match.homeTeam.nameEn === 'Chicago Fire') as MatchRecord;
  const dallas = active.find((match) => match.homeTeam.nameEn === 'FC Dallas') as MatchRecord;
  assert.ok(chicago && dallas);

  // ① السجل الأساسي يحمل معرّفات المصدرين معًا: لا يُفقد معرّف أي مصدر.
  assert.equal(chicago.externalIds.sportscoreTrackerId, '1l4rjnh9lgo0m7v');
  assert.equal(chicago.externalIds.sportscoreSlug, 'chicago-fire-vs-philadelphia-union');
  assert.equal(chicago.externalIds.thesportsdbEventId, '2407135');
  assert.equal(chicago.externalIds.apiFootballFixtureId, '1490533');
  assert.deepEqual([...chicago.contributingSources].sort(), ['sportscore', 'thesportsdb']);

  // ② الحقول الناقصة في السجل الأساسي تُملأ من السجل الآخر (ملعب/موسم/جولة).
  assert.equal(chicago.venue, 'Soldier Field');
  assert.equal(chicago.seasonLabel, '2026');
  assert.equal(chicago.roundLabelAr, 'الجولة 29');
  assert.equal(dallas.venue, 'Toyota Stadium Dallas');

  // ③ النتيجة والحالة الصحيحة محفوظة كما وردت من المصدرين المتطابقين.
  assert.deepEqual({ home: chicago.score.home, away: chicago.score.away }, { home: 1, away: 3 });
  assert.deepEqual({ home: dallas.score.home, away: dallas.score.away }, { home: 1, away: 0 });
  assert.equal(chicago.status, 'finished');
  assert.equal(dallas.status, 'finished');

  // ④ البطولة المعروضة صارت عربية موحّدة بدل اسمين أجنبيين مختلفين.
  assert.equal(chicago.competitionNameAr, 'الدوري الأمريكي للمحترفين');
  assert.equal(dallas.competitionNameAr, 'الدوري الأمريكي للمحترفين');
  assert.equal(chicago.countryAr, 'الولايات المتحدة', 'الحقل العام «دولي» لا يطغى على دولة معروفة');

  // ⑤ السجل المكرر محفوظ كاملًا وبيانات مصدره لم تُمس.
  const marked = matches.filter((match) => match.duplicateOfId);
  for (const record of marked) {
    assert.equal(record.duplicateEvidence?.survivorId, record.duplicateOfId);
    assert.ok(record.duplicateEvidence?.kickoffDeltaMinutes === 10);
    assert.equal(record.duplicateEvidence?.requiresReview, false);
  }
  const markedChicago =
    marked.find((match) => match.homeTeam.nameEn === 'Chicago Fire') as MatchRecord;
  assert.equal(markedChicago.id, 'match-api-football-1490533');
  assert.equal(markedChicago.venue, 'Soldier Field', 'بيانات السجل المكرر تبقى كما وردت من مصدره');
  assert.equal(markedChicago.competitionCode, 'TSDB-4346');

  // ⑥ المجموعة نفسها لم تُعدّ تكرارًا في فحص التكرار بعد التوحيد.
  assert.deepEqual(findDuplicateFixtureGroups(active), []);
});

test('السجل الأساسي يختاره ترتيب المصادر الإداري، والسجلات المكررة تُوجَّه إليه', () => {
  const { matches } = consolidateDuplicateFixtures(liveRecords, { sourceRank: rank });
  const active = matches.filter((match) => !match.duplicateOfId);
  const chicago = active.find((match) => match.homeTeam.nameEn === 'Chicago Fire') as MatchRecord;
  // SportScore أولًا في القائمة الافتراضية، فالسجل الأساسي هو سجله (ورابطه هو القانوني).
  assert.equal(chicago.id, 'match-sportscore-1l4rjnh9lgo0m7v');
  assert.equal(chicago.primarySource, 'sportscore');

  // حكم المدير يُحترم: لو رفع أولوية TheSportsDB، يتغيّر السجل الأساسي بلا أي حذف.
  const flipped = consolidateDuplicateFixtures(liveRecords, {
    sourceRank: (sourceId) => (sourceId === 'thesportsdb' ? 5 : 30),
  }).matches.filter((match) => !match.duplicateOfId);
  const flippedChicago = flipped.find((match) => match.homeTeam.nameEn === 'Chicago Fire') as MatchRecord;
  assert.equal(flippedChicago.id, 'match-api-football-1490533');
});

test('إعادة تشغيل التوحيد لا تُغيّر شيئًا (idempotent)', () => {
  const first = consolidateDuplicateFixtures(liveRecords, { sourceRank: rank });
  const second = consolidateDuplicateFixtures(first.matches, { sourceRank: rank });
  assert.equal(second.report.markedDuplicates, 0);
  assert.equal(second.report.repointedDuplicates, 0);
  assert.deepEqual(
    second.matches.map((match) => match.id).sort(),
    first.matches.map((match) => match.id).sort()
  );
});

test('سجل مُعلَّم كتكرار يبقى مُعلَّمًا، وإذا اختفى السجل الأساسي يعود نشطًا (شفاء ذاتي)', () => {
  const consolidated = consolidateDuplicateFixtures(liveRecords, { sourceRank: rank }).matches;
  const survivor = consolidated.find(
    (match) => match.homeTeam.nameEn === 'Chicago Fire' && !match.duplicateOfId
  ) as MatchRecord;
  const orphaned = consolidated.filter((match) => match.id !== survivor.id);

  const healed = consolidateDuplicateFixtures(orphaned, { sourceRank: rank });
  const dallasActive = healed.matches.filter((match) => !match.duplicateOfId);
  // سجل Chicago المكرر عاد نشطًا لأن سجلًا أساسيًا لم يعد موجودًا، ومباراة Dallas بقيت موحَّدة.
  assert.equal(dallasActive.some((match) => match.homeTeam.nameEn === 'Chicago Fire'), true);
  assert.equal(dallasActive.filter((match) => match.homeTeam.nameEn === 'FC Dallas').length, 1);
});

test('سجل إداري يدوي أو مجمَّد لا يُخفي ولا يُعلَّم تلقائيًا — يُبلَّغ للمراجعة', () => {
  const manualChampion: MatchRecord = {
    ...chicagoTsdb,
    id: 'manual-chicago-fixture',
    origin: 'manual',
    primarySource: 'sportscore',
    externalIds: {},
  };
  const { matches, report } = consolidateDuplicateFixtures(
    [chicagoTsdb, { ...chicagoSportscore, origin: 'manual', id: 'manual-chicago-fixture' }],
    { sourceRank: rank }
  );
  assert.equal(report.requiresReview.length, 1);
  assert.match(report.requiresReview[0].reviewReasonAr ?? '', /الإدارة/);
  assert.equal(matches.filter((match) => match.duplicateOfId).length, 0, 'لم يُخفَ أي سجل');

  const frozen = consolidateDuplicateFixtures([chicagoTsdb, chicagoSportscore], {
    sourceRank: rank,
    isFrozen: (matchId) => matchId === 'match-api-football-1490533',
  });
  assert.equal(frozen.report.requiresReview.length, 1);
  assert.match(frozen.report.requiresReview[0].reviewReasonAr ?? '', /مجمَّد/);
  assert.equal(
    frozen.matches.find((match) => match.id === 'match-api-football-1490533')?.duplicateOfId ?? null,
    null,
    'السجل المجمَّد لم يُعلَّم كتكرار'
  );
  assert.ok(manualChampion.id);
});

test('سجل ناقص بلا روابط لا يُسقط عملية التوحيد كلها', () => {
  // سيناريو واقعي: لقطة قديمة/سجل مُستورد بلا `nemoLink`. الانهيار هنا يعني فشل المزامنة
  // كاملة بسبب حقل واحد — وهو أسوأ من نقص الحقل نفسه.
  const bare = {
    ...chicagoSportscore,
    id: 'match-sportscore-bare-sample',
    nemoLink: undefined,
  } as unknown as MatchRecord;
  const legacy = {
    ...chicagoTsdb,
    id: 'match-api-football-bare-sample',
    nemoLink: undefined,
  } as unknown as MatchRecord;

  const { matches, report } = consolidateDuplicateFixtures([bare, legacy], { sourceRank: rank });
  assert.equal(report.markedDuplicates, 1);
  assert.equal(matches.filter((match) => match.duplicateOfId).length, 1);
  assert.equal(matches.length, 2, 'لا حذف حتى مع سجل ناقص');
});
