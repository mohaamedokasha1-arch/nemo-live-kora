import {
  normalizeMatchStatus,
  parseNullableScore,
  toCairoDateString,
  toCairoTimeArabic,
} from '../cairo-time';
import {
  NEMO_SPORTS_BASE_URL,
  resolveCompetitionByMeta,
  resolveEgyptianTeam,
  resolveTeamNameFromSource,
  resolveVerifiedTeamLogo,
  translateTeamNameAr,
} from '../catalog';
import {
  extractSportscoreMatchSlug,
  extractSportscoreTrackerId,
  resolveNemoSportsLink,
} from '../nemo-resolver';
import { getStableMatchId } from '../match-identity';
import {
  CompetitionStandingTable,
  MatchIncidentSummary,
  MatchRecord,
  StandingRowRecord,
} from '../types';
import { fetchWithProtection } from './http-client';

import { SOURCE_ENDPOINTS, sportscoreKey } from '../config/env';

/**
 * SportScore publishes its API under the site origin (`https://sportscore.com/developers/`):
 *   GET /api/widget/matches/?sport=football&limit=1..50   — live + recent matches
 *   GET /api/v1/matches/…                                 — alias of the widget endpoint
 *   GET /api/v1/fixtures/?…                               — fixtures/results for one calendar day
 *   GET /api/widget/standings/?sport=…&slug=…             — league table
 * `SPORTSCORE_BASE_URL` is the *site origin*, not the widget path, so every endpoint below is
 * built from it. Older deployments that set it to `…/api/widget` are detected and corrected
 * instead of silently producing `/api/widget/api/widget/matches/`.
 */
/** Site origin, derived live so a runtime override is honoured. */
export function sportscoreSiteOrigin(): string {
  return normalizeSportscoreOrigin(SOURCE_ENDPOINTS.sportscoreBase);
}

export function normalizeSportscoreOrigin(configured: string): string {
  const trimmed = (configured || 'https://sportscore.com').replace(/\/+$/, '');
  return trimmed.replace(/\/api\/(v1|widget)$/, '');
}

/** Self-identification is optional but documented; it keeps the gateway out of anonymous traffic. */
const SPORTSCORE_SRC = process.env.SPORTSCORE_SRC || 'nemo-live-kora';

/** Candidate matches endpoints, tried in order until one returns a usable payload. */
export function buildSportscoreMatchEndpoints(limit = 50): string[] {
  const origin = sportscoreSiteOrigin();
  const query = `sport=football&limit=${limit}&src=${encodeURIComponent(SPORTSCORE_SRC)}`;
  return [
    `${origin}/api/widget/matches/?${query}`,
    `${origin}/api/v1/matches/?${query}`,
    `${origin}/api/widget/matches?${query}`,
  ];
}

/** Fixtures/results for one calendar day (wider coverage than the rolling 50-match widget). */
export function buildSportscoreFixturesEndpoint(date: string): string {
  return `${sportscoreSiteOrigin()}/api/v1/fixtures/?sport=football&date=${encodeURIComponent(
    date
  )}&src=${encodeURIComponent(SPORTSCORE_SRC)}`;
}

export function buildSportscoreStandingsEndpoint(slug: string): string {
  return `${sportscoreSiteOrigin()}/api/widget/standings/?sport=football&slug=${encodeURIComponent(
    slug
  )}&src=${encodeURIComponent(SPORTSCORE_SRC)}`;
}

function sportscoreHeaders(): Record<string, string> {
  const key = sportscoreKey();
  return key ? { 'x-sportscore-key': key } : {};
}

/**
 * The widget has answered with `{matches:[…]}`, `{data:{matches:[…]}}`, and a bare array in
 * different revisions. All three shapes are accepted so an envelope change does not read as an
 * outage.
 */
