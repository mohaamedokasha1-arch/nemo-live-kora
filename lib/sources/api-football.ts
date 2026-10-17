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
  translateTeamNameAr,
} from '../catalog';
import { resolveNemoSportsLink } from '../nemo-resolver';
import { getStableMatchId } from '../match-identity';
import {
  CompetitionStandingTable,
  MatchRecord,
  SourceHealthStatus,
  StandingRowRecord,
} from '../types';
import { fetchWithProtection } from './http-client';

import { API_FOOTBALL_LEAGUES, SOURCE_ENDPOINTS, apiFootballKey } from '../config/env';

const API_FOOTBALL_BASE_URL = SOURCE_ENDPOINTS.apiFootballBase;

/**
 * API-Football v3 accepts two transports:
 *  - direct: `https://v3.football.api-sports.io` with `x-apisports-key`
 *  - RapidAPI mirror: set API_FOOTBALL_BASE_URL to the RapidAPI host and API_FOOTBALL_HOST to
 *    `api-football-v1.p.rapidapi.com`; the key then travels in `x-rapidapi-key`.
 * Both are supported so a key bought on either platform works without code changes.
 */
export function apiFootballAuthHeaders(): Record<string, string> {
  const key = apiFootballKey();
  if (!key) return {};
  const rapidHost = SOURCE_ENDPOINTS.apiFootballHostHeader;
  if (rapidHost) {
    return { 'x-rapidapi-key': key, 'x-rapidapi-host': rapidHost };
  }
  return { 'x-apisports-key': key };
}

/** Egyptian Premier League id used for whole-competition fixture and standings calls. */
export const API_FOOTBALL_EGYPT_LEAGUE_ID = API_FOOTBALL_LEAGUES.egyptPremierLeague;

export interface ApiFootballEnvelope<T> {
  get?: string;
  errors?: Record<string, string> | string[];
  results?: number;
  response?: T;
}

