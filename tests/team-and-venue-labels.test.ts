import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  UNKNOWN_TEAM_NAME_AR,
  isPlaceholderTeamName,
  resolveCompetitionByMeta,
  resolveTeamDisplayIdentity,
} from '../lib/catalog';
import { mapSportScoreMatchToRecord } from '../lib/sources/sportscore';
import { mapTheSportsDBEventToRecord } from '../lib/sources/thesportsdb';
import { stripComments } from './helpers/source-scan';
import type { CompetitionStandingTable } from '../lib/types';
import SourceMatchDetails from '../components/SourceMatchDetails';
import MatchCard from '../components/MatchCard';
import StandingsSection from '../components/StandingsSection';
import type { MatchRecord, NemoLinkResolution } from '../lib/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  أسماء الفرق والبطولات + تفاصيل المباراة والملعب (تدقيق 2026-10-15)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  عيوب مرصودة من مخرجات الإنتاج:
 *   • «Myanmar Universitet ضد Team dj2ryoh2w90q1zp» — قيمة تقنية ظهرت كاسم فريق.
 *   • «كولورادو رابيدز ضد Minnesota United FC» — اسمان بلغتين مختلفتين في بطاقة واحدة.
 *   • البطولة الواحدة (الدوري الأمريكي) باسمين أجنبيين مختلفين بحسب المزوّد.
 *   • سجلات SportScore بلا ملعب، وكان السطر يُخفى بدل إعلان أن المصدر لم يوفّره.
 */

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

function baseRecord(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 'match-sportscore-placeholder-sample',
    competitionId: 'comp-myanmar-league-1',
    competitionCode: 'MYANMAR-LEAGUE-1',
    competitionNameAr: 'Myanmar League 1',
    competitionNameEn: 'Myanmar League 1',
    competitionLogo: null,
    countryAr: 'ميانمار',
    region: 'world',
    priority: 75,
    isEgyptianInterest: false,
    seasonLabel: '',
    roundLabelAr: null,
    utcKickoff: '2026-10-15T05:00:00.000Z',
    kickoffConfirmed: true,
    cairoDate: '2026-10-15',
    cairoTime: '٠٧:٠٠ ص',
    homeTeam: {
      id: 'team-ss-myanmar-universitet',
      nameAr: 'Myanmar Universitet',
      nameEn: 'Myanmar Universitet',
      logoUrl: null,
      isEgyptian: false,
    },
    awayTeam: {
      id: 'team-ss-team-dj2ryoh2w90q1zp',
      nameAr: 'Team dj2ryoh2w90q1zp',
      nameEn: 'Team dj2ryoh2w90q1zp',
      logoUrl: null,
      isEgyptian: false,
    },
    status: 'not_started',
    statusLabelAr: 'لم تبدأ بعد',
    statusNoteAr: null,
    liveMinute: null,
    score: { home: null, away: null },
    venue: null,
    primarySource: 'sportscore',
    contributingSources: ['sportscore'],
    externalIds: { sportscoreTrackerId: '1l4rjnhnyvd3m7v' },
    nemoLink: unverifiedLink(),
    lastUpdatedAt: '2026-10-15T04:24:38.000Z',
    ...overrides,
  };
}

