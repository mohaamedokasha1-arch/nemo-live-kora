import { CompetitionRecord, CompetitionRegion, SourceId, TeamRecord } from './types';

export const NEMO_SPORTS_BASE_URL =
  process.env.NEXT_PUBLIC_NEMO_SPORTS_URL || 'https://nemo-sports.vercel.app';

/**
 * Canonical Competitions Catalog ordered by Egyptian Priority -> CAF -> Arab -> European -> World
 */
export const CANONICAL_COMPETITIONS: CompetitionRecord[] = [
  {
    id: 'comp-egy-pl',
    code: 'EGY',
    nameAr: 'الدوري المصري الممتاز',
    nameEn: 'Egyptian Premier League',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    region: 'egypt',
    priority: 10,
    isEgyptianPriority: true,
    logoUrl: 'https://img.thesports.com/football/competition/c840aa9f8b4c65b1441bb36459a40642.png',
    nemoCompetitionSlug: 'egyptian-league',
    currentSeason: '2026-2027',
    sourceIds: {
      sportscoreSlug: 'egyptian-premier-league',
      thesportsdbId: '4829',
      apiFootballId: 233,
    },
  },
  {
    id: 'comp-egy-cup',
    code: 'EGY_CUP',
    nameAr: 'كأس مصر',
    nameEn: 'Egypt Cup',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    region: 'egypt',
    priority: 12,
    isEgyptianPriority: true,
    logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/v0iz601786057987.png',
    nemoCompetitionSlug: 'egyptian-league',
    currentSeason: '2026-2027',
    sourceIds: {
      // TheSportsDB league 4830 is "Korean KBO League" (baseball), not an Egyptian Cup.
      // No verified TheSportsDB soccer id for the Egypt Cup exists yet, so none is mapped here.
      apiFootballId: 714,
    },
  },
  {
    id: 'comp-egy-lc',
    code: 'EGY_LC',
    nameAr: 'كأس الرابطة المصرية',
    nameEn: 'Egypt League Cup',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    region: 'egypt',
    priority: 14,
    isEgyptianPriority: true,
    logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/nvw1fl1645320012.png',
    nemoCompetitionSlug: 'egyptian-league',
    currentSeason: '2026-2027',
    sourceIds: {
      thesportsdbId: '5185',
      apiFootballId: 895,
    },
  },
  {
    id: 'comp-caf-cl',
    code: 'CAF',
    nameAr: 'دوري أبطال أفريقيا',
    nameEn: 'CAF Champions League',
    countryAr: 'أفريقيا',
    countryEn: 'Africa',
    region: 'africa',
    priority: 16,
    isEgyptianPriority: true,
    logoUrl: 'https://img.thesports.com/football/competition/caf-champions-league.png',
    nemoCompetitionSlug: 'caf-champions-league',
    currentSeason: '2026-2027',
    sourceIds: {
      sportscoreSlug: 'caf-champions-league',
      apiFootballId: 12,
    },
  },
  {
    id: 'comp-caf-cc',
    code: 'CAFC',
    nameAr: 'كأس الكونفدرالية الأفريقية',
    nameEn: 'CAF Confederation Cup',
    countryAr: 'أفريقيا',
    countryEn: 'Africa',
    region: 'africa',
    priority: 18,
    isEgyptianPriority: true,
    logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/faybl51762184629.png',
    nemoCompetitionSlug: 'caf-confederation-cup',
    currentSeason: '2026-2027',
    sourceIds: {
      sportscoreSlug: 'caf-confederation-cup',
      thesportsdbId: '5057',
      apiFootballId: 20,
    },
  },
  {
    id: 'comp-afcon',
    code: 'AC',
    nameAr: 'كأس أمم أفريقيا',
    nameEn: 'Africa Cup of Nations',
    countryAr: 'أفريقيا',
    countryEn: 'Africa',
    region: 'africa',
    priority: 20,
    isEgyptianPriority: true,
    logoUrl: 'https://crests.football-data.org/ac.png',
    nemoCompetitionSlug: null,
    currentSeason: '2025-2027',
    sourceIds: {
      footballDataCode: 'AC',
      apiFootballId: 6,
    },
  },
  {
    id: 'comp-wcq-caf',
    code: 'QCAF',
    nameAr: 'تصفيات كأس العالم — أفريقيا',
    nameEn: 'WC Qualification CAF',
    countryAr: 'أفريقيا',
    countryEn: 'Africa',
    region: 'africa',
    priority: 22,
    isEgyptianPriority: true,
    logoUrl: null,
    nemoCompetitionSlug: null,
    currentSeason: '2023-2026',
    sourceIds: {
      footballDataCode: 'QCAF',
      apiFootballId: 29,
    },
  },
  {
    id: 'comp-spl',
    code: 'SPL',
    nameAr: 'دوري روشن السعودي',
    nameEn: 'Saudi Pro League',
    countryAr: 'السعودية',
    countryEn: 'Saudi Arabia',
    region: 'arab',
    priority: 25,
    isEgyptianPriority: false,
    logoUrl: 'https://img.thesports.com/football/competition/890f0a0ce2f2b7bf384b6268c53ce81a.png',
    nemoCompetitionSlug: 'saudi-pro-league',
    currentSeason: '2026-2027',
    sourceIds: {
      sportscoreSlug: 'saudi-professional-league',
      thesportsdbId: '4668',
      apiFootballId: 307,
    },
  },
  {
    id: 'comp-ucl',
    code: 'CL',
    nameAr: 'دوري أبطال أوروبا',
    nameEn: 'UEFA Champions League',
    countryAr: 'أوروبا',
    countryEn: 'Europe',
    region: 'europe',
    priority: 30,
    isEgyptianPriority: false,
    logoUrl: 'https://img.thesports.com/football/competition/e506c9d6e409d8d13b47ff13f50983b1.png',
    nemoCompetitionSlug: 'champions-league',
    currentSeason: '2026-2027',
    sourceIds: {
      sportscoreSlug: 'uefa-champions-league',
      thesportsdbId: '4480',
      footballDataCode: 'CL',
      apiFootballId: 2,
    },
  },
  {
    id: 'comp-uel',
    code: 'UEL',
    nameAr: 'الدوري الأوروبي',
    nameEn: 'UEFA Europa League',
    countryAr: 'أوروبا',
    countryEn: 'Europe',
    region: 'europe',
    priority: 32,
    isEgyptianPriority: false,
    logoUrl: null,
    nemoCompetitionSlug: 'uefa-europa-league',
    currentSeason: '2026-2027',
    sourceIds: {
      sportscoreSlug: 'uefa-europa-league',
      footballDataCode: 'EL',
      apiFootballId: 3,
    },
  },
  {
    id: 'comp-epl',
    code: 'PL',
    nameAr: 'الدوري الإنجليزي الممتاز',
    nameEn: 'English Premier League',
    countryAr: 'إنجلترا',
    countryEn: 'England',
    region: 'europe',
    priority: 35,
    isEgyptianPriority: false,
    logoUrl: 'https://img.thesports.com/football/competition/964b5b0a5b21bc76da51a1d829944149.png',
    nemoCompetitionSlug: 'premier-league',
    currentSeason: '2026-2027',
    sourceIds: {
      sportscoreSlug: 'english-premier-league',
      thesportsdbId: '4328',
      footballDataCode: 'PL',
      apiFootballId: 39,
    },
  },
  {
    id: 'comp-laliga',
    code: 'PD',
    nameAr: 'الدوري الإسباني (لا ليغا)',
    nameEn: 'Spanish La Liga',
    countryAr: 'إسبانيا',
    countryEn: 'Spain',
    region: 'europe',
    priority: 36,
    isEgyptianPriority: false,
    logoUrl: 'https://img.thesports.com/football/competition/1fbbb4be3b47d9465c5badecc3122e07.png',
    nemoCompetitionSlug: 'la-liga',
    currentSeason: '2026-2027',
    sourceIds: {
      sportscoreSlug: 'spanish-la-liga',
      thesportsdbId: '4335',
      footballDataCode: 'PD',
      apiFootballId: 140,
    },
  },
  {
    id: 'comp-seriea',
    code: 'SA',
    nameAr: 'الدوري الإيطالي (سيري آ)',
    nameEn: 'Italian Serie A',
    countryAr: 'إيطاليا',
    countryEn: 'Italy',
    region: 'europe',
    priority: 37,
    isEgyptianPriority: false,
    logoUrl: 'https://img.thesports.com/football/competition/6b38f4015a6b3309ad9462e6ce27ae99.png',
    nemoCompetitionSlug: 'serie-a',
    currentSeason: '2026-2027',
    sourceIds: {
      sportscoreSlug: 'italian-serie-a',
      thesportsdbId: '4332',
      footballDataCode: 'SA',
      apiFootballId: 135,
    },
  },
  {
    id: 'comp-bundesliga',
    code: 'BL1',
    nameAr: 'الدوري الألماني (بوندسليغا)',
    nameEn: 'German Bundesliga',
    countryAr: 'ألمانيا',
    countryEn: 'Germany',
    region: 'europe',
    priority: 38,
    isEgyptianPriority: false,
    logoUrl: 'https://img.thesports.com/football/competition/0c6a25cd746e802296d9064b4504179d.png',
    nemoCompetitionSlug: 'bundesliga',
    currentSeason: '2026-2027',
    sourceIds: {
      sportscoreSlug: 'bundesliga',
      thesportsdbId: '4331',
      footballDataCode: 'BL1',
      apiFootballId: 78,
    },
  },
  {
    id: 'comp-ligue1',
    code: 'FL1',
    nameAr: 'الدوري الفرنسي (ليغ 1)',
    nameEn: 'French Ligue 1',
    countryAr: 'فرنسا',
    countryEn: 'France',
    region: 'europe',
    priority: 39,
    isEgyptianPriority: false,
    logoUrl: 'https://crests.football-data.org/FL1.png',
    nemoCompetitionSlug: 'ligue-1',
    currentSeason: '2026-2027',
    sourceIds: {
      sportscoreSlug: 'french-ligue-1',
      thesportsdbId: '4334',
      footballDataCode: 'FL1',
      apiFootballId: 61,
    },
  },
  {
    id: 'comp-wc',
    code: 'WC',
    nameAr: 'كأس العالم FIFA',
    nameEn: 'FIFA World Cup',
    countryAr: 'دولي',
    countryEn: 'World',
    region: 'world',
    priority: 40,
    isEgyptianPriority: false,
    logoUrl: 'https://crests.football-data.org/wc.png',
    nemoCompetitionSlug: null,
    currentSeason: '2026',
    sourceIds: {
      footballDataCode: 'WC',
      apiFootballId: 1,
    },
  },
  {
    id: 'comp-bsa',
    code: 'BSA',
    nameAr: 'الدوري البرازيلي الممتاز',
    nameEn: 'Brazilian Serie A',
    countryAr: 'البرازيل',
    countryEn: 'Brazil',
    region: 'americas',
    priority: 50,
    isEgyptianPriority: false,
    logoUrl: 'https://img.thesports.com/football/competition/70d2cd91d1fc5dc5a558cd00237d2b4e.png',
    nemoCompetitionSlug: 'brazilian-serie-a',
    currentSeason: '2026',
    sourceIds: {
      sportscoreSlug: 'brazilian-serie-a',
      thesportsdbId: '4351',
      footballDataCode: 'BSA',
      apiFootballId: 71,
    },
  },
  {
    id: 'comp-ccl',
    code: 'CCL',
    nameAr: 'دوري أبطال الكونكاكاف',
    nameEn: 'CONCACAF Champions Cup',
    countryAr: 'أمريكا الشمالية',
    countryEn: 'CONCACAF',
    region: 'americas',
    priority: 52,
    isEgyptianPriority: false,
    logoUrl: null,
    nemoCompetitionSlug: 'concacaf-league-champions-cup',
    currentSeason: '2026',
    sourceIds: {
      sportscoreSlug: 'concacaf-league-champions-cup',
    },
  },
  {
    id: 'comp-j1',
    code: 'J1',
    nameAr: 'الدوري الياباني الدرجة الأولى',
    nameEn: 'Japanese J1 League',
    countryAr: 'اليابان',
    countryEn: 'Japan',
    region: 'asia',
    priority: 54,
    isEgyptianPriority: false,
    logoUrl: null,
    nemoCompetitionSlug: 'japanese-j1-league',
    currentSeason: '2026',
    sourceIds: {
      sportscoreSlug: 'japanese-j1-league',
    },
  },
  {
    id: 'comp-usl',
    code: 'USL',
    nameAr: 'بطولة الدوري الأمريكي USL',
    nameEn: 'American USL Championship',
    countryAr: 'الولايات المتحدة',
    countryEn: 'United States',
    region: 'americas',
    priority: 58,
    isEgyptianPriority: false,
    logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/uh4zas1688513782.png',
    nemoCompetitionSlug: 'usl-championship',
    currentSeason: '2026',
    sourceIds: {
      sportscoreSlug: 'usl-championship',
      thesportsdbId: '4684',
    },
  },
];