export interface ApiFootballFixtureItem {
  fixture: {
    id: number;
    date: string;
    venue?: {
      name?: string | null;
    };
    status: {
      long: string;
      short: string;
      elapsed: number | null;
    };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo?: string | null;
    season: number;
    round?: string | null;
  };
  teams: {
    home: {
      id: number;
      name: string;
      logo?: string | null;
    };
    away: {
      id: number;
      name: string;
      logo?: string | null;
    };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
  score?: {
    halftime?: {
      home: number | null;
      away: number | null;
    };
  };
}

/**
 * Checks API-Football v3 status and fetches fixtures for a given date when API_FOOTBALL_KEY is configured.
 * Transparently records when API_FOOTBALL_KEY is missing without breaking the gateway.
 */
/**
 * Maps one API-Football v3 fixture into the canonical MatchRecord. Extracted so the day query and
 * the whole-competition query share one mapping (and one identity rule).
 */
export function mapApiFootballFixtureItem(item: ApiFootballFixtureItem): MatchRecord | null {
  if (!item?.fixture?.id || !item?.teams?.home?.name || !item?.teams?.away?.name) return null;
  if (!item.fixture.date || Number.isNaN(Date.parse(item.fixture.date))) return null;
  try {
    const comp = resolveCompetitionByMeta({
      nameEn: item.league.name,
      apiFootballId: item.league.id,
      countryEn: item.league.country,
    });
    const homeEq = resolveEgyptianTeam(item.teams.home.name);
    const awayEq = resolveEgyptianTeam(item.teams.away.name);
    const homeId = homeEq?.id || `team-apif-${item.teams.home.id}`;
    const awayId = awayEq?.id || `team-apif-${item.teams.away.id}`;
    const mCairoDate = toCairoDateString(item.fixture.date);
    const mCairoTime = toCairoTimeArabic(item.fixture.date);
    const normStatus = normalizeMatchStatus(
      item.fixture.status.short,
      item.fixture.status.long,
      item.fixture.date
    );
    const externalIds = {
      apiFootballFixtureId: String(item.fixture.id),
    };
    const fallbackId = `match-${comp.code.toLowerCase()}-${mCairoDate}-${homeId.replace('team-', '')}-${awayId.replace('team-', '')}`;
    const canonicalId = getStableMatchId({
      externalIds,
      competitionCode: comp.code,
      homeTeamId: homeId,
      awayTeamId: awayId,
      cairoDate: mCairoDate,
      fallbackId,
    });

    return {
      id: canonicalId,
      competitionId: comp.id,
      competitionCode: comp.code,
      competitionNameAr: comp.nameAr,
      competitionNameEn: comp.nameEn,
      competitionLogo: item.league.logo || comp.logoUrl,
      countryAr: comp.countryAr,
      region: comp.region,
      priority: comp.priority,
      isEgyptianInterest: Boolean(comp.isEgyptianPriority || homeEq || awayEq),
      seasonLabel: String(item.league.season),
      roundLabelAr: item.league.round || null,
      utcKickoff: new Date(item.fixture.date).toISOString(),
      kickoffConfirmed: true,
      cairoDate: mCairoDate,
      cairoTime: mCairoTime,
      homeTeam: {
        id: homeId,
        nameAr: homeEq?.nameAr || resolveTeamNameFromSource(item.teams.home.name, homeId).nameAr,
        nameEn: item.teams.home.name,
        logoUrl: item.teams.home.logo || homeEq?.logoUrl || null,
        isEgyptian: Boolean(homeEq),
      },
      awayTeam: {
        id: awayId,
        nameAr: awayEq?.nameAr || resolveTeamNameFromSource(item.teams.away.name, awayId).nameAr,
        nameEn: item.teams.away.name,
        logoUrl: item.teams.away.logo || awayEq?.logoUrl || null,
        isEgyptian: Boolean(awayEq),
      },
      status: normStatus.status,
      statusLabelAr: normStatus.statusLabelAr,
      statusNoteAr: normStatus.statusNoteAr,
      liveMinute: item.fixture.status.elapsed,
      score: {
        home: parseNullableScore(item.goals.home),
        away: parseNullableScore(item.goals.away),
        halfTimeHome: parseNullableScore(item.score?.halftime?.home),
        halfTimeAway: parseNullableScore(item.score?.halftime?.away),
      },
      venue: item.fixture.venue?.name || null,
      primarySource: 'api-football',
      contributingSources: ['api-football'],
      externalIds,
      nemoLink: resolveNemoSportsLink({
        canonicalMatchId: canonicalId,
        apiFootballFixtureId: externalIds.apiFootballFixtureId,
        competitionCode: comp.code,
        homeTeamId: homeId,
        awayTeamId: awayId,
        cairoDate: mCairoDate,
      }),
      lastUpdatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export interface ApiFootballSyncResult {
  ok: boolean;
  status: SourceHealthStatus;
  httpStatus: number | null;
  latencyMs: number;
  hasApiKey: boolean;
  matches: MatchRecord[];
  standings: CompetitionStandingTable[];
  /** Remaining daily requests reported by the provider, when it sends the headers. */
  rateLimit?: { limit: number | null; remaining: number | null; reset: string | null };
  messageAr: string;
  errorCode?: string;
}

export async function fetchApiFootballSync(cairoDate: string, options: {
  /** Also pull the whole Egyptian competition and its table (costs 2 extra requests). */
  includeLeague?: boolean;
  season?: number;
} = {}): Promise<ApiFootballSyncResult> {
  const apiKey = apiFootballKey();
  const hasApiKey = Boolean(apiKey);

  if (!hasApiKey) {
    // Still probe /status if network is available to confirm endpoint reachability
    const statusProbe = await fetchWithProtection<ApiFootballEnvelope<unknown>>(
      `${API_FOOTBALL_BASE_URL}/status`,
      {
        timeoutMs: 5000,
        retries: 0,
        cacheTtlMs: 10 * 60_000,
      }
    );

    const tokenErr =
      statusProbe.data?.errors &&
      !Array.isArray(statusProbe.data.errors) &&
      statusProbe.data.errors.token
        ? statusProbe.data.errors.token
        : 'Missing application key';

    return {
      ok: false,
      status: 'requires_api_key',
      httpStatus: statusProbe.httpStatus,
      latencyMs: statusProbe.latencyMs,
      hasApiKey: false,
      matches: [],
      standings: [],
      errorCode: 'MISSING_API_FOOTBALL_KEY',
      messageAr: `جلب API-Football غير مفعّل (${tokenErr}) — يتطلب إضافة API_FOOTBALL_KEY في متغيرات البيئة لتفعيل الجلب المباشر؛ يتم حاليًا ربط معرّفات idAPIfootball تلقائيًا عبر المصادر الأخرى.`,
    };
  }

  const url = `${API_FOOTBALL_BASE_URL}/fixtures?date=${encodeURIComponent(
    cairoDate
  )}&timezone=Africa/Cairo`;
  const res = await fetchWithProtection<ApiFootballEnvelope<ApiFootballFixtureItem[]>>(url, {
    timeoutMs: 8000,
    retries: 1,
    cacheTtlMs: 60_000,
    headers: apiFootballAuthHeaders(),
  });

  if (!res.ok || !res.data) {
    return {
      ok: false,
      status: 'error',
      httpStatus: res.httpStatus,
      latencyMs: res.latencyMs,
      hasApiKey: true,
      matches: [],
      standings: [],
      errorCode: res.error || 'NETWORK_ERROR',
      messageAr: 'تعذر جلب بيانات API-Football حاليًا.',
    };
  }

  const errorsObj = res.data.errors;
  if (
    errorsObj &&
    ((Array.isArray(errorsObj) && errorsObj.length > 0) ||
      (!Array.isArray(errorsObj) && Object.keys(errorsObj).length > 0))
  ) {
    const errMsg = Array.isArray(errorsObj)
      ? errorsObj.join(', ')
      : Object.values(errorsObj).join(', ');
    return {
      ok: false,
      status: 'degraded',
      httpStatus: res.httpStatus,
      latencyMs: res.latencyMs,
      hasApiKey: true,
      matches: [],
      standings: [],
      errorCode: 'API_FOOTBALL_API_ERROR',
      messageAr: `رد API-Football: ${errMsg}`,
    };
  }

  const items = res.data.response || [];
  const matches: MatchRecord[] = items
    .map((item) => mapApiFootballFixtureItem(item))
    .filter((match): match is MatchRecord => match !== null);

  let standings: CompetitionStandingTable[] = [];
  if (options.includeLeague && options.season) {
    const table = await fetchApiFootballStandings(API_FOOTBALL_EGYPT_LEAGUE_ID, options.season);
    if (table) standings = [table];
  }

  return {
    ok: true,
    status: 'active',
    httpStatus: res.httpStatus,
    latencyMs: res.latencyMs,
    hasApiKey: true,
    matches,
    standings,
    messageAr: `تم جلب ${matches.length} مباراة${standings.length ? ' وجدول ترتيب الدوري المصري' : ''} من API-Football بنجاح.`,
  };
}

/**
 * Whole-competition fixture list (`league` + `season`). This is what makes the Egyptian matchday
 * complete instead of limited to whatever a single day query returns.
 */
export async function fetchApiFootballLeagueFixtures(
  leagueId: number,
  season: number,
  options: { round?: string; timeoutMs?: number } = {}
): Promise<{ ok: boolean; matches: MatchRecord[]; httpStatus: number | null; latencyMs: number; error?: string }> {
  const key = apiFootballKey();
  if (!key) return { ok: false, matches: [], httpStatus: null, latencyMs: 0, error: 'MISSING_API_FOOTBALL_KEY' };
  const params = new URLSearchParams({ league: String(leagueId), season: String(season) });
  if (options.round) params.set('round', options.round);
  const res = await fetchWithProtection<ApiFootballEnvelope<ApiFootballFixtureItem[]>>(
    `${API_FOOTBALL_BASE_URL}/fixtures?${params.toString()}`,
    {
      timeoutMs: options.timeoutMs ?? 10_000,
      retries: 1,
      cacheTtlMs: 5 * 60_000,
      headers: apiFootballAuthHeaders(),
    }
  );
  if (!res.ok || !res.data) {
    return { ok: false, matches: [], httpStatus: res.httpStatus, latencyMs: res.latencyMs, error: res.error || 'network_error' };
  }
  const items = res.data.response || [];
  return {
    ok: true,
    matches: items.map(mapApiFootballFixtureItem).filter((m): m is MatchRecord => m !== null),
    httpStatus: res.httpStatus,
    latencyMs: res.latencyMs,
  };
}

export interface ApiFootballStandingsRow {
  rank: number;
  team: { id: number; name: string; logo?: string | null };
  points: number;
  goalsDiff: number;
  group?: string | null;
  all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
  description?: string | null;
}

/** League table for one competition/season. */
export async function fetchApiFootballStandings(
  leagueId: number,
  season: number
): Promise<CompetitionStandingTable | null> {
  const key = apiFootballKey();
  if (!key) return null;
  const res = await fetchWithProtection<
    ApiFootballEnvelope<Array<{ league: { id: number; name: string; logo?: string | null; season: number; standings: ApiFootballStandingsRow[][] } }>>
  >(`${API_FOOTBALL_BASE_URL}/standings?league=${leagueId}&season=${season}`, {
    timeoutMs: 9000,
    retries: 1,
    cacheTtlMs: 10 * 60_000,
    headers: apiFootballAuthHeaders(),
  });
  const payload = res.data?.response?.[0];
  if (!res.ok || !payload) return null;

  const comp = resolveCompetitionByMeta({ nameEn: payload.league.name, apiFootballId: payload.league.id });
  const rows: StandingRowRecord[] = [];
  for (const group of payload.league.standings || []) {
    for (const row of group || []) {
      const eq = resolveEgyptianTeam(row.team.name);
      rows.push({
        position: row.rank,
        teamId: eq?.id || `team-apif-${row.team.id}`,
        teamNameAr: eq?.nameAr || translateTeamNameAr(row.team.name),
        teamNameEn: row.team.name,
        teamLogo: row.team.logo || eq?.logoUrl || null,
        played: row.all.played,
        won: row.all.win,
        drawn: row.all.draw,
        lost: row.all.lose,
        goalsFor: row.all.goals.for,
        goalsAgainst: row.all.goals.against,
        goalDiff: row.goalsDiff,
        points: row.points,
        noteAr: row.description || row.group || null,
      });
    }
  }
  if (rows.length === 0) return null;

  return {
    competitionCode: comp.code,
    competitionNameAr: comp.nameAr,
    competitionNameEn: comp.nameEn,
    competitionLogo: payload.league.logo || comp.logoUrl,
    seasonLabel: String(payload.league.season),
    sourceId: 'api-football',
    updatedAt: new Date().toISOString(),
    nemoCompetitionUrl: comp.nemoCompetitionSlug ? `${NEMO_SPORTS_BASE_URL}/competitions/${comp.nemoCompetitionSlug}` : null,
    rows,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  استعادة مباراة واحدة بمعرّف الـ fixture (استهداف مباشر — بلا مزامنة كاملة)
 * ═══════════════════════════════════════════════════════════════════════════════
 * تُستخدم عندما يطلب الزائر `/matches/match-api-football-<id>` ولم يكن السجل بعد في
 * مخزن هذه النسخة: نداء `GET /fixtures?id=` واحد يعيد المباراة (الحالة والنتيجة
 * والملعب) فتُخزَّن وتُعرض فورًا — بدل صفحة 404 ل مباراة موجودة لدى المزوّد.
 */
export async function fetchApiFootballFixtureById(
  fixtureId: string,
  options: { timeoutMs?: number } = {}
): Promise<MatchRecord | null> {
  const trimmed = (fixtureId || '').trim();
  if (!/^\d+$/.test(trimmed)) return null;
  if (!apiFootballKey()) return null;
  try {
    const res = await fetchWithProtection<ApiFootballEnvelope<ApiFootballFixtureItem[]>>(
      `${API_FOOTBALL_BASE_URL}/fixtures?id=${encodeURIComponent(trimmed)}`,
      {
        timeoutMs: options.timeoutMs ?? 8000,
        retries: 0,
        cacheTtlMs: 5 * 60_000,
        headers: apiFootballAuthHeaders(),
      }
    );
    if (!res.ok || !res.data) return null;
    const item = Array.isArray(res.data.response) ? res.data.response[0] : null;
    if (!item) return null;
    return mapApiFootballFixtureItem(item);
  } catch {
    // استعادة المعرّف مساعدة اختيارية: أي فشل يعني فقط عودة الصفحة لسلوكها الاحتياطي.
    return null;
  }
}
