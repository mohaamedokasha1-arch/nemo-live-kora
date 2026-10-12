import { NEMO_SPORTS_BASE_URL } from './catalog';
import {
  NemoLinkResolution,
  NemoMappingEntry,
  NemoMatchCriterion,
} from './types';

/**
 * Broadcast section anchor on NEMO Sports match pages.
 *
 * Verified against the main site's source (app/matches/[slug]/page.tsx): the page always
 * renders `<section id="live-stream">` — either the registered stream player
 * (components/match/MatchStreamPlayer.tsx, default `sectionId = "live-stream"`) or the
 * "no verified broadcast for this match" notice. The anchor therefore never points at a
 * missing element, and browsers keep the fragment across the main site's own redirects.
 */
export const NEMO_LIVE_STREAM_ANCHOR = 'live-stream';

/**
 * NEMO Sports addresses a match page by the SportScore permalink slug
 * (`packages/sdl/src/adapters/sportscore.ts#matchSlugFromUrl` → `providerId`, and
 * `lib/match-links.ts#matchPath` → `/matches/${encodeURIComponent(slug)}`). The gateway
 * reads the same slug from the same provider URL, so this is the main site's own match
 * identifier — not a guess derived from team names, competition or date.
 */
export function buildNemoBroadcastUrl(nemoMatchSlug: string): string {
  return `${NEMO_SPORTS_BASE_URL}/matches/${encodeURIComponent(nemoMatchSlug)}#${NEMO_LIVE_STREAM_ANCHOR}`;
}

/**
 * SportScore emits `team-<opaque id>` for a side whose club name is missing; NEMO Sports
 * answers 404 for such slugs (lib/match-identity.ts#isPlaceholderIdentity on the main
 * site). Never send a visitor there.
 */
const PLACEHOLDER_SIDE = /^(?:team|club|player|home|away)-[a-z0-9]{8,}$/i;

export function isLinkableNemoMatchSlug(slug?: string | null): slug is string {
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return false;
  const sides = slug.split('-vs-');
  if (sides.length !== 2 || !sides[0] || !sides[1]) return false;
  return !sides.some((side) => PLACEHOLDER_SIDE.test(side));
}

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
      'هذه المباراة واردة من TheSportsDB فقط ولا تحمل معرّف SportScore الذي يستخدمه NEMO Sports لصفحة المباراة؛ يُضاف رابط البث تلقائيًا عندما يرصدها SportScore، ولا يُستخدم رابط بطولة أو جدول عام كبديل.',
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
      'هذه المباراة واردة من TheSportsDB فقط ولا تحمل معرّف SportScore الذي يستخدمه NEMO Sports لصفحة المباراة؛ يُضاف رابط البث تلقائيًا عندما يرصدها SportScore، ولا يُستخدم رابط بطولة أو جدول عام كبديل.',
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
      'هذه المباراة واردة من TheSportsDB فقط ولا تحمل معرّف SportScore الذي يستخدمه NEMO Sports لصفحة المباراة؛ يُضاف رابط البث تلقائيًا عندما يرصدها SportScore، ولا يُستخدم رابط بطولة أو جدول عام كبديل.',
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
    labelAr: 'لا يتوفر رابط بث مطابق لهذه المباراة على NEMO Sports',
    subLabelAr:
      note ||
      'لا يملك مصدر هذه المباراة المعرّف الذي يستخدمه NEMO Sports لصفحة المباراة؛ لن نوجّهك إلى بطولة أو جدول عام أو مباراة أخرى.',
    verified: false,
    matchedBy: [],
    competitionUrl: null,
    scheduleUrl: null,
  };
}

/**
 * Resolves the NEMO Sports broadcast destination for a match.
 *
 * Priority:
 * 1. The match's own SportScore permalink slug (the identifier NEMO Sports keys its
 *    match pages by) → `/matches/{slug}#live-stream`.
 * 2. A bridge-table entry that ties a TheSportsDB / API-Football fixture id to a
 *    SportScore slug verified on the published site (same competition and ordered teams).
 * 3. Otherwise no link. Competition pages, date schedules and name-guessed slugs are
 *    deliberately never used as a substitute for a specific match.
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

  // 1) The provider slug NEMO Sports itself uses as the match page identifier.
  if (isLinkableNemoMatchSlug(input.sportscoreSlug)) {
    const matchedBy: NemoMatchCriterion[] = ['original_match_id'];
    if (mapping?.verifiedNemoMatchSlug === input.sportscoreSlug) {
      matchedBy.push('mapping_table', 'competition_id', 'team_ids');
      if (input.cairoDate === mapping.cairoDate) matchedBy.push('match_date');
    }
    return {
      url: buildNemoBroadcastUrl(input.sportscoreSlug),
      linkType: 'direct_match',
      labelAr: 'مشاهدة البث على NEMO Sports',
      subLabelAr:
        mapping?.verifiedNemoMatchSlug === input.sportscoreSlug
          ? mapping.verificationNoteAr
          : 'الرابط مبني على معرّف المباراة الأصلي من SportScore، وهو المعرّف نفسه الذي تستخدمه صفحة المباراة على NEMO Sports.',
      verified: true,
      matchedBy,
      competitionUrl: null,
      scheduleUrl: null,
    };
  }

  // 2) Bridge table: another source's fixture id tied to a verified SportScore slug.
  if (!mapping || !isLinkableNemoMatchSlug(mapping.verifiedNemoMatchSlug)) {
    return unavailableLink(mapping?.verificationNoteAr);
  }

  const matchedBy: NemoMatchCriterion[] = ['mapping_table', 'competition_id', 'team_ids'];
  if (matchesTrustedSourceId(input, mapping)) {
    matchedBy.unshift('original_match_id');
  }
  if (input.cairoDate === mapping.cairoDate) {
    matchedBy.push('match_date');
  }

  return {
    url: buildNemoBroadcastUrl(mapping.verifiedNemoMatchSlug),
    linkType: 'direct_match',
    labelAr: 'مشاهدة البث على NEMO Sports',
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