export function extractSportscoreMatchList(payload: unknown): SportScoreRawMatch[] | null {
  if (Array.isArray(payload)) return payload as SportScoreRawMatch[];
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as {
    matches?: unknown;
    data?: { matches?: unknown } | unknown[];
    events?: unknown;
    fixtures?: unknown;
  };
  if (Array.isArray(candidate.matches)) return candidate.matches as SportScoreRawMatch[];
  if (Array.isArray(candidate.events)) return candidate.events as SportScoreRawMatch[];
  if (Array.isArray(candidate.fixtures)) return candidate.fixtures as SportScoreRawMatch[];
  if (Array.isArray(candidate.data)) return candidate.data as SportScoreRawMatch[];
  const nested = candidate.data as { matches?: unknown } | undefined;
  if (nested && Array.isArray(nested.matches)) return nested.matches as SportScoreRawMatch[];
  return null;
}

export interface SportScoreRawMatch {
  home: string;
  away: string;
  home_logo?: string | null;
  away_logo?: string | null;
  home_score?: string | number | null;
  away_score?: string | number | null;
  home_ht_score?: number | null;
  away_ht_score?: number | null;
  status?: string;
  status_text?: string;
  time: string;
  competition: string;
  competition_logo?: string | null;
  competition_slug?: string;
  url?: string;
  live_minute?: number | null;
  incidents?: Array<{
    time: number;
    type: string;
    side: 'home' | 'away';
    player: string;
    is_goal?: boolean;
    is_card?: boolean;
    is_sub?: boolean;
    player_in?: string;
    player_out?: string;
  }>;
  tracker?: {
    id?: string;
  };
}

export interface SportScoreMatchesEnvelope {
  sport: string;
  matches: SportScoreRawMatch[];
  count: number;
  updated?: string;
}

export interface SportScoreStandingsEnvelope {
  sport: string;
  competition: string;
  competition_logo?: string | null;
  competition_slug: string;
  tables: Array<{
    group?: string;
    rows: Array<{
      pos: number;
      team: string;
      team_logo?: string | null;
      team_slug?: string;
      team_url?: string;
      p: number;
      w: number;
      d: number;
      l: number;
      gf: number;
      ga: number;
      gd: number;
      pts: number;
      promo_name?: string;
    }>;
  }>;
}

/**
 * Normalizes a raw SportScore match object into a canonical MatchRecord.
 */