/**
 * Egyptian Clubs & National Team Canonical Registry
 * Combines verified data from SportScore Egyptian Premier League Standings + TheSportsDB League 4829/5185
 */
export const EGYPTIAN_TEAMS_CATALOG: TeamRecord[] = [
  {
    id: 'team-al-ahly',
    nameAr: 'الأهلي',
    nameEn: 'Al Ahly FC',
    shortNameAr: 'الأهلي',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/x8753q1751421890.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد القاهرة الدولي',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Al%20Ahly%20FC`,
    externalIds: {
      sportscoreSlug: 'al-ahly-fc',
      thesportsdbId: '138995',
      apiFootballId: 1029,
    },
  },
  {
    id: 'team-zamalek',
    nameAr: 'الزمالك',
    nameEn: 'Zamalek SC',
    shortNameAr: 'الزمالك',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/tgekj81580930027.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد القاهرة الدولي',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Zamalek%20SC`,
    externalIds: {
      sportscoreSlug: 'zamalek-sc',
      thesportsdbId: '138997',
      apiFootballId: 1040,
    },
  },
  {
    id: 'team-pyramids',
    nameAr: 'بيراميدز',
    nameEn: 'Pyramids FC',
    shortNameAr: 'بيراميدز',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/8liy611607352549.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد الدفاع الجوي (30 يونيو)',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Pyramids%20FC`,
    externalIds: {
      sportscoreSlug: 'pyramids-fc',
      thesportsdbId: '139838',
      apiFootballId: 1036,
    },
  },
  {
    id: 'team-al-masry',
    nameAr: 'المصري البورسعيدي',
    nameEn: 'Al Masry',
    shortNameAr: 'المصري',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/3aw86h1589807260.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد السويس الجديد',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Al%20Masry`,
    externalIds: {
      sportscoreSlug: 'al-masry',
      thesportsdbId: '139844',
      apiFootballId: 1032,
    },
  },
  {
    id: 'team-zed',
    nameAr: 'زد إف سي',
    nameEn: 'ZED FC',
    shortNameAr: 'زد',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/dfpdle1729784943.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد القاهرة الدولي',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/ZED%20FC`,
    externalIds: {
      sportscoreSlug: 'zed-fc',
      thesportsdbId: '149505',
      apiFootballId: 10019,
    },
  },
  {
    id: 'team-ceramica',
    nameAr: 'سيراميكا كليوباترا',
    nameEn: 'Ceramica Cleopatra FC',
    shortNameAr: 'سيراميكا',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/xy4shs1751422167.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد هيئة قناة السويس',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Ceramica%20Cleopatra%20FC`,
    externalIds: {
      sportscoreSlug: 'ceramica-cleopatra-fc',
      thesportsdbId: '140795',
    },
  },
  {
    id: 'team-modern-sport',
    nameAr: 'مودرن سبورت',
    nameEn: 'Modern Sport FC',
    shortNameAr: 'مودرن سبورت',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/larnky1729784569.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد السلام',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Modern%20Sport%20FC`,
    externalIds: {
      sportscoreSlug: 'modern-sport-fc',
      thesportsdbId: '144160',
    },
  },
  {
    id: 'team-enppi',
    nameAr: 'إنبي',
    nameEn: 'Enppi',
    shortNameAr: 'إنبي',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/m6p9ml1787512639.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد بتروسبورت',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Enppi`,
    externalIds: {
      sportscoreSlug: 'enppi',
      thesportsdbId: '139841',
    },
  },
  {
    id: 'team-mokawloon',
    nameAr: 'المقاولون العرب',
    nameEn: 'El Mokawloon El Arab',
    shortNameAr: 'المقاولون',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/gi170k1589807275.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد عثمان أحمد عثمان',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/El%20Mokawloon%20El%20Arab`,
    externalIds: {
      sportscoreSlug: 'el-mokawloon-el-arab',
      thesportsdbId: '139837',
    },
  },
  {
    id: 'team-ittihad-alex',
    nameAr: 'الاتحاد السكندري',
    nameEn: 'Al Ittihad Alexandria',
    shortNameAr: 'الاتحاد السكندري',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/bqnmfm1786058466.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد الإسكندرية',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Al%20Ittihad%20Alexandria`,
    externalIds: {
      sportscoreSlug: 'al-ittihad-alexandria',
      thesportsdbId: '139839',
    },
  },
  {
    id: 'team-smouha',
    nameAr: 'سموحة',
    nameEn: 'Smouha SC',
    shortNameAr: 'سموحة',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/qq4pkd1589807413.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد برج العرب',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Smouha%20SC`,
    externalIds: {
      sportscoreSlug: 'smouha-sc',
      thesportsdbId: '139840',
    },
  },
  {
    id: 'team-nbe',
    nameAr: 'البنك الأهلي',
    nameEn: 'National Bank Egypt SC',
    shortNameAr: 'البنك الأهلي',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/p0j65z1614891546.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد القاهرة الدولي',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/National%20Bank%20Egypt%20SC`,
    externalIds: {
      sportscoreSlug: 'national-bank-egypt-sc',
      thesportsdbId: '140796',
    },
  },
  {
    id: 'team-talaea',
    nameAr: 'طلائع الجيش',
    nameEn: 'Talaea EI Gaish',
    shortNameAr: 'طلائع الجيش',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/a4scm31589807423.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد جهاز الرياضة العسكري',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Talaea%20EI%20Gaish`,
    externalIds: {
      sportscoreSlug: 'talaea-ei-gaish',
      thesportsdbId: '139848',
    },
  },
  {
    id: 'team-el-gouna',
    nameAr: 'الجونة',
    nameEn: 'El Gouna',
    shortNameAr: 'الجونة',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/6vdj631589807310.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد خالد بشارة',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/El%20Gouna`,
    externalIds: {
      sportscoreSlug: 'el-gouna',
      thesportsdbId: '139845',
    },
  },
  {
    id: 'team-ghazl-el-mahalla',
    nameAr: 'غزل المحلة',
    nameEn: 'Ghazl El Mahallah',
    shortNameAr: 'غزل المحلة',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/18f9091786058467.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد غزل المحلة',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Ghazl%20El%20Mahallah`,
    externalIds: {
      sportscoreSlug: 'ghazl-el-mahallah',
      thesportsdbId: '140844',
    },
  },
  {
    id: 'team-pharco',
    nameAr: 'فاركو',
    nameEn: 'Pharco FC',
    shortNameAr: 'فاركو',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/kmgfun1751422815.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد حرس الحدود',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Pharco%20FC`,
    externalIds: {
      sportscoreSlug: 'pharco-fc',
      thesportsdbId: '144159',
    },
  },
  {
    id: 'team-petrojet',
    nameAr: 'بتروجيت',
    nameEn: 'Petrojet',
    shortNameAr: 'بتروجيت',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/gy9ge11729783347.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد بتروسبورت',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Petrojet`,
    externalIds: {
      sportscoreSlug: 'petrojet',
      thesportsdbId: '139847',
    },
  },
  {
    id: 'team-wadi-degla',
    nameAr: 'وادي دجلة',
    nameEn: 'Wadi Degla SC',
    shortNameAr: 'وادي دجلة',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/2rchzz1589807440.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد السلام',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Wadi%20Degla%20SC`,
    externalIds: {
      sportscoreSlug: 'wadi-degla-sc',
      thesportsdbId: '139850',
    },
  },
  {
    id: 'team-el-qanah',
    nameAr: 'القناة',
    nameEn: 'Olympic El Qanal',
    shortNameAr: 'القناة',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/9amngv1786057661.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد هيئة قناة السويس',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Olympic%20El%20Qanal`,
    externalIds: {
      sportscoreSlug: 'olympic-el-qanal',
      thesportsdbId: '156494',
    },
  },
  {
    id: 'team-kahrabaa-ismailia',
    nameAr: 'كهرباء الإسماعيلية',
    nameEn: 'Kahrabaa Ismailia',
    shortNameAr: 'كهرباء الإسماعيلية',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/1g46qo1589807617.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد الإسماعيلية',
    nemoTeamUrl: `${NEMO_SPORTS_BASE_URL}/teams/Kahrabaa%20Ismailia`,
    externalIds: {
      sportscoreSlug: 'kahrabaa-ismailia',
    },
  },
  {
    id: 'team-asyut-petroleum',
    nameAr: 'بترول أسيوط',
    nameEn: 'Asyut Petroleum',
    shortNameAr: 'بترول أسيوط',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/kkohuv1786057778.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد بترول أسيوط',
    nemoTeamUrl: null,
    externalIds: {
      thesportsdbId: '156495',
    },
  },
  {
    id: 'team-abou-qir',
    nameAr: 'أبو قير للأسمدة',
    nameEn: 'Abou Qir Fertilizers',
    shortNameAr: 'أبو قير للأسمدة',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/i7rxde1786059556.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد الإسكندرية',
    nemoTeamUrl: null,
    externalIds: {
      thesportsdbId: '156496',
    },
  },
  {
    id: 'team-tersana',
    nameAr: 'الترسانة',
    nameEn: 'Tersana',
    shortNameAr: 'الترسانة',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/1v13r01679424667.png',
    isEgyptian: true,
    isNationalTeam: false,
    stadium: 'استاد حسن الشاذلي',
    nemoTeamUrl: null,
    externalIds: {
      thesportsdbId: '147084',
    },
  },
  {
    id: 'team-egypt-nt',
    nameAr: 'منتخب مصر',
    nameEn: 'Egypt',
    shortNameAr: 'مصر',
    countryAr: 'مصر',
    countryEn: 'Egypt',
    logoUrl: 'https://r2.thesportsdb.com/images/media/team/badge/rxryvy1467462651.png',
    isEgyptian: true,
    isNationalTeam: true,
    stadium: 'استاد القاهرة الدولي',
    nemoTeamUrl: null,
    externalIds: {},
  },
];