test('القيمة التقنية من المصدر لا تُعرض كاسم فريق، ويُعرض بدلها نص واضح', () => {
  assert.equal(isPlaceholderTeamName('Team dj2ryoh2w90q1zp'), true);
  assert.equal(isPlaceholderTeamName('team_1l4rjnhnyvd3m7v'), true);
  assert.equal(isPlaceholderTeamName('TBD'), true);
  assert.equal(isPlaceholderTeamName('N/A'), true);
  assert.equal(isPlaceholderTeamName(''), true);
  // ولا يُصنَّف أي اسم نادٍ حقيقي كقيمة تقنية (حماية من إخفاء أسماء صحيحة).
  for (const real of [
    'Myanmar Universitet',
    'Sportvereniging Notch',
    'FC Dallas',
    'سياتل ساوندرز',
    'Universidad de Chile',
    'Deportivo Maldonado',
    'Club Sando Moruga',
  ]) {
    assert.equal(isPlaceholderTeamName(real), false, real);
  }

  const identity = resolveTeamDisplayIdentity({
    id: 'team-ss-team-dj2ryoh2w90q1zp',
    nameAr: 'Team dj2ryoh2w90q1zp',
    nameEn: 'Team dj2ryoh2w90q1zp',
  });
  assert.equal(identity.displayName, UNKNOWN_TEAM_NAME_AR);
  assert.equal(identity.isPlaceholder, true);
  assert.equal(identity.isArabicName, true);

  // وأسماء الأندية الحقيقية تمرّ كما هي مع ضبط اتجاه النص.
  const english = resolveTeamDisplayIdentity({ id: 'team-ss-fc-dallas', nameAr: 'FC Dallas', nameEn: 'FC Dallas' });
  assert.equal(english.displayName, 'FC Dallas');
  assert.equal(english.isArabicName, false);

  const arabic = resolveTeamDisplayIdentity({ id: 'team-tsdb-134149', nameAr: 'سياتل ساوندرز', nameEn: 'Seattle Sounders' });
  assert.equal(arabic.displayName, 'سياتل ساوندرز');
  assert.equal(arabic.isArabicName, true);
  assert.equal(arabic.secondaryName, 'Seattle Sounders', 'الاسم المرجعي متاح للعرض عند اختلاط اللغتين');

  // ولا يُكرَّر الاسم المرجعي حين يطابق المعروض، ولا يُقبل مرجع بالعربية (لا فائدة من سطرين عربيين).
  const sameName = resolveTeamDisplayIdentity({ id: 'team-ss-fc-dallas', nameAr: 'FC Dallas', nameEn: 'FC Dallas' });
  assert.equal(sameName.secondaryName, null);
  const arabicSourceName = resolveTeamDisplayIdentity({ id: 'team-tsdb-x', nameAr: 'الهلال', nameEn: 'الهلال' });
  assert.equal(arabicSourceName.secondaryName, null);
});

test('المحوّلان يملأان اسم الفريق وحالة الاسم معًا (لا فصل بينهما)', () => {
  // SportScore: نفس الشكل الحقيقي المرصود في الإنتاج باسم فريق تقني.
  const sportscore = mapSportScoreMatchToRecord({
    home: 'Myanmar Universitet',
    away: 'Team dj2ryoh2w90q1zp',
    home_score: null,
    away_score: null,
    status: 'notstarted',
    time: '2026-10-15T05:00:00Z',
    competition: 'Myanmar League 1',
    competition_slug: 'myanmar-league-1',
    url: 'https://sportscore.com/match/1l4rjnhnyvd3m7v',
  });
  assert.equal(sportscore.awayTeam.nameAr, UNKNOWN_TEAM_NAME_AR);
  assert.equal(sportscore.awayTeam.nameStatus, 'placeholder');
  assert.equal(
    sportscore.awayTeam.nameEn,
    'Team dj2ryoh2w90q1zp',
    'قيمة المصدر تبقى محفوظة كما وردت (بلا تغيير بيانات المصدر)'
  );
  assert.equal(sportscore.awayTeam.id, 'team-ss-team-dj2ryoh2w90q1zp', 'معرّف الفريق لم يتغيّر');
  assert.equal(sportscore.homeTeam.nameStatus, 'source');

  // TheSportsDB: الأندية المعروفة عربيًا تحصل على `verified`، والمترجمة على `translated`.
  const tsdb = mapTheSportsDBEventToRecord({
    idEvent: '2407135',
    strTimestamp: '2026-10-15T00:30:00Z',
    strEvent: 'Chicago Fire vs Philadelphia Union',
    strSeason: '2026',
    idLeague: '4346',
    strLeague: 'American Major League Soccer',
    strHomeTeam: 'Chicago Fire',
    strAwayTeam: 'Philadelphia Union',
    idHomeTeam: '134154',
    idAwayTeam: '134142',
    intHomeScore: '1',
    intAwayScore: '3',
    strStatus: 'FT',
    strVenue: 'Soldier Field',
  } as Parameters<typeof mapTheSportsDBEventToRecord>[0]);
  assert.equal(tsdb.homeTeam.nameStatus, 'source');
  assert.equal(tsdb.homeTeam.nameAr, 'Chicago Fire');
  assert.equal(
    tsdb.competitionNameAr,
    'الدوري الأمريكي للمحترفين',
    'اسم البطولة يظهر بالعربية للدوري الأمريكي من كلا المزوّدين'
  );
  assert.equal(tsdb.countryAr, 'الولايات المتحدة');
});

