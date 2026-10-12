import { NEMO_SPORTS_BASE_URL } from './catalog';
import { NemoLinkResolution, NemoMappingEntry } from './types';

/**
 * Path of NEMO Sports' general broadcast section (`app/watch/page.tsx` on the main site: the
 * "NEMO Watch Guide" that lists operator-registered streams).
 *
 * Per-match broadcast links are not used. The main site's `/matches/[slug]` page renders a
 * live-stream section for every match, but that section only shows a stream when one is
 * registered for the match, and nothing in this gateway can verify that per match. Every
 * broadcast CTA therefore points at this single general destination.
 */
export const NEMO_BROADCAST_PATH = '/watch';

/** Absolute URL of the NEMO Sports broadcast section; the only broadcast destination. */
export const NEMO_BROADCAST_SECTION_URL = `${NEMO_SPORTS_BASE_URL.replace(/\/+$/, '')}${NEMO_BROADCAST_PATH}`;

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
  /** @deprecated Kept for call-site compatibility; has no effect on the destination. */
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

/**
 * Resolves the broadcast CTA for a match. Every match gets the same general destination,
 * `NEMO_BROADCAST_SECTION_URL`, so no visitor is sent to a per-match page that might be
 * missing or might show the wrong fixture. The input is accepted for call-site compatibility
 * and is not used to build the URL. Identity (dedupe, stable ids) still uses the source ids
 * through `findVerifiedMatchMapping` and `lib/match-identity.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site compatibility
export function resolveNemoSportsLink(_input: ResolveNemoLinkInput): NemoLinkResolution {
  return {
    url: NEMO_BROADCAST_SECTION_URL,
    linkType: 'broadcast_section',
    labelAr: 'قسم البث على NEMO Sports',
    subLabelAr:
      'يفتح قسم البث العام على NEMO Sports. القسم لا يعرض بثًا لكل مباراة؛ قد لا تكون هذه المباراة متاحة هناك.',
    verified: true,
    matchedBy: [],
    competitionUrl: null,
    scheduleUrl: null,
  };
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
