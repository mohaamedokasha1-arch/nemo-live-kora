import { NemoLinkResolution, NemoMappingEntry } from './types';

/** The origin used during verification; do not let runtime configuration retarget allow-listed paths. */
export const VERIFIED_NEMO_SPORTS_ORIGIN = 'https://nemo-sports.vercel.app';

/** Only emit a direct NEMO Sports match page when its source identity is allow-listed. */
export const NEMO_MATCH_BROADCAST_SECTION_ID = 'live-stream';

/**
 * Extracts the match slug from a SportScore match URL.
 * A descriptive slug alone is not a unique fixture id and is never enough to create a link.
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
 * Exact-match allowlist checked against the currently published NEMO Sports site.
 * A row with no verified match slug is deliberately not linkable.
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
    verifiedAt: '2026-10-12T22:21:00Z',
    verificationNoteAr:
      'صفحة هذه المباراة على منصة NEMO Sports: الزمالك ضد الأهلي — 11 أكتوبر 2026.',
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
    verifiedAt: '2026-10-12T22:21:00Z',
    verificationNoteAr:
      'صفحة هذه المباراة على منصة NEMO Sports: القناة ضد المصري — 11 أكتوبر 2026.',
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
    verifiedAt: '2026-10-12T22:21:00Z',
    verificationNoteAr:
      'شاهد المباراة مباشرة عبر منصة NEMO Sports، واختر المباراة من صفحة المشاهدة.',
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
    verifiedAt: '2026-10-12T22:21:00Z',
    verificationNoteAr:
      'شاهد المباراة مباشرة عبر منصة NEMO Sports، واختر المباراة من صفحة المشاهدة.',
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
    verifiedAt: '2026-10-12T22:21:00Z',
    verificationNoteAr:
      'شاهد المباراة مباشرة عبر منصة NEMO Sports، واختر المباراة من صفحة المشاهدة.',
  },
];

export interface ResolveNemoLinkInput {
  canonicalMatchId?: string;
  sportscoreSlug?: string | null;
  /** @deprecated Retained for input compatibility; it does not establish a match identity. */
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

/**
 * Used by stable match identity generation. The mapping is accepted only when the provider
 * fixture id, competition, and ordered teams agree; the descriptive slug is not identity.
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

/**
 * Returns a page URL only for an explicitly verified match slug.
 * The public watch guide is general-purpose and does not select an event-specific section from
 * query or hash fragments. The match page's `#live-stream` section is the verified destination
 * for the two allow-listed fixtures.
 */
export function getVerifiedNemoMatchPageUrl(entry: NemoMappingEntry): string | null {
  const trustedEntry = VERIFIED_NEMO_MAPPING_TABLE.find(
    (candidate) =>
      candidate.canonicalMatchId === entry.canonicalMatchId &&
      candidate.verifiedNemoMatchSlug === entry.verifiedNemoMatchSlug &&
      candidate.cairoDate === entry.cairoDate &&
      candidate.competitionCode === entry.competitionCode &&
      candidate.homeTeamId === entry.homeTeamId &&
      candidate.awayTeamId === entry.awayTeamId &&
      candidate.sportscoreTrackerId === entry.sportscoreTrackerId &&
      candidate.thesportsdbEventId === entry.thesportsdbEventId &&
      candidate.apiFootballFixtureId === entry.apiFootballFixtureId
  );
  const slug = trustedEntry?.verifiedNemoMatchSlug;
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) return null;
  return `${VERIFIED_NEMO_SPORTS_ORIGIN}/matches/${slug}#${NEMO_MATCH_BROADCAST_SECTION_ID}`;
}

function getExactMatchMapping(input: ResolveNemoLinkInput): NemoMappingEntry | undefined {
  const entry = findVerifiedMatchMapping(input);
  if (!entry || entry.cairoDate !== input.cairoDate) return undefined;
  return getVerifiedNemoMatchPageUrl(entry) ? entry : undefined;
}

/**
 * Resolve only an exact, source-id-backed, date-checked match page. A verified page is not a
 * promise that a stream is active: NEMO Sports renders the real broadcast state at the target.
 * If no exact page is verified, return no URL so the card can display a clear unavailable state.
 */
export function resolveNemoSportsLink(input: ResolveNemoLinkInput): NemoLinkResolution {
  const entry = getExactMatchMapping(input);
  const url = entry ? getVerifiedNemoMatchPageUrl(entry) : null;

  if (entry && url) {
    return {
      url,
      linkType: 'direct_match',
      labelAr: 'صفحة المباراة على NEMO Sports',
      subLabelAr:
        'تفتح صفحة هذه المباراة تحديدًا على منصة NEMO Sports.',
      verified: true,
      matchedBy: ['provider_match_id', 'competition_id', 'team_ids', 'match_date', 'mapping_table'],
      competitionUrl: null,
      scheduleUrl: null,
    };
  }

  return {
    url: null,
    linkType: 'unavailable',
    labelAr: 'شاهد مباشرة على NEMO Sports',
    subLabelAr:
      'شاهد المباراة عبر منصة NEMO Sports، واختر المباراة من صفحة المشاهدة.',
    verified: false,
    matchedBy: [],
    competitionUrl: null,
    scheduleUrl: null,
  };
}