/**
 * Arabic translation lookup for well-known teams & competitions across sources
 */
const TEAM_ARABIC_NAMES: Record<string, string> = {
  'al ahly': 'الأهلي',
  'al ahly fc': 'الأهلي',
  'zamalek': 'الزمالك',
  'zamalek sc': 'الزمالك',
  'pyramids': 'بيراميدز',
  'pyramids fc': 'بيراميدز',
  'al masry': 'المصري البورسعيدي',
  'zed': 'زد إف سي',
  'zed fc': 'زد إف سي',
  'ceramica cleopatra': 'سيراميكا كليوباترا',
  'ceramica cleopatra fc': 'سيراميكا كليوباترا',
  'modern sport': 'مودرن سبورت',
  'modern sport fc': 'مودرن سبورت',
  'enppi': 'إنبي',
  'al-mokawloon al-arab': 'المقاولون العرب',
  'el mokawloon el arab': 'المقاولون العرب',
  'al ittihad alexandria': 'الاتحاد السكندري',
  'smouha': 'سموحة',
  'smouha sc': 'سموحة',
  'national bank of egypt': 'البنك الأهلي',
  'national bank egypt sc': 'البنك الأهلي',
  "tala'ea el gaish": 'طلائع الجيش',
  'talaea ei gaish': 'طلائع الجيش',
  'el gouna': 'الجونة',
  'ghazl el mahalla': 'غزل المحلة',
  'ghazl el mahallah': 'غزل المحلة',
  'pharco': 'فاركو',
  'pharco fc': 'فاركو',
  'petrojet': 'بتروجيت',
  'wadi degla': 'وادي دجلة',
  'wadi degla sc': 'وادي دجلة',
  'el qanah': 'القناة',
  'olympic el qanal': 'القناة',
  'kahrabaa ismailia': 'كهرباء الإسماعيلية',
  'asyut petroleum': 'بترول أسيوط',
  'abou qir fertilizers': 'أبو قير للأسمدة',
  'tersana': 'الترسانة',
  'egypt': 'منتخب مصر',
  // CAF & Arab clubs
  'simba': 'سيمبا التنزاني',
  'azam': 'عزام التنزاني',
  'kitara': 'كيتارا الأوغندي',
  'singida black stars': 'سينجيدا بلاك ستارز',
  'al-ahli tripoli': 'الأهلي طرابلس',
  'es zarzis': 'الترجي الجرجيسي',
  'al-hilal': 'الهلال السعودي',
  'al-hilal saudi fc': 'الهلال السعودي',
  'al-nassr': 'النصر السعودي',
  'al-nassr fc': 'النصر السعودي',
  'al-ittihad': 'الاتحاد السعودي',
  'al-ittihad club': 'الاتحاد السعودي',
  'al-ahli': 'الأهلي السعودي',
  'al-ahli saudi fc': 'الأهلي السعودي',
  'al-qadsiah': 'القادسية السعودي',
  'al-ettifaq': 'الاتفاق السعودي',
  'al-shabab': 'الشباب السعودي',
  'al-taawoun': 'التعاون السعودي',
  'al-fateh': 'الفتح السعودي',
  'al-khaleej': 'الخليج السعودي',
  'al-kholood': 'الخلود السعودي',
  'al-faisaly': 'الفيصلي السعودي',
  'al-diriyah': 'الدرعية السعودي',
  'al-hazem': 'الحزم السعودي',
  // European & Global clubs
  'real madrid': 'ريال مدريد',
  'barcelona': 'برشلونة',
  'fc barcelona': 'برشلونة',
  'atletico madrid': 'أتلتيكو مدريد',
  'atlético madrid': 'أتلتيكو مدريد',
  'real betis': 'ريال بيتيس',
  'valencia': 'فالنسيا',
  'valencia cf': 'فالنسيا',
  'athletic bilbao': 'أتلتيك بلباو',
  'athletic club': 'أتلتيك بلباو',
  'villarreal': 'فياريال',
  'villarreal cf': 'فياريال',
  'elche': 'إلتشي',
  'espanyol': 'إسبانيول',
  'deportivo de a coruña': 'ديبورتيفو لاكورونيا',
  'levante': 'ليفانتي',
  'liverpool': 'ليفربول',
  'manchester city': 'مانشستر سيتي',
  'arsenal': 'أرسنال',
  'chelsea': 'تشيلسي',
  'manchester united': 'مانشستر يونايتد',
  'tottenham hotspur': 'توتنهام هوتسبير',
  'aston villa': 'أستون فيلا',
  'everton': 'إيفرتون',
  'newcastle united': 'نيوكاسل يونايتد',
  'paris saint-germain': 'باريس سان جيرمان',
  'fc bayern munich': 'بايرن ميونخ',
  'borussia dortmund': 'بوروسيا دورتموند',
  'bayer 04 leverkusen': 'باير ليفركوزن',
  'inter milan': 'إنتر ميلان',
  'ac milan': 'إي سي ميلان',
  'juventus': 'يوفنتوس',
  'as roma': 'روما',
  'napoli': 'نابولي',
  'sao paulo': 'ساو باولو',
  'vitoria ba': 'فيتوريا باهيا',
  'vitória': 'فيتوريا باهيا',
  'flamengo': 'فلامنجو',
  'santos': 'سانتوس',
  'gremio': 'جريميو',
  'grêmio': 'جريميو',
  'corinthians paulista': 'كورينثيانز',
  'corinthians': 'كورينثيانز',
  'palmeiras': 'بالميراس',
  'fluminense rj': 'فلومينينسي',
  'fluminense': 'فلومينينسي',
  'botafogo rj': 'بوتافوغو',
  'botafogo': 'بوتافوغو',
  'vasco da gama': 'فاسكو دا غاما',
  'mirassol': 'ميراسول',
  'internacional': 'إنترناسيونال',
  'juventude': 'جوفينتود',
  'red bull bragantino': 'ريد بول براغانتينو',
  'bragantino': 'ريد بول براغانتينو',
  'granada cf': 'غرناطة',
  'granada': 'غرناطة',
  'cd castellon': 'كاستيلون',
  'castellón': 'كاستيلون',
  'ca huracan': 'أوراكان',
  'huracán': 'أوراكان',
  'river plate': 'ريفر بليت',
  'colorado rapids': 'كولورادو رابيدز',
  'austin fc': 'أوستن إف سي',
  'seattle sounders': 'سياتل ساوندرز',
  'real salt lake': 'ريال سالت ليك',
  'puebla': 'بويبلا',
  'club leon': 'كلوب ليون',
  'león': 'كلوب ليون',
  'independiente santa fe': 'إنديبندينتي سانتا في',
  'alianza atletico': 'أليانزا أتلتيكو',
  'alianza atlético': 'أليانزا أتلتيكو',
  'universidad de chile': 'أونيفرسيداد دي تشيلي',
  'deportes limache': 'ديبورتيس ليماتشي',
  'san antonio fc': 'سان أنطونيو',
  'san antonio': 'سان أنطونيو',
  'orange county sc': 'أورانج كاونتي',
  'sacramento republic': 'ساكرامنتو ريبابليك',
  'lexington sc': 'ليكسينغتون',
  'deportes recoleta': 'ديبورتيس ريكوليتا',
  'curicó unido': 'كوريكو أونيدو',
  'curico unido': 'كوريكو أونيدو',
};

