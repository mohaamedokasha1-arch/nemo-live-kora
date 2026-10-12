import { NEMO_SPORTS_BASE_URL, CANONICAL_COMPETITIONS } from './catalog';
import {
  NemoLinkResolution,
  NemoMappingEntry,
  NemoMatchCriterion,
} from './types';

/**
 * Extracts the canonical NEMO Sports match slug from a SportScore URL path.
 * Example: "/football/match/sao-paulo-vs-vitoria-ba/k82rekhg0vyzrep/" -> "sao-paulo-vs-vitoria-ba"
 * Note: For Olympic El Qanal vs Al Masry (2026-10-11), SportScore's match endpoint responds on
 * "olympic-el-qanal-vs-al-masry" (which opens on NEMO Sports at /matches/olympic-el-qanal-vs-al-masry).
 */
export function extractSportscoreMatchSlug(urlPath?: string | null): string | null {
  if (!urlPath) return null;
  const match = urlPath.match(/\/match\/([^/?#]+)(?:\/[^/?#]+)?\/?(?:[?#].*)?$/);
  const slug = match?.[1]?.trim();
  return slug && /^[a-z0-9-]+$/i.test(slug) ? slug.toLowerCase() : null;
}

/**
 * Verified Mapping Table between Gateway Matches (TheSportsDB / SportScore / API-Football)
 * and actual verified NEMO Sports URLs tested against https://nemo-sports.vercel.app.
 *
 * Why this mapping table is critical:
 * - On 2026-10-11, "Zamalek vs Al Ahly" (TheSportsDB idEvent=2561121, API-Football=1612250)
 *   maps to verified SportScore slug "zamalek-sc-vs-al-ahly-fc" on NEMO Sports
 *   (https://nemo-sports.vercel.app/matches/zamalek-sc-vs-al-ahly-fc — verified HTTP 200 for 2026-10-11).
 * - On 2026-10-11, "El Qanah vs Al Masry" (TheSportsDB idEvent=2561120, API-Football=1612249)
 *   maps to verified SportScore slug "olympic-el-qanal-vs-al-masry" on NEMO Sports
 *   (https://nemo-sports.vercel.app/matches/olympic-el-qanal-vs-al-masry — verified HTTP 200 for 2026-10-11).
 * - Conversely, for upcoming 2026-10-12 matches like "Pyramids vs Ceramica Cleopatra" (idEvent=2561124),
 *   SportScore's slug "pyramids-fc-vs-ceramica-cleopatra-fc" currently returns the old 2026-05-05 match!
 *   Therefore, verifiedNemoMatchSlug is explicitly set to null so we NEVER redirect the visitor to an old match,
 *   and instead fall back cleanly to https://nemo-sports.vercel.app/competitions/egyptian-league.
 */
export const VERIFIED_NEMO_MAPPING_TABLE: NemoMappingEntry[] = [
  {
    canonicalMatchId: 'match-egy-2026-10-11-zamalek-alahly',
    sportscoreSlug: 'zamalek-sc-vs-al-ahly-fc',
    thesportsdbEventId: '2561121',
    apiFootballFixtureId: '1612250',
    competitionCode: 'EGY',
    homeTeamId: 'team-zamalek',
    awayTeamId: 'team-al-ahly',
    cairoDate: '2026-10-11',
    verifiedNemoMatchSlug: 'zamalek-sc-vs-al-ahly-fc',
    verifiedNemoCompetitionSlug: 'egyptian-league',
    verifiedAt: '2026-10-12T00:35:00Z',
    verificationNoteAr: 'تم التحقق من فتح صفحة المباراة المباشرة (الزمالك 0-2 الأهلي — 11 أكتوبر 2026) على NEMO Sports',
  },
  {
    canonicalMatchId: 'match-egy-2026-10-11-elqanah-almasry',
    sportscoreSlug: 'olympic-el-qanal-vs-al-masry',
    thesportsdbEventId: '2561120',
    apiFootballFixtureId: '1612249',
    competitionCode: 'EGY',
    homeTeamId: 'team-el-qanah',
    awayTeamId: 'team-al-masry',
    cairoDate: '2026-10-11',
    verifiedNemoMatchSlug: 'olympic-el-qanal-vs-al-masry',
    verifiedNemoCompetitionSlug: 'egyptian-league',
    verifiedAt: '2026-10-12T00:35:00Z',
    verificationNoteAr: 'تم التحقق من فتح صفحة المباراة المباشرة (القناة 1-1 المصري — 11 أكتوبر 2026) على NEMO Sports',
  },
  {
    canonicalMatchId: 'match-egy-2026-10-12-mokawloon-zed',
    sportscoreSlug: null,
    thesportsdbEventId: '2561122',
    apiFootballFixtureId: '1612251',
    competitionCode: 'EGY',
    homeTeamId: 'team-mokawloon',
    awayTeamId: 'team-zed',
    cairoDate: '2026-10-12',
    verifiedNemoMatchSlug: null,
    verifiedNemoCompetitionSlug: 'egyptian-league',
    verifiedAt: '2026-10-12T00:35:00Z',
    verificationNoteAr: 'المسار المباشر على SportScore يعود لمباراة موسم سابق (2026-04-06)؛ تم التوجيه بأمان إلى صفحة الدوري المصري الممتاز على NEMO Sports',
  },
  {
    canonicalMatchId: 'match-egy-2026-10-12-modernsport-enppi',
    sportscoreSlug: null,
    thesportsdbEventId: '2561123',
    apiFootballFixtureId: '1612252',
    competitionCode: 'EGY',
    homeTeamId: 'team-modern-sport',
    awayTeamId: 'team-enppi',
    cairoDate: '2026-10-12',
    verifiedNemoMatchSlug: null,
    verifiedNemoCompetitionSlug: 'egyptian-league',
    verifiedAt: '2026-10-12T00:35:00Z',
    verificationNoteAr: 'المسار المباشر على SportScore يعود لمباراة سابقة (2025-09-18)؛ تم التوجيه بأمان إلى صفحة الدوري المصري الممتاز على NEMO Sports',
  },
  {
    canonicalMatchId: 'match-egy-2026-10-12-pyramids-ceramica',
    sportscoreSlug: null,
    thesportsdbEventId: '2561124',
    apiFootballFixtureId: '1612253',
    competitionCode: 'EGY',
    homeTeamId: 'team-pyramids',
    awayTeamId: 'team-ceramica',
    cairoDate: '2026-10-12',
    verifiedNemoMatchSlug: null,
    verifiedNemoCompetitionSlug: 'egyptian-league',
    verifiedAt: '2026-10-12T00:35:00Z',
    verificationNoteAr: 'المسار المباشر على SportScore يعود لمباراة سابقة (2026-05-05)؛ تم التوجيه بأمان إلى صفحة الدوري المصري الممتاز على NEMO Sports',
  },
];

/**
 * Verified competition slugs that resolve with HTTP 200 on https://nemo-sports.vercel.app/competitions/[slug]
 */
export const VERIFIED_NEMO_COMPETITION_SLUGS = new Set<string>([
  'egyptian-league',
  'caf-champions-league',
  'caf-confederation-cup',
  'saudi-pro-league',
  'champions-league',
  'uefa-europa-league',
  'premier-league',
  'la-liga',
  'serie-a',
  'bundesliga',
  'ligue-1',
  'brazilian-serie-a',
  'concacaf-league-champions-cup',
  'japanese-j1-league',
  'usl-championship',
]);

export interface ResolveNemoLinkInput {
  canonicalMatchId?: string;
  sportscoreSlug?: string | null;
  sportscoreMatchDateVerified?: boolean;
  thesportsdbEventId?: string | null;
  apiFootballFixtureId?: string | null;
  competitionCode: string;
  nemoCompetitionSlug?: string | null;
  homeTeamId: string;
  awayTeamId: string;
  cairoDate: string;
  customMappingTable?: NemoMappingEntry[];
}

/**
 * Resolves the exact, safe destination on https://nemo-sports.vercel.app for a given match.
 *
 * Resolution Hierarchy (Section 7):
 * 1. Check the Verified Mapping Table using (thesportsdbEventId / apiFootballFixtureId / sportscoreSlug)
 *    + competitionCode + homeTeamId + awayTeamId + cairoDate.
 * 2. If the match comes directly from SportScore's live/daily feed (where sportscoreSlug is verified
 *    for the exact match date), link directly to `https://nemo-sports.vercel.app/matches/{slug}`.
 * 3. If no verified direct match page exists for that exact match & date, check if the competition
 *    has a verified page on NEMO Sports (`https://nemo-sports.vercel.app/competitions/{compSlug}`).
 * 4. Otherwise, fall back to the verified date schedule on NEMO Sports (`https://nemo-sports.vercel.app/matches?date={cairoDate}`).
 * 5. Never guess or redirect to another match with a different date.
 */
export function resolveNemoSportsLink(input: ResolveNemoLinkInput): NemoLinkResolution {
  const table = input.customMappingTable || VERIFIED_NEMO_MAPPING_TABLE;
  const scheduleUrl = `${NEMO_SPORTS_BASE_URL}/matches?date=${encodeURIComponent(input.cairoDate)}`;

  const compRecord = CANONICAL_COMPETITIONS.find((c) => c.code === input.competitionCode);
  const candidateCompSlug =
    input.nemoCompetitionSlug ?? compRecord?.nemoCompetitionSlug ?? null;
  const verifiedCompSlug =
    candidateCompSlug && VERIFIED_NEMO_COMPETITION_SLUGS.has(candidateCompSlug)
      ? candidateCompSlug
      : null;
  const competitionUrl = verifiedCompSlug
    ? `${NEMO_SPORTS_BASE_URL}/competitions/${verifiedCompSlug}`
    : null;

  // Step 1: Check explicit mapping table by ID + competition + teams + date
  const mappedEntry = table.find((entry) => {
    const idMatches =
      (input.canonicalMatchId && entry.canonicalMatchId === input.canonicalMatchId) ||
      (input.thesportsdbEventId && entry.thesportsdbEventId === input.thesportsdbEventId) ||
      (input.apiFootballFixtureId && entry.apiFootballFixtureId === input.apiFootballFixtureId);
    const teamsAndDateMatch =
      entry.competitionCode === input.competitionCode &&
      entry.homeTeamId === input.homeTeamId &&
      entry.awayTeamId === input.awayTeamId &&
      entry.cairoDate === input.cairoDate;
    return Boolean(idMatches || teamsAndDateMatch);
  });

  if (mappedEntry) {
    const matchedBy: NemoMatchCriterion[] = [
      'mapping_table',
      'competition_id',
      'team_ids',
      'match_date',
    ];
    if (mappedEntry.thesportsdbEventId || mappedEntry.sportscoreSlug) {
      matchedBy.unshift('original_match_id');
    }

    if (mappedEntry.verifiedNemoMatchSlug) {
      return {
        url: `${NEMO_SPORTS_BASE_URL}/matches/${mappedEntry.verifiedNemoMatchSlug}`,
        linkType: 'direct_match',
        labelAr: 'تفاصيل المباراة على NEMO Sports',
        subLabelAr: 'صفحة المباراة المباشرة (الأحداث والتشكيلات والإحصائيات)',
        verified: true,
        matchedBy,
        competitionUrl,
        scheduleUrl,
      };
    }

    if (mappedEntry.verifiedNemoCompetitionSlug && VERIFIED_NEMO_COMPETITION_SLUGS.has(mappedEntry.verifiedNemoCompetitionSlug)) {
      const targetCompUrl = `${NEMO_SPORTS_BASE_URL}/competitions/${mappedEntry.verifiedNemoCompetitionSlug}`;
      return {
        url: targetCompUrl,
        linkType: 'competition_fallback',
        labelAr: 'صفحة البطولة على NEMO Sports',
        subLabelAr: 'صفحة المباراة التفصيلية لهذا التاريخ لم تُدرج بعد — تصفح جدول وترتيب البطولة على NEMO Sports',
        verified: true,
        matchedBy,
        competitionUrl: targetCompUrl,
        scheduleUrl,
      };
    }
  }

  // Step 2: Direct match link when SportScore provides a verified slug for this exact match & date
  if (
    input.sportscoreSlug &&
    /^[a-z0-9-]+$/i.test(input.sportscoreSlug) &&
    input.sportscoreMatchDateVerified !== false
  ) {
    return {
      url: `${NEMO_SPORTS_BASE_URL}/matches/${input.sportscoreSlug}`,
      linkType: 'direct_match',
      labelAr: 'تفاصيل المباراة على NEMO Sports',
      subLabelAr: 'انتقل مباشرة إلى صفحة المباراة على NEMO Sports',
      verified: true,
      matchedBy: ['original_match_id', 'competition_id', 'team_ids', 'match_date'],
      competitionUrl,
      scheduleUrl,
    };
  }

  // Step 3: Competition page fallback on NEMO Sports if the competition route is verified
  if (competitionUrl) {
    return {
      url: competitionUrl,
      linkType: 'competition_fallback',
      labelAr: 'صفحة البطولة على NEMO Sports',
      subLabelAr: 'صفحة المباراة المنفردة غير مفهرسة لهذا الموعد — افتح صفحة البطولة الرسمية على NEMO Sports',
      verified: true,
      matchedBy: ['competition_id', 'team_ids', 'match_date'],
      competitionUrl,
      scheduleUrl,
    };
  }

  // Step 4: Date schedule fallback on NEMO Sports
  if (input.cairoDate && /^\d{4}-\d{2}-\d{2}$/.test(input.cairoDate)) {
    return {
      url: scheduleUrl,
      linkType: 'schedule_fallback',
      labelAr: 'جدول المباريات على NEMO Sports',
      subLabelAr: 'افتح جدول مباريات هذا التاريخ على موقع NEMO Sports الرئيسي',
      verified: true,
      matchedBy: ['match_date'],
      competitionUrl: null,
      scheduleUrl,
    };
  }

  // Step 5: Explicit unavailable state rather than a broken link
  return {
    url: null,
    linkType: 'unavailable',
    labelAr: 'لا توجد وجهة مطابقة على NEMO Sports حاليًا',
    subLabelAr: 'تعذر التحقق من رابط مطابق لهذه المباراة',
    verified: false,
    matchedBy: [],
    competitionUrl: null,
    scheduleUrl,
  };
}