test('البطولة الواحدة تُترجم بالعربية مهما اختلف اسم المزوّد', () => {
  const fromTheSportsDB = resolveCompetitionByMeta({
    nameEn: 'American Major League Soccer',
    thesportsdbId: '4346',
  });
  const fromSportScore = resolveCompetitionByMeta({
    nameEn: 'United States Major League Soccer',
    sportscoreSlug: 'united-states-major-league-soccer',
  });
  assert.equal(fromTheSportsDB.nameAr, 'الدوري الأمريكي للمحترفين');
  assert.equal(fromSportScore.nameAr, 'الدوري الأمريكي للمحترفين');
  assert.equal(fromTheSportsDB.countryAr, 'الولايات المتحدة');
  assert.equal(fromSportScore.countryAr, 'الولايات المتحدة');

  // بطولة مصرية: ترجمة الكتالوج الرسمي كما هي (لا تراجع في السلوك القديم).
  const egyptian = resolveCompetitionByMeta({ nameEn: 'Egyptian Premier League', thesportsdbId: '4829' });
  assert.equal(egyptian.code, 'EGY');
  assert.equal(egyptian.nameAr, 'الدوري المصري الممتاز');
});

test('صفحة تفاصيل سجل المصدر: لا ملعب مُخترع، ولا فاصل معلَّق، ولا اسم تقني', () => {
  const html = renderToStaticMarkup(SourceMatchDetails({ record: baseRecord() }));
  assert.match(html, /غير متاح من المصادر لهذه المباراة/, 'غياب الملعب يُعلن صراحةً');
  assert.doesNotMatch(html, /Team dj2ryoh2w90q1zp/, 'القيمة التقنية لا تُعرض للزائر');
  assert.match(html, /فريق غير معروف/, 'يُعرض البديل الواضح بدل الاسم التقني');
  assert.doesNotMatch(html, /Myanmar League 1\s*—\s*<\//, 'لا فاصل معلَّق عند غياب الموسم');
  assert.match(html, /Myanmar League 1/);

  // وعند وجود ملعب: يُعرض كما ورد من المصدر.
  const withVenue = renderToStaticMarkup(SourceMatchDetails({ record: baseRecord({ venue: 'Soldier Field' }) }));
  assert.match(withVenue, /الملعب: Soldier Field/);
});

test('بطاقة المباراة تعزل اتجاه الأسماء وتُظهر الاسم المرجعي في البطاقة المختلطة فقط', () => {
  const home = {
    ...baseRecord().homeTeam,
    id: 'team-tsdb-134154',
    nameAr: 'كولورادو رابيدز',
    nameEn: 'Colorado Rapids',
  };
  const awayLatin = {
    ...baseRecord().awayTeam,
    id: 'team-ss-minnesota-united-fc',
    nameAr: 'Minnesota United FC',
    nameEn: 'Minnesota United FC',
  };

  // الحالة المُبلَّغ عنها: فريق عربي مقابل فريق لاتيني — يُعرض المرجع اللاتيني للفريق العربي.
  const mixed = renderToStaticMarkup(MatchCard({ match: baseRecord({ homeTeam: home, awayTeam: awayLatin }) }));
  assert.match(mixed, /كولورادو رابيدز/);
  assert.match(mixed, /kl-team-name-alt/);
  assert.match(mixed, />Colorado Rapids</);
  assert.match(mixed, /dir="auto"/);
  assert.match(mixed, /lang="ar"/);
  assert.match(mixed, /lang="en"/);
  assert.doesNotMatch(mixed, /Team dj2ryoh2w90q1zp/);

  // بطاقة عربية بالكامل: سطر واحد لكل فريق، بلا سطر مرجعي زائد.
  const allArabic = renderToStaticMarkup(
    MatchCard({
      match: baseRecord({
        homeTeam: { ...home, nameAr: 'الأهلي', nameEn: 'Al Ahly' },
        awayTeam: { ...baseRecord().awayTeam, nameAr: 'الزمالك', nameEn: 'Zamalek' },
      }),
    })
  );
  assert.match(allArabic, /الأهلي/);
  assert.match(allArabic, /الزمالك/);
  assert.doesNotMatch(allArabic, /kl-team-name-alt/);

  // واسم تقني من المصدر لا يظهر للزائر في أي حالة.
  const latin = renderToStaticMarkup(MatchCard({ match: baseRecord() }));
  assert.match(latin, /dir="auto"/);
  assert.doesNotMatch(latin, /Team dj2ryoh2w90q1zp/);
});

test('اتجاه النص مضبوط في CSS لكل أسماء الفرق (عزل bidi)', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf-8');
  const block = css.split('.kl-team-name {')[1]?.split('}')[0] ?? '';
  assert.match(block, /unicode-bidi:\s*isolate/, 'اسم الفريق معزول اتجاهيًا');
  assert.match(css, /\.kl-team-name-alt\s*{/, 'للاسم الأجنبي صنف مستقل بمقاس أصغر');
  assert.match(
    (css.split('.kl-team-name-alt {')[1]?.split('}')[0] ?? ''),
    /unicode-bidi:\s*isolate/
  );
});

test('لا يستخدم أي مكوّن عرض اسم الفريق الخام بدل اسم العرض الآمن', () => {
  for (const file of ['components/MatchCard.tsx', 'components/SourceMatchDetails.tsx']) {
    const source = stripComments(fs.readFileSync(path.join(process.cwd(), file), 'utf-8'));
    assert.match(source, /resolveTeamDisplayIdentity/, `${file}: يستخدم طبقة اسم العرض`);
  }
  // ولا تُبنى سطور التفاصيل من قيمة قد تكون فارغة بلا تصفية.
  const details = stripComments(fs.readFileSync(path.join(process.cwd(), 'components/SourceMatchDetails.tsx'), 'utf-8'));
  assert.match(details, /filter\(Boolean\)/, 'أجزاء سطر البطولة تُصفّى قبل الجمع');
});

test('جدول الترتيب: لا يُبنى رابط نادٍ من قيمة تقنية، والأسماء الحقيقية تبقى بروابطها', () => {
  const table: CompetitionStandingTable = {
    competitionCode: 'EGY',
    competitionNameAr: 'الدوري المصري الممتاز',
    competitionNameEn: 'Egyptian Premier League',
    competitionLogo: null,
    seasonLabel: '2026',
    sourceId: 'sportscore',
    nemoCompetitionUrl: 'https://nemo-sports.vercel.app/competitions/egyptian-premier-league',
    updatedAt: '2026-10-15T04:43:45.000Z',
    rows: [
      {
        position: 1,
        teamId: 'team-al-ahly',
        teamNameAr: 'الأهلي',
        teamNameEn: 'Al Ahly',
        teamLogo: null,
        played: 5,
        won: 4,
        drawn: 1,
        lost: 0,
        goalsFor: 12,
        goalsAgainst: 4,
        goalDiff: 8,
        points: 13,
        noteAr: null,
        nemoTeamUrl: 'https://nemo-sports.vercel.app/teams/Al%20Ahly%20FC',
      },
      {
        position: 2,
        teamId: 'team-ss-team-dj2ryoh2w90q1zp',
        teamNameAr: 'Team dj2ryoh2w90q1zp',
        teamNameEn: 'Team dj2ryoh2w90q1zp',
        teamLogo: null,
        played: 5,
        won: 0,
        drawn: 0,
        lost: 5,
        goalsFor: 1,
        goalsAgainst: 20,
        goalDiff: -19,
        points: 0,
        noteAr: null,
        nemoTeamUrl: 'https://nemo-sports.vercel.app/teams/Team%20dj2ryoh2w90q1zp',
      },
    ],
  };

  const html = renderToStaticMarkup(StandingsSection({ standings: { EGY: table } }));
  // الاسم الحقيقي: يبقى كما هو وبرابطه الحالي بلا أي تغيير في الوجهة.
  assert.match(html, /href="https:\/\/nemo-sports\.vercel\.app\/teams\/Al%20Ahly%20FC"/);
  assert.match(html, /الأهلي/);
  // القيمة التقنية: عبارة واضحة، وبلا رابط نادٍ مُخترع من قيمة ليست اسم نادٍ.
  assert.match(html, /فريق غير معروف/);
  assert.doesNotMatch(html, /Team dj2ryoh2w90q1zp/);
  assert.doesNotMatch(html, /teams\/Team%20dj2ryoh2w90q1zp/);
  // ورابط البطولة على NEMO Sports لم يتغيّر.
  assert.match(html, /href="https:\/\/nemo-sports\.vercel\.app\/competitions\/egyptian-premier-league"/);
});