/**
 * Verified high-resolution transparent PNG club badges from TheSportsDB CDN (r2.thesportsdb.com)
 */
const VERIFIED_GLOBAL_TEAM_BADGES: Record<string, string> = {
  'sao paulo': 'https://r2.thesportsdb.com/images/media/team/badge/sxpupx1473538135.png',
  'são paulo': 'https://r2.thesportsdb.com/images/media/team/badge/sxpupx1473538135.png',
  'vitoria ba': 'https://r2.thesportsdb.com/images/media/team/badge/tysrrx1473538156.png',
  'vitória': 'https://r2.thesportsdb.com/images/media/team/badge/tysrrx1473538156.png',
  'flamengo': 'https://r2.thesportsdb.com/images/media/team/badge/syptwx1473538074.png',
  'santos': 'https://r2.thesportsdb.com/images/media/team/badge/j8xk9g1679447486.png',
  'gremio': 'https://r2.thesportsdb.com/images/media/team/badge/uvpwyt1473538089.png',
  'grêmio': 'https://r2.thesportsdb.com/images/media/team/badge/uvpwyt1473538089.png',
  'corinthians paulista': 'https://r2.thesportsdb.com/images/media/team/badge/vvuvps1473538042.png',
  'corinthians': 'https://r2.thesportsdb.com/images/media/team/badge/vvuvps1473538042.png',
  'palmeiras': 'https://r2.thesportsdb.com/images/media/team/badge/vsqwqp1473538105.png',
  'juventude': 'https://r2.thesportsdb.com/images/media/team/badge/1ntter1766506778.png',
  'fluminense rj': 'https://r2.thesportsdb.com/images/media/team/badge/stvvwp1473538082.png',
  'fluminense': 'https://r2.thesportsdb.com/images/media/team/badge/stvvwp1473538082.png',
  'vasco da gama': 'https://r2.thesportsdb.com/images/media/team/badge/ynqlxo1630521109.png',
  'botafogo rj': 'https://r2.thesportsdb.com/images/media/team/badge/bs5mbw1733004596.png',
  'botafogo': 'https://r2.thesportsdb.com/images/media/team/badge/bs5mbw1733004596.png',
  'red bull bragantino': 'https://r2.thesportsdb.com/images/media/team/badge/2p7tl41701423595.png',
  'bragantino': 'https://r2.thesportsdb.com/images/media/team/badge/2p7tl41701423595.png',
  'granada cf': 'https://r2.thesportsdb.com/images/media/team/badge/f9iss11677472689.png',
  'granada': 'https://r2.thesportsdb.com/images/media/team/badge/f9iss11677472689.png',
  'cd castellon': 'https://r2.thesportsdb.com/images/media/team/badge/ywibjw1733456820.png',
  'castellón': 'https://r2.thesportsdb.com/images/media/team/badge/ywibjw1733456820.png',
  'ca huracan': 'https://r2.thesportsdb.com/images/media/team/badge/kppi2b1775776550.png',
  'huracán': 'https://r2.thesportsdb.com/images/media/team/badge/kppi2b1775776550.png',
  'river plate': 'https://r2.thesportsdb.com/images/media/team/badge/03dmi31645539717.png',
  'colorado rapids': 'https://r2.thesportsdb.com/images/media/team/badge/uppupv1473536412.png',
  'austin fc': 'https://r2.thesportsdb.com/images/media/team/badge/a3dlg61595434277.png',
  'seattle sounders': 'https://r2.thesportsdb.com/images/media/team/badge/2dy5cx1706711036.png',
  'real salt lake': 'https://r2.thesportsdb.com/images/media/team/badge/kkjlfa1556488022.png',
  'puebla': 'https://r2.thesportsdb.com/images/media/team/badge/h0jgg51593451845.png',
  'club leon': 'https://r2.thesportsdb.com/images/media/team/badge/pc9gro1752393439.png',
  'león': 'https://r2.thesportsdb.com/images/media/team/badge/pc9gro1752393439.png',
  'independiente santa fe': 'https://r2.thesportsdb.com/images/media/team/badge/16vs771629122765.png',
  'alianza atletico': 'https://r2.thesportsdb.com/images/media/team/badge/wu4g171615130421.png',
  'alianza atlético': 'https://r2.thesportsdb.com/images/media/team/badge/wu4g171615130421.png',
  'universidad de chile': 'https://r2.thesportsdb.com/images/media/team/badge/po0o3c1578347873.png',
  'deportes limache': 'https://r2.thesportsdb.com/images/media/team/badge/1bd0ws1706521384.png',
};

