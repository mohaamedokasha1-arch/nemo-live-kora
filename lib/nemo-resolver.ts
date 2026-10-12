import { NEMO_SPORTS_BASE_URL } from './catalog';
import {
  NemoLinkResolution,
  NemoMappingEntry,
  NemoMatchCriterion,
} from './types';

/**
 * Extracts the match slug from a SportScore match URL.
 * The slug is descriptive, not a unique fixture id; it is used for outbound links only
 * when the fixture is also present in the explicit verification table below.
 */
export function extractSportscoreMatchSlug(urlPath?: string | null): string | null {
  if (!urlPath) return null;
  const match = urlPath.match(/\/match\/([^/?#]+)(?:\/[^/?#]+)?\/?(?:[?#].*)?$/);
  const slug = match?.[1]?.trim();
  return slug && /^[a-z0-9-]+$/i.test(slug) ? slug.toLowerCase() : null;
}

/** Extracts SportScore's actual per-fixture tracker id from its source URL path. */
export function extractSportscoreTrackerId(urlPath?: string | null): string | null {
  if (!urlPath) return null;
  const match = urlPath.match(/\/match\/[^/?#]+\/([^/?#]+)\/?(?:[?#].*)?$/);
  const id = match?.[1]?.trim();
  return id && /^[a-z0-9_-]+$/i.test(id) ? id : null;
}

/**
 * Explicit match-by-match allowlist of NEMO Sports destinations checked against the
 * published main site. A competition slug or a SportScore slug alone is not enough to
 * declare that a matching match page exists.
 */
export const VERIFIED_NEMO_MAPPING_TABLE: NemoMappingEntry[] = [
  {
    canonicalMatchId: 'match-api-football-1612250',
    sportscoreSlug: 'zamalek-sc-vs-al-ahly-fc',
    sportscoreTrackerId: 'l5ergph49xdlr8k',
    thesportsdbEventId: '2561121',
    apiFootballFixtureId: '1612250',
    competitionCode: 'EGY',
    homeTeamId: 'team-zamalek',
    awayTeamId: 'team-al-ahly',
    cairoDate: '2026-10-11',
    verifiedNemoMatchSlug: 'zamalek-sc-vs-al-ahly-fc',
    verifiedNemoCompetitionSlug: 'egyptian-league',
    verifiedAt: '2026-10-12T00:35:00Z',
    verificationNoteAr:
      'تم اختبار الوجهة المنشورة: صفحة الزمالك ضد الأهلي تعرض المباراة الصحيحة بتاريخ 11 أكتوبر 2026 والنتيجة 0-2.',
  },
  {
    canonicalMatchId: 'match-api-football-1612249',
    sportscoreSlug: 'olympic-el-qanal-vs-al-masry',
    sportscoreTrackerId: '4wyrn4h6kpwlq86',
    thesportsdbEventId: '2561120',
    apiFootballFixtureId: '1612249',
    competitionCode: 'EGY',
    homeTeamId: 'team-el-qanah',
    awayTeamId: 'team-al-masry',
    cairoDate: '2026-10-11',
    verifiedNemoMatchSlug: 'olympic-el-qanal-vs-al-masry',
    verifiedNemoCompetitionSlug: 'egyptian-league',
    verifiedAt: '2026-10-12T00:35:00Z',
    verificationNoteAr:
      'تم اختبار الوجهة المنشورة: صفحة القناة ضد المصري تعرض المباراة الصحيحة بتاريخ 11 أكتوبر 2026 والنتيجة 1-1.',
  },
  {
    canonicalMatchId: 'match-api-football-1612251',
    sportscoreSlug: null,
    sportscoreTrackerId: null,
    thesportsdbEventId: '2561122',
    apiFootballFixtureId: '1612251',
    competitionCode: 'EGY',
    homeTeamId: 'team-mokawloon',
    awayTeamId: 'team-zed',
    cairoDate: '2026-10-12',
    verifiedNemoMatchSlug: null,
    verifiedNemoCompetitionSlug: null,
    verifiedAt: '2026-10-12T00:35:00Z',
    verificationNoteAr:
      'لم تُتحقق صفحة مباراة مطابقة على الموقع الأساسي؛ لا يُستخدم رابط بطولة أو جدول عام كبديل.',
  },
  {
    canonicalMatchId: 'match-api-football-1612252',
    sportscoreSlug: null,
    sportscoreTrackerId: null,
    thesportsdbEventId: '2561123',
    apiFootballFixtureId: '1612252',
    competitionCode: 'EGY',
    homeTeamId: 'team-modern-sport',
    awayTeamId: 'team-enppi',
    cairoDate: '2026-10-12',
    verifiedNemoMatchSlug: null,
    verifiedNemoCompetitionSlug: null,
    verifiedAt: '2026-10-12T00:35:00Z',
    verificationNoteAr:
      'لم تُتحقق صفحة مباراة مطابقة على الموقع الأساسي؛ لا يُستخدم رابط بطولة أو جدول عام كبديل.',
  },
  {
    canonicalMatchId: 'match-api-football-1612253',
    sportscoreSlug: null,
    sportscoreTrackerId: null,
    thesportsdbEventId: '2561124',
    apiFootballFixtureId: '1612253',
    competitionCode: 'EGY',
    homeTeamId: 'team-pyramids',
    awayTeamId: 'team-ceramica',
    cairoDate: '2026-10-12',
    verifiedNemoMatchSlug: null,
    verifiedNemoCompetitionSlug: null,
    verifiedAt: '2026-10-12T00:35:00Z',
    verificationNoteAr:
      'لم تُتحقق صفحة مباراة مطابقة على الموقع الأساسي؛ لا يُستخدم رابط بطولة أو جدول عام كبديل.',
  },
];

export interface ResolveNemoLinkInput {
  canonicalMatchId?: string;
  sportscoreSlug?: string | null;
  /** @deprecated Slugs are not treated as proof of an exact match page. */
  sportscoreMatchDateVerified?: boolean;
  sportscoreTrackerId?: string | null;
  thesportsdbEventId?: string | null;
  apiFootballFixtureId?: string | null;
  competitionCode: string;
  homeTeamId: string;
  awayTeamId: string;
  cairoDate: string;
  customMappingTable?: NemoMappingEntry[];
}

function matchesTrustedSourceId(
  input: Pick<
    ResolveNemoLinkInput,
    'sportscoreTrackerId' | 'thesportsdbEventId' | 'apiFootballFixtureId'
  >,
  entry: NemoMappingEntry
): boolean {
  return Boolean(
    (input.sportscoreTrackerId && entry.sportscoreTrackerId === input.sportscoreTrackerId) ||
      (input.thesportsdbEventId && entry.thesportsdbEventId === input.thesportsdbEventId) ||
      (input.apiFootballFixtureId && entry.apiFootballFixtureId === input.apiFootballFixtureId)
  );
}

function unavailableLink(note?: string): NemoLinkResolution {
  return {
    url: null,
    linkType: 'unavailable',
    labelAr: 'لا توجد صفحة مباراة مطابقة موثقة على NEMO Sports',
    subLabelAr:
      note ||
      'لم يُعثر على رابط مباشر تم التحقق من مطابقته لهذه المباراة؛ لن نوجّهك إلى بطولة أو جدول عام.',
    verified: false,
    matchedBy: [],
    competitionUrl: null,
    scheduleUrl: null,
  };
}

/**
 * Resolves only exact, explicitly verified match destinations. Arbitrary provider slugs,
 * competition pages and date schedules are deliberately not used as match fallbacks.
 */
export function resolveNemoSportsLink(input: ResolveNemoLinkInput): NemoLinkResolution {
  const table = input.customMappingTable || VERIFIED_NEMO_MAPPING_TABLE;
  const mapping = table.find((entry) => {
    const contextMatches =
      entry.competitionCode === input.competitionCode &&
      entry.homeTeamId === input.homeTeamId &&
      entry.awayTeamId === input.awayTeamId;
    if (!contextMatches) return false;

    const stableSourceIdMatches = matchesTrustedSourceId(input, entry);
    const stableCanonicalIdMatches =
      Boolean(input.canonicalMatchId) && entry.canonicalMatchId === input.canonicalMatchId;
    return stableSourceIdMatches || stableCanonicalIdMatches;
  });

  if (!mapping || !mapping.verifiedNemoMatchSlug || !/^[a-z0-9-]+$/i.test(mapping.verifiedNemoMatchSlug)) {
    return unavailableLink(mapping?.verificationNoteAr);
  }

  const matchedBy: NemoMatchCriterion[] = [
    'mapping_table',
    'competition_id',
    'team_ids',
  ];
  if (matchesTrustedSourceId(input, mapping)) {
    matchedBy.unshift('original_match_id');
  }
  if (
    input.sportscoreSlug &&
    input.sportscoreSlug === mapping.sportscoreSlug &&
    input.cairoDate === mapping.cairoDate
  ) {
    matchedBy.push('match_date');
  }

  return {
    url: `${NEMO_SPORTS_BASE_URL}/matches/${mapping.verifiedNemoMatchSlug}`,
    linkType: 'direct_match',
    labelAr: 'تفاصيل المباراة على NEMO Sports',
    subLabelAr: mapping.verificationNoteAr,
    verified: true,
    matchedBy,
    competitionUrl: null,
    scheduleUrl: null,
  };
}

/**
 * Used by stable match identity generation. The returned mapping is only accepted when
 * the source fixture identifier and the competition/ordered teams agree.
 */
export function findVerifiedMatchMapping(input: {
  sportscoreTrackerId?: string | null;
  sportscoreSlug?: string | null;
  thesportsdbEventId?: string | null;
  apiFootballFixtureId?: string | null;
  competitionCode: string;
  homeTeamId: string;
  awayTeamId: string;
}): NemoMappingEntry | undefined {
  return VERIFIED_NEMO_MAPPING_TABLE.find((entry) => {
    const contextMatches =
      entry.competitionCode === input.competitionCode &&
      entry.homeTeamId === input.homeTeamId &&
      entry.awayTeamId === input.awayTeamId;
    if (!contextMatches) return false;
    return matchesTrustedSourceId(input, entry);
  });
}
