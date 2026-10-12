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

const SPORTSCORE_BASE_URL =
  process.env.SPORTSCORE_BASE_URL || 'https://sportscore.com/api/widget';

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
      nameAr: homeEq?.nameAr || translateTeamNameAr(raw.home),
      nameEn: raw.home,
      logoUrl: resolveVerifiedTeamLogo(raw.home, raw.home_logo),
      isEgyptian: Boolean(homeEq?.isEgyptian),
      nemoTeamUrl: homeEq?.nemoTeamUrl || `${NEMO_SPORTS_BASE_URL}/teams/${encodeURIComponent(raw.home)}`,
    },
    awayTeam: {
      id: awayId,
      nameAr: awayEq?.nameAr || translateTeamNameAr(raw.away),
      nameEn: raw.away,
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
}

/**
 * Fetches the live/rolling 50-match widget feed from SportScore.
 * Records that fail validation or mapping are counted in `skippedRecords`; the rest are kept.
 */
export async function fetchSportScoreMatches(options: SportScoreFetchOptions = {}): Promise<{
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  matches: MatchRecord[];
  skippedRecords: number;
  error?: string;
}> {
  const url = `${SPORTSCORE_BASE_URL}/matches/?sport=football&limit=50&src=nemo-sports`;
  const res = await fetchWithProtection<SportScoreMatchesEnvelope>(url, {
    timeoutMs: options.timeoutMs ?? 8000,
    retries: options.retries ?? 1,
    cacheTtlMs: options.cacheTtlMs ?? 45_000,
  });

  if (!res.ok || !res.data || !Array.isArray(res.data.matches)) {
    return {
      ok: false,
      httpStatus: res.httpStatus,
      latencyMs: res.latencyMs,
      matches: [],
      skippedRecords: 0,
      error: res.error || 'Invalid SportScore matches payload',
    };
  }

  const mapped: MatchRecord[] = [];
  let skippedRecords = 0;
  for (const raw of res.data.matches) {
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
  const url = `${SPORTSCORE_BASE_URL}/standings/?sport=football&slug=${encodeURIComponent(
    sportscoreCompetitionSlug
  )}&src=nemo-sports`;
  const res = await fetchWithProtection<SportScoreStandingsEnvelope>(url, {
    timeoutMs: 8000,
    retries: 1,
    cacheTtlMs: 10 * 60_000,
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