/**
 * Resolves a verified working team logo URL, preferring official r2.thesportsdb.com badges
 * over hotlink-blocked img.thesports.com URLs.
 */
export function resolveVerifiedTeamLogo(nameEn: string, candidateLogoUrl?: string | null): string | null {
  const eq = resolveEgyptianTeam(nameEn);
  if (eq?.logoUrl) return eq.logoUrl;
  const norm = nameEn.trim().toLowerCase();
  if (VERIFIED_GLOBAL_TEAM_BADGES[norm]) {
    return VERIFIED_GLOBAL_TEAM_BADGES[norm];
  }
  if (candidateLogoUrl && candidateLogoUrl.includes('r2.thesportsdb.com')) {
    return candidateLogoUrl;
  }
  return candidateLogoUrl || null;
}

export function resolveEgyptianTeam(nameOrId: string): TeamRecord | null {
  const norm = nameOrId.trim().toLowerCase();
  for (const team of EGYPTIAN_TEAMS_CATALOG) {
    if (
      team.id.toLowerCase() === norm ||
      team.nameEn.toLowerCase() === norm ||
      team.nameAr === nameOrId.trim() ||
      team.externalIds.sportscoreSlug?.toLowerCase() === norm ||
      team.externalIds.thesportsdbId === norm
    ) {
      return team;
    }
  }
  // Fuzzy alias match for known Egyptian club name variants
  if (norm === 'al ahly' || norm === 'al-ahly cairo') return EGYPTIAN_TEAMS_CATALOG[0];
  if (norm === 'zamalek') return EGYPTIAN_TEAMS_CATALOG[1];
  if (norm === 'pyramids') return EGYPTIAN_TEAMS_CATALOG[2];
  if (norm === 'zed') return EGYPTIAN_TEAMS_CATALOG[4];
  if (norm === 'ceramica cleopatra') return EGYPTIAN_TEAMS_CATALOG[5];
  if (norm === 'modern sport') return EGYPTIAN_TEAMS_CATALOG[6];
  if (norm === 'al-mokawloon al-arab' || norm === 'arab contractors') return EGYPTIAN_TEAMS_CATALOG[8];
  if (norm === 'smouha') return EGYPTIAN_TEAMS_CATALOG[10];
  if (norm === 'national bank of egypt') return EGYPTIAN_TEAMS_CATALOG[11];
  if (norm === "tala'ea el gaish" || norm === 'talaea el gaish') return EGYPTIAN_TEAMS_CATALOG[12];
  if (norm === 'ghazl el mahalla') return EGYPTIAN_TEAMS_CATALOG[14];
  if (norm === 'pharco') return EGYPTIAN_TEAMS_CATALOG[15];
  if (norm === 'wadi degla') return EGYPTIAN_TEAMS_CATALOG[17];
  if (norm === 'el qanah') return EGYPTIAN_TEAMS_CATALOG[18];
  return null;
}