export function mapSportScoreMatchToRecord(
  raw: SportScoreRawMatch,
  explicitSlug?: string
): MatchRecord {
  const comp = resolveCompetitionByMeta({
    nameEn: raw.competition,
    sportscoreSlug: raw.competition_slug,
  });

  const homeEq = resolveEgyptianTeam(raw.home);
  const awayEq = resolveEgyptianTeam(raw.away);

  const homeId =
    homeEq?.id ||
    `team-ss-${raw.home
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`;
  const awayId =
    awayEq?.id ||
    `team-ss-${raw.away
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`;

  const cairoDate = toCairoDateString(raw.time);
  const cairoTime = toCairoTimeArabic(raw.time);

  const normStatus = normalizeMatchStatus(raw.status, raw.status_text, raw.time);

  const extractedSlug = explicitSlug || extractSportscoreMatchSlug(raw.url);
  const sportscoreTrackerId = raw.tracker?.id || extractSportscoreTrackerId(raw.url);
  const externalIds = {
    sportscoreSlug: extractedSlug || undefined,
    sportscoreTrackerId: sportscoreTrackerId || undefined,
  };
  const fallbackId = `match-${comp.code.toLowerCase()}-${cairoDate}-${homeId.replace('team-', '')}-${awayId.replace('team-', '')}`;
  const canonicalId = getStableMatchId({
    externalIds,
    competitionCode: comp.code,
    homeTeamId: homeId,
    awayTeamId: awayId,
    cairoDate,
    fallbackId,
  });

  const isEgyptianInterest = Boolean(
    comp.isEgyptianPriority || homeEq?.isEgyptian || awayEq?.isEgyptian
  );

  const nemoLink = resolveNemoSportsLink({
    canonicalMatchId: canonicalId,
    sportscoreSlug: extractedSlug,
    sportscoreTrackerId,
    competitionCode: comp.code,
    homeTeamId: homeId,
    awayTeamId: awayId,
    cairoDate,
  });

  // أسماء الفرق: الكتالوج الموثّق أولًا، ثم قاموس الترجمة، ثم اسم المصدر — وإن أرسل المصدر
  // قيمة تقنية بدل اسم نادٍ (`Team dj2ryoh2w90q1zp`) تُعرض عبارة واضحة وتُسجَّل للمراجعة.
  const homeName = homeEq
    ? { nameAr: homeEq.nameAr, nameStatus: 'verified' as const }
    : resolveTeamNameFromSource(raw.home, homeId);
  const awayName = awayEq
    ? { nameAr: awayEq.nameAr, nameStatus: 'verified' as const }
    : resolveTeamNameFromSource(raw.away, awayId);

  const incidents: MatchIncidentSummary[] | undefined = raw.incidents?.map((inc) => ({
    minute: inc.time,
    type:
      inc.type.toLowerCase().includes('penalty')
        ? 'penalty_goal'
        : inc.is_goal
        ? 'goal'
        : inc.type.toLowerCase().includes('red')
        ? 'red_card'
        : inc.is_card
        ? 'yellow_card'
        : 'substitution',
    side: inc.side,
    player: inc.player || inc.player_in || '',
    detail: inc.is_sub ? `دخول: ${inc.player_in || ''} · خروج: ${inc.player_out || ''}` : undefined,
  }));

  return {
    id: canonicalId,
    competitionId: comp.id,
    competitionCode: comp.code,
    competitionNameAr: comp.nameAr,
    competitionNameEn: comp.nameEn,
    competitionLogo: raw.competition_logo || comp.logoUrl,
    countryAr: comp.countryAr,
    region: comp.region,
    priority: isEgyptianInterest ? Math.min(comp.priority, 19) : comp.priority,
    isEgyptianInterest,
    seasonLabel: comp.currentSeason,
    roundLabelAr: null,
    utcKickoff: new Date(raw.time).toISOString(),
    kickoffConfirmed: true,
    cairoDate,
    cairoTime,
    homeTeam: {
      id: homeId,
      nameAr: homeName.nameAr,
      nameEn: raw.home,
      nameStatus: homeName.nameStatus,
      logoUrl: resolveVerifiedTeamLogo(raw.home, raw.home_logo),
      isEgyptian: Boolean(homeEq?.isEgyptian),
      nemoTeamUrl: homeEq?.nemoTeamUrl || `${NEMO_SPORTS_BASE_URL}/teams/${encodeURIComponent(raw.home)}`,
    },
    awayTeam: {
      id: awayId,
      nameAr: awayName.nameAr,
      nameEn: raw.away,
      nameStatus: awayName.nameStatus,
      logoUrl: resolveVerifiedTeamLogo(raw.away, raw.away_logo),
      isEgyptian: Boolean(awayEq?.isEgyptian),
      nemoTeamUrl: awayEq?.nemoTeamUrl || `${NEMO_SPORTS_BASE_URL}/teams/${encodeURIComponent(raw.away)}`,
    },
    status: normStatus.status,
    statusLabelAr: normStatus.statusLabelAr,
    statusNoteAr: normStatus.statusNoteAr,
    liveMinute: typeof raw.live_minute === 'number' ? raw.live_minute : null,
    score: {
      home: parseNullableScore(raw.home_score),
      away: parseNullableScore(raw.away_score),
      halfTimeHome: parseNullableScore(raw.home_ht_score),
      halfTimeAway: parseNullableScore(raw.away_ht_score),
    },
    incidents,
    venue: homeEq?.stadium || null,
    primarySource: 'sportscore',
    contributingSources: ['sportscore'],
    externalIds,
    nemoLink,
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Why a raw SportScore record cannot be stored (null = usable). Only the fields the mapper
 * depends on are checked, so one malformed row is dropped alone instead of discarding the batch.
 */
export function sportScoreSkipReason(raw: SportScoreRawMatch): string | null {
  if (!raw || typeof raw !== 'object') return 'not_an_object';
  if (typeof raw.home !== 'string' || !raw.home.trim()) return 'missing_home';
  if (typeof raw.away !== 'string' || !raw.away.trim()) return 'missing_away';
  if (typeof raw.time !== 'string' || !raw.time.trim()) return 'missing_time';
  if (!Number.isFinite(Date.parse(raw.time))) return 'invalid_time';
  return null;
}

export interface SportScoreFetchOptions {
  timeoutMs?: number;
  retries?: number;
  cacheTtlMs?: number;
  /** Override the widget limit (provider cap is 50). */
  limit?: number;
  /** Explicit endpoint list; defaults to the documented candidates. */
  endpoints?: string[];
}

/**
 * Fetches the live/rolling 50-match widget feed from SportScore.
 * Records that fail validation or mapping are counted in `skippedRecords`; the rest are kept.
 */
export interface SportScoreMatchesFetchResult {
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  matches: MatchRecord[];
  skippedRecords: number;
  /** Which endpoint answered, so a route change is visible in the sync log. */
  endpoint: string | null;
  attempts: Array<{ url: string; ok: boolean; httpStatus: number | null; error?: string }>;
  error?: string;
}

/**
 * Fetches the live/rolling match feed, trying the documented endpoints in order. Records that
 * fail validation or mapping are counted in `skippedRecords`; the rest are kept.
 */
export async function fetchSportScoreMatches(
  options: SportScoreFetchOptions = {}
): Promise<SportScoreMatchesFetchResult> {
  const endpoints = options.endpoints || buildSportscoreMatchEndpoints(options.limit ?? 50);
  const attempts: SportScoreMatchesFetchResult['attempts'] = [];
  let totalLatency = 0;
  let lastStatus: number | null = null;
  let lastError: string | undefined;

  for (const url of endpoints) {
    const res = await fetchWithProtection<unknown>(url, {
      timeoutMs: options.timeoutMs ?? 8000,
      retries: options.retries ?? 1,
      cacheTtlMs: options.cacheTtlMs ?? 45_000,
      headers: sportscoreHeaders(),
    });
    totalLatency += res.latencyMs;
    if (res.httpStatus) lastStatus = res.httpStatus;

    const list = res.ok ? extractSportscoreMatchList(res.data) : null;
    if (!res.ok || !list) {
      attempts.push({
        url,
        ok: false,
        httpStatus: res.httpStatus,
        error: res.error || 'unusable_payload_shape',
      });
      lastError = res.error || 'unusable_payload_shape';
      continue;
    }

    attempts.push({ url, ok: true, httpStatus: res.httpStatus });
    const mapped: MatchRecord[] = [];
    let skippedRecords = 0;
    for (const raw of list) {
      if (sportScoreSkipReason(raw)) {
        skippedRecords += 1;
        continue;
      }
      try {
        mapped.push(mapSportScoreMatchToRecord(raw));
      } catch {
        skippedRecords += 1;
      }
    }
    return {
      ok: true,
      httpStatus: res.httpStatus,
      latencyMs: totalLatency,
      matches: mapped,
      skippedRecords,
      endpoint: url,
      attempts,
    };
  }

  return {
    ok: false,
    httpStatus: lastStatus,
    latencyMs: totalLatency,
    matches: [],
    skippedRecords: 0,
    endpoint: null,
    attempts,
    error: lastError || 'All SportScore endpoints failed',
  };
}

/**
 * Fixtures/results for one calendar day. Used alongside the rolling widget so a full Egyptian
 * matchday is not limited to whatever fits in the 50-match live window.
 */
export async function fetchSportScoreFixturesByDate(
  date: string,
  options: SportScoreFetchOptions = {}
): Promise<SportScoreMatchesFetchResult> {
  const url = buildSportscoreFixturesEndpoint(date);
  const res = await fetchWithProtection<unknown>(url, {
    timeoutMs: options.timeoutMs ?? 8000,
    retries: options.retries ?? 1,
    cacheTtlMs: options.cacheTtlMs ?? 60_000,
    headers: sportscoreHeaders(),
  });
  const list = res.ok ? extractSportscoreMatchList(res.data) : null;
  if (!res.ok || !list) {
    return {
      ok: false,
      httpStatus: res.httpStatus,
      latencyMs: res.latencyMs,
      matches: [],
      skippedRecords: 0,
      endpoint: url,
      attempts: [{ url, ok: false, httpStatus: res.httpStatus, error: res.error || 'unusable_payload_shape' }],
      error: res.error || 'unusable_payload_shape',
    };
  }
  const mapped: MatchRecord[] = [];
  let skippedRecords = 0;
  for (const raw of list) {
    if (sportScoreSkipReason(raw)) {
      skippedRecords += 1;
      continue;
    }
    try {
      mapped.push(mapSportScoreMatchToRecord(raw));
    } catch {
      skippedRecords += 1;
    }
  }
  return {
    ok: true,
    httpStatus: res.httpStatus,
    latencyMs: res.latencyMs,
    matches: mapped,
    skippedRecords,
    endpoint: url,
    attempts: [{ url, ok: true, httpStatus: res.httpStatus }],
  };
}

/**
 * Fetches standings for a specific competition slug from SportScore.
 */
export async function fetchSportScoreStandings(
  sportscoreCompetitionSlug: string
): Promise<{
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  table: CompetitionStandingTable | null;
  error?: string;
}> {
  const url = buildSportscoreStandingsEndpoint(sportscoreCompetitionSlug);
  const res = await fetchWithProtection<SportScoreStandingsEnvelope>(url, {
    timeoutMs: 8000,
    retries: 1,
    cacheTtlMs: 10 * 60_000,
    headers: sportscoreHeaders(),
  });

  if (!res.ok || !res.data || !Array.isArray(res.data.tables)) {
    return {
      ok: false,
      httpStatus: res.httpStatus,
      latencyMs: res.latencyMs,
      table: null,
      error: res.error || 'No standings tables returned',
    };
  }

  const comp = resolveCompetitionByMeta({
    nameEn: res.data.competition,
    sportscoreSlug: sportscoreCompetitionSlug,
  });

  const rows: StandingRowRecord[] = [];
  for (const groupTable of res.data.tables) {
    for (const r of groupTable.rows || []) {
      const eq = resolveEgyptianTeam(r.team);
      rows.push({
        position: r.pos,
        teamId: eq?.id || `team-ss-${r.team_slug || r.pos}`,
        teamNameAr: eq?.nameAr || translateTeamNameAr(r.team),
        teamNameEn: r.team,
        teamLogo: r.team_logo || eq?.logoUrl || null,
        played: r.p,
        won: r.w,
        drawn: r.d,
        lost: r.l,
        goalsFor: r.gf,
        goalsAgainst: r.ga,
        goalDiff: r.gd,
        points: r.pts,
        noteAr: groupTable.group ? `${groupTable.group}${r.promo_name ? ` · ${r.promo_name}` : ''}` : r.promo_name || null,
        nemoTeamUrl: eq?.nemoTeamUrl || `${NEMO_SPORTS_BASE_URL}/teams/${encodeURIComponent(r.team)}`,
      });
    }
  }

  return {
    ok: true,
    httpStatus: res.httpStatus,
    latencyMs: res.latencyMs,
    table: {
      competitionCode: comp.code,
      competitionNameAr: comp.nameAr,
      competitionNameEn: comp.nameEn,
      competitionLogo: res.data.competition_logo || comp.logoUrl,
      seasonLabel: comp.currentSeason,
      sourceId: 'sportscore',
      updatedAt: new Date().toISOString(),
      nemoCompetitionUrl: comp.nemoCompetitionSlug
        ? `${NEMO_SPORTS_BASE_URL}/competitions/${comp.nemoCompetitionSlug}`
        : null,
      rows,
    },
  };
}