export function translateTeamNameAr(nameEn: string): string {
  const eq = resolveEgyptianTeam(nameEn);
  if (eq) return eq.nameAr;
  const norm = nameEn.trim().toLowerCase();
  return TEAM_ARABIC_NAMES[norm] || nameEn;
}

/**
 * اسم فريق بديل صريح عندما يرسل المصدر قيمة تقنية لا تمثّل ناديًا.
 * لا نخترع اسمًا: نُعلن أن المصدر لم يُعلن الاسم.
 */
export const UNKNOWN_TEAM_NAME_AR = 'فريق غير معروف (لم يُعلن الاسم من المصدر)';

/**
 * هل هذه القيمة اسم فريق حقيقي أم معرّف تقني أرسله المصدر في خانة الاسم؟
 *
 * المثال المُثبت من الإنتاج: `Team dj2ryoh2w90q1zp` ظهر كاسم فريق على صفحة الجدول في
 * مباراة «Myanmar Universitet ضد Team dj2ryoh2w90q1zp». لا يُعرض مثل هذا النص كاسم نادٍ.
 * الشرط صارم عن قصد: كلمة `team` متبوعة بمعرّف يحتوي أرقامًا وطوله 8+، أو قيمة نائبة
 * صريحة (TBD / N-A / unknown)، أو تطابق الاسم مع معرّف الفريق نفسه — ولا يُصنَّف أي اسم
 * نادٍ حقيقي (مثل «Sportvereniging Notch») كقيمة تقنية.
 */
export function isPlaceholderTeamName(value: string | null | undefined, teamId?: string | null): boolean {
  const raw = (value || '').trim();
  if (!raw) return true;
  const normalized = raw.toLowerCase();
  if (teamId && normalized === teamId.trim().toLowerCase()) return true;
  if (/^(tbd|tba|n\/?a|unknown|undefined|null|none|—+|-+)$/.test(normalized)) return true;
  if (/^team[\s_-]+(?=[a-z0-9_]*\d)[a-z0-9_]{8,}$/.test(normalized)) return true;
  if (/^(home|away)[\s_-]+team[\s_-]?\d*$/.test(normalized)) return true;
  return false;
}

export type TeamNameStatus = 'verified' | 'translated' | 'source' | 'placeholder';

/**
 * اسم الفريق للعرض + حالة الاسم معًا (لا فصلهما في أي مسار كتابة):
 *  ① كتالوج الأندية الموثّق (عربي/إنجليزي) → `verified`.
 *  ② قاموس ترجمات معتمد → `translated`.
 *  ③ بلا ترجمة موثّقة → اسم المصدر نفسه بلا تغيير → `source`.
 *  ④ قيمة تقنية → عبارة واضحة → `placeholder` (وتُسجَّل للمراجعة في الفحص).
 */
export function resolveTeamNameFromSource(
  sourceName: string,
  teamId?: string | null
): { nameAr: string; nameStatus: TeamNameStatus } {
  if (isPlaceholderTeamName(sourceName, teamId)) {
    return { nameAr: UNKNOWN_TEAM_NAME_AR, nameStatus: 'placeholder' };
  }
  const eq = resolveEgyptianTeam(sourceName);
  if (eq) return { nameAr: eq.nameAr, nameStatus: 'verified' };
  const mapped = TEAM_ARABIC_NAMES[sourceName.trim().toLowerCase()];
  if (mapped) return { nameAr: mapped, nameStatus: 'translated' };
  return { nameAr: sourceName, nameStatus: 'source' };
}

export interface TeamDisplayIdentity {
  /** الاسم المعروض فعلًا للزائر. */
  displayName: string;
  /** هل الاسم المعروض بالعربية؟ (يُستخدم لضبط اتجاه النص RTL/LTR في البطاقة). */
  isArabicName: boolean;
  /** هل المصدر أرسل قيمة تقنية بدل اسم نادٍ؟ */
  isPlaceholder: boolean;
  /** الاسم الأجنبي المرجعي (يُعرض كسطر ثانوي عندما يختلف عن العربي المعروض). */
  secondaryName: string | null;
}

/**
 * هوية العرض لاسم فريق من سجل مخزَّن (بما فيه سجلات قديمة تحمل قيمة تقنية):
 * تُصلح العرض **دون** تغيير معرّفات الفرق ولا روابطها ولا أي بيانات في المخزن.
 */
export function resolveTeamDisplayIdentity(team: {
  id?: string;
  nameAr?: string | null;
  nameEn?: string | null;
}): TeamDisplayIdentity {
  const nameAr = (team.nameAr || '').trim();
  const nameEn = (team.nameEn || '').trim();
  const placeholder = isPlaceholderTeamName(nameEn || nameAr, team.id) || isPlaceholderTeamName(nameAr, team.id);
  if (placeholder) {
    return { displayName: UNKNOWN_TEAM_NAME_AR, isArabicName: true, isPlaceholder: true, secondaryName: null };
  }
  const displayName = nameAr || nameEn || UNKNOWN_TEAM_NAME_AR;
  const isArabicName = /[\u0600-\u06FF]/.test(displayName);
  /**
   * الاسم المرجعي: اسم المصدر اللاتيني حين يختلف عن المعروض. لا يُعرض دائمًا — المكوّن يُظهره
   * فقط في البطاقة التي تختلط فيها اللغتان (فريق عربي مقابل فريق لاتيني)، فلا تتضخّم البطاقات
   * العربية الموثّقة بسطر ثانٍ بلا داعٍ.
   */
  const referenceName = nameEn && !/[\u0600-\u06FF]/.test(nameEn) ? nameEn : '';
  const secondaryName =
    referenceName && referenceName.toLowerCase() !== displayName.toLowerCase() ? referenceName : null;
  return { displayName, isArabicName, isPlaceholder: false, secondaryName };
}

export function resolveCompetitionByMeta(params: {
  nameEn?: string;
  sportscoreSlug?: string;
  thesportsdbId?: string;
  footballDataCode?: string;
  apiFootballId?: number;
  countryEn?: string;
}): CompetitionRecord {
  const { nameEn, sportscoreSlug, thesportsdbId, footballDataCode, apiFootballId, countryEn } = params;
  for (const comp of CANONICAL_COMPETITIONS) {
    if (sportscoreSlug && comp.sourceIds.sportscoreSlug === sportscoreSlug) return comp;
    if (thesportsdbId && comp.sourceIds.thesportsdbId === thesportsdbId) return comp;
    if (footballDataCode && comp.sourceIds.footballDataCode === footballDataCode) return comp;
    if (apiFootballId && comp.sourceIds.apiFootballId === apiFootballId) return comp;
  }

  const normName = (nameEn || '').trim().toLowerCase();
  for (const comp of CANONICAL_COMPETITIONS) {
    if (comp.nameEn.toLowerCase() === normName) return comp;
  }

  if (normName.includes('egyptian premier')) return CANONICAL_COMPETITIONS[0];
  if (normName.includes('egypt cup')) return CANONICAL_COMPETITIONS[1];
  if (normName.includes('egypt league cup')) return CANONICAL_COMPETITIONS[2];
  if (normName.includes('caf champions')) return CANONICAL_COMPETITIONS[3];
  if (normName.includes('caf confederation')) return CANONICAL_COMPETITIONS[4];
  if (normName.includes('saudi') && normName.includes('pro')) return CANONICAL_COMPETITIONS[7];
  if (normName === 'uefa champions league') return CANONICAL_COMPETITIONS[8];
  if (normName.includes('english premier') || normName === 'premier league') return CANONICAL_COMPETITIONS[10];
  if (normName.includes('spanish la liga') || normName === 'primera division') return CANONICAL_COMPETITIONS[11];
  if (normName.includes('italian serie a')) return CANONICAL_COMPETITIONS[12];
  if (normName === 'bundesliga') return CANONICAL_COMPETITIONS[13];
  if (normName.includes('brazilian serie a') || normName === 'campeonato brasileiro série a') return CANONICAL_COMPETITIONS[16];
  if (normName.includes('usl championship')) return CANONICAL_COMPETITIONS[19];
  // SportScore names for two canonical African competitions (verified in its search endpoint).
  if (normName === 'caf africa cup of nations') {
    return CANONICAL_COMPETITIONS.find((comp) => comp.id === 'comp-afcon') ?? CANONICAL_COMPETITIONS[5];
  }
  if (normName === 'fifa world cup qualification (caf)') {
    return CANONICAL_COMPETITIONS.find((comp) => comp.id === 'comp-wcq-caf') ?? CANONICAL_COMPETITIONS[6];
  }

  // Dynamic fallback competition record for global competitions from SportScore / TheSportsDB
  const slug = (sportscoreSlug || (thesportsdbId ? `tsdb-${thesportsdbId}` : footballDataCode ? `fd-${footballDataCode}` : apiFootballId ? `apif-${apiFootballId}` : '') || normName.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'global');
  const translatedComp = translateGlobalCompetitionAr(nameEn || 'بطولة عالمية', countryEn);
  return {
    id: `comp-${slug}`,
    code: slug.toUpperCase(),
    nameAr: translatedComp.nameAr,
    nameEn: nameEn || 'Global Competition',
    countryAr: translatedComp.countryAr,
    countryEn: countryEn || 'Global',
    region: translatedComp.region,
    priority: translatedComp.priority,
    isEgyptianPriority: translatedComp.region === 'egypt',
    logoUrl: null,
    nemoCompetitionSlug: null,
    currentSeason: '',
    sourceIds: {
      sportscoreSlug,
      thesportsdbId,
      footballDataCode,
      apiFootballId,
    },
  };
}

/**
 * أسماء عربية لبطولات تصل من المصادر بأسمائها الإنجليزية **كما وردت حرفيًا** (مطابقة تامة بعد
 * تحويل الأحرف الصغيرة — فلا تلتقط نسخ الناشئين أو السيدات بالخطأ). كل اسم هنا موجود فعلًا في
 * SportScore (`/api/v1/search/`، تحقق 2026-10-15).
 *
 * الهدف: أولوية الكرة المصرية ثم العربية في ترتيب الجدول. كانت هذه البطولات تسقط إلى الأولوية
 * الافتراضية 75 وباسم إنجليزي و«دولي» كدولة — فمباريات دوري الدرجة الثانية المصري مثلًا كانت
 * تظهر في آخر الجدول بعد دوريات الهواة في آسيا وأمريكا الجنوبية.
 */
const GLOBAL_COMPETITION_EXACT_AR: Record<
  string,
  { nameAr: string; countryAr: string; region: CompetitionRegion; priority: number }
> = {
  'egyptian division 2': { nameAr: 'الدوري المصري — الدرجة الثانية', countryAr: 'مصر', region: 'egypt', priority: 15 },
  'egyptian super cup': { nameAr: 'كأس السوبر المصري', countryAr: 'مصر', region: 'egypt', priority: 13 },
  'caf super cup': { nameAr: 'كأس السوبر الأفريقي', countryAr: 'أفريقيا', region: 'africa', priority: 19 },
  'fifa  arab cup': { nameAr: 'كأس العرب', countryAr: 'دولي', region: 'arab', priority: 21 },
  'fifa arab cup': { nameAr: 'كأس العرب', countryAr: 'دولي', region: 'arab', priority: 21 },
  'arab club champions cup': { nameAr: 'البطولة العربية للأندية', countryAr: 'دولي', region: 'arab', priority: 21 },
  'saudi arabia division 1': { nameAr: 'الدوري السعودي — الدرجة الأولى', countryAr: 'السعودية', region: 'arab', priority: 26 },
  'united arab emirates adnoc pro-league': { nameAr: 'دوري أدنوك للمحترفين الإماراتي', countryAr: 'الإمارات', region: 'arab', priority: 26 },
  'qatar stars league': { nameAr: 'دوري نجوم قطر', countryAr: 'قطر', region: 'arab', priority: 27 },
  'iraq stars league': { nameAr: 'دوري نجوم العراق', countryAr: 'العراق', region: 'arab', priority: 28 },
  'algerian ligue professionnelle 1': { nameAr: 'الدوري الجزائري المحترف الأول', countryAr: 'الجزائر', region: 'arab', priority: 28 },
  'the botola pro': { nameAr: 'البطولة المغربية الاحترافية', countryAr: 'المغرب', region: 'arab', priority: 28 },
  'jordan premier league': { nameAr: 'الدوري الأردني للمحترفين', countryAr: 'الأردن', region: 'arab', priority: 29 },
  'kuwaiti premier league': { nameAr: 'الدوري الكويتي الممتاز', countryAr: 'الكويت', region: 'arab', priority: 29 },
  'oman professional league': { nameAr: 'دوري المحترفين العُماني', countryAr: 'عُمان', region: 'arab', priority: 29 },
  'bahrain premier league': { nameAr: 'الدوري البحريني الممتاز', countryAr: 'البحرين', region: 'arab', priority: 29 },
  'libyan premier league': { nameAr: 'الدوري الليبي الممتاز', countryAr: 'ليبيا', region: 'arab', priority: 29 },
  'sudanese premier league': { nameAr: 'الدوري السوداني الممتاز', countryAr: 'السودان', region: 'arab', priority: 29 },
  'lebanese premier league': { nameAr: 'الدوري اللبناني الممتاز', countryAr: 'لبنان', region: 'arab', priority: 29 },
  'syrian premier league': { nameAr: 'الدوري السوري الممتاز', countryAr: 'سوريا', region: 'arab', priority: 29 },
  'afc champions league elite': { nameAr: 'دوري أبطال آسيا للنخبة', countryAr: 'آسيا', region: 'asia', priority: 31 },
  'afc champions league two': { nameAr: 'دوري أبطال آسيا 2', countryAr: 'آسيا', region: 'asia', priority: 33 },
  'fifa world cup qualification (afc)': { nameAr: 'تصفيات كأس العالم — آسيا', countryAr: 'آسيا', region: 'asia', priority: 23 },
  'uefa europa conference league': { nameAr: 'دوري المؤتمر الأوروبي', countryAr: 'أوروبا', region: 'europe', priority: 33 },
  'fifa world cup qualification (uefa)': { nameAr: 'تصفيات كأس العالم — أوروبا', countryAr: 'أوروبا', region: 'europe', priority: 34 },
  'uefa nations league': { nameAr: 'دوري الأمم الأوروبية', countryAr: 'أوروبا', region: 'europe', priority: 34 },
  'international friendly': { nameAr: 'مباريات ودية دولية', countryAr: 'دولي', region: 'world', priority: 42 },
  'netherlands eredivisie': { nameAr: 'الدوري الهولندي الممتاز', countryAr: 'هولندا', region: 'europe', priority: 41 },
  'conmebol copa libertadores': { nameAr: 'كأس ليبرتادوريس', countryAr: 'أمريكا الجنوبية', region: 'americas', priority: 53 },
};

/**
 * الاسم العربي للبطولات العالمية التي لا يوجد لها سجل في الكتالوج الرسمي.
 *
 * تعمل هذه الدالة على **أسماء المصادر كما وردت فعلًا**، لا على أسماء مثالية: فاسم البطولة
 * الواحدة يصل من SportScore باسم «United States Major League Soccer» ومن TheSportsDB باسم
 * «American Major League Soccer». كانت الحالة الأولى فقط تُترجم، فظهر نفس الدوري باسمين
 * مختلفين (أحدهما إنجليزي) وبهويتين مختلفتين في التصفية والدمج.
 */
export function translateGlobalCompetitionAr(
  nameEn: string,
  countryEn?: string
): { nameAr: string; countryAr: string; region: CompetitionRegion; priority: number } {
  const n = nameEn.toLowerCase();
  const exact = GLOBAL_COMPETITION_EXACT_AR[n.trim()];
  if (exact) return { ...exact };
  if (
    n.includes('united states mls') ||
    n === 'mls' ||
    n.includes('major league soccer') ||
    n.includes('american major league') ||
    n.includes('united states major league')
  ) {
    return { nameAr: 'الدوري الأمريكي للمحترفين', countryAr: 'الولايات المتحدة', region: 'americas', priority: 55 };
  }
  if (n.includes('liga mx') || n.includes('mexico liga mx')) {
    return { nameAr: 'الدوري المكسيكي الممتاز', countryAr: 'المكسيك', region: 'americas', priority: 56 };
  }
  if (n.includes('argentina') || n.includes('primera nacional')) {
    return { nameAr: 'الدوري الأرجنتيني الممتاز', countryAr: 'الأرجنتين', region: 'americas', priority: 57 };
  }
  if (n.includes('colombia primera a')) {
    return { nameAr: 'الدوري الكولومبي الممتاز', countryAr: 'كولومبيا', region: 'americas', priority: 60 };
  }
  if (n.includes('chilean primera b')) {
    return { nameAr: 'الدوري التشيلي الدرجة الثانية', countryAr: 'تشيلي', region: 'americas', priority: 62 };
  }
  if (n.includes('chile primera')) {
    return { nameAr: 'الدوري التشيلي الممتاز', countryAr: 'تشيلي', region: 'americas', priority: 61 };
  }
  if (n.includes('uruguay primera')) {
    return { nameAr: 'الدوري الأوروغواياني الممتاز', countryAr: 'أوروغواي', region: 'americas', priority: 62 };
  }
  if (n.includes('ecuador')) {
    return { nameAr: 'الدوري الإكوادوري الممتاز', countryAr: 'الإكوادور', region: 'americas', priority: 63 };
  }
  if (n.includes('paraguay')) {
    return { nameAr: 'الدوري الباراغواياني الممتاز', countryAr: 'باراغواي', region: 'americas', priority: 64 };
  }
  if (n.includes('peru')) {
    return { nameAr: 'الدوري البيروفي الممتاز', countryAr: 'بيرو', region: 'americas', priority: 65 };
  }
  if (n.includes('brazilian serie b')) {
    return { nameAr: 'الدوري البرازيلي الدرجة الثانية', countryAr: 'البرازيل', region: 'americas', priority: 66 };
  }
  if (n.includes('spanish segunda')) {
    return { nameAr: 'الدوري الإسباني الدرجة الثانية', countryAr: 'إسبانيا', region: 'europe', priority: 45 };
  }
  if (n.includes('irish premier')) {
    return { nameAr: 'الدوري الأيرلندي الممتاز', countryAr: 'أيرلندا', region: 'europe', priority: 48 };
  }
  if (n.includes('mls next pro')) {
    return { nameAr: 'دوري الرديف الأمريكي', countryAr: 'الولايات المتحدة', region: 'americas', priority: 68 };
  }
  if (n.includes('usl league one')) {
    return { nameAr: 'دوري الدرجة الأولى الأمريكي', countryAr: 'الولايات المتحدة', region: 'americas', priority: 69 };
  }
  return {
    nameAr: nameEn,
    countryAr: countryEn === 'Egypt' ? 'مصر' : countryEn || 'دولي',
    region: 'world',
    priority: 75,
  };
}

/**
 * Returns the standard broadcaster channel label for the competition strip (Koora Live style).
 */
export function getCompetitionChannelAr(competitionCode: string, region: CompetitionRegion): string {
  if (competitionCode === 'EGY' || competitionCode === 'EGY_CUP' || competitionCode === 'EGY_LC' || region === 'egypt') {
    return 'أون تايم سبورتس';
  }
  if (competitionCode === 'SPL') {
    return 'قنوات SSC الرياضية';
  }
  if (
    competitionCode === 'CAF' ||
    competitionCode === 'CAFC' ||
    competitionCode === 'AC' ||
    competitionCode === 'QCAF' ||
    competitionCode === 'CL' ||
    competitionCode === 'UEL' ||
    competitionCode === 'PL' ||
    competitionCode === 'PD' ||
    competitionCode === 'FL1' ||
    competitionCode === 'WC'
  ) {
    return 'بي إن سبورتس';
  }
  if (competitionCode === 'SA') {
    return 'StarzPlay';
  }
  return 'NEMO Sports';
}

/** Accurate provenance for a fixture; broadcast rights are not inferred from competition alone. */
export function getMatchSourceLabelAr(sourceId: SourceId): string {
  switch (sourceId) {
    case 'sportscore':
      return 'SportScore';
    case 'thesportsdb':
      return 'TheSportsDB';
    case 'api-football':
      return 'API-Football';
    case 'football-data':
      return 'Football-Data.org';
    case 'google-news-rss':
      return 'Google News RSS';
    case 'publisher-rss':
      return 'خلاصات الناشرين المباشرة';
    default:
      return 'غير متاح';
  }
}

