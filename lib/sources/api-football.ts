import {
  normalizeMatchStatus,
  parseNullableScore,
  toCairoDateString,
  toCairoTimeArabic,
} from '../cairo-time';
import {
  resolveCompetitionByMeta,
  resolveEgyptianTeam,
  translateTeamNameAr,
} from '../catalog';
import { resolveNemoSportsLink } from '../nemo-resolver';
import { getStableMatchId } from '../match-identity';
import { MatchRecord, SourceHealthStatus } from '../types';
import { fetchWithProtection } from './http-client';

const API_FOOTBALL_BASE_URL =
  process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';

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
export async function fetchApiFootballSync(cairoDate: string): Promise<{
  ok: boolean;
  status: SourceHealthStatus;
  httpStatus: number | null;
  latencyMs: number;
  hasApiKey: boolean;
  matches: MatchRecord[];
  messageAr: string;
  errorCode?: string;
}> {
  const apiKey = (process.env.API_FOOTBALL_KEY || '').trim();
  const hasApiKey = apiKey.length > 0;

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
    headers: {
      'x-apisports-key': apiKey,
    },
  });

  if (!res.ok || !res.data) {
    return {
      ok: false,
      status: 'error',
      httpStatus: res.httpStatus,
      latencyMs: res.latencyMs,
      hasApiKey: true,
      matches: [],
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
      errorCode: 'API_FOOTBALL_API_ERROR',
      messageAr: `رد API-Football: ${errMsg}`,
    };
  }

  const items = res.data.response || [];
  const matches: MatchRecord[] = items.map((item) => {
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
        nameAr: homeEq?.nameAr || translateTeamNameAr(item.teams.home.name),
        nameEn: item.teams.home.name,
        logoUrl: item.teams.home.logo || homeEq?.logoUrl || null,
        isEgyptian: Boolean(homeEq),
      },
      awayTeam: {
        id: awayId,
        nameAr: awayEq?.nameAr || translateTeamNameAr(item.teams.away.name),
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
  });

  return {
    ok: true,
    status: 'active',
    httpStatus: res.httpStatus,
    latencyMs: res.latencyMs,
    hasApiKey: true,
    matches,
    messageAr: `تم جلب ${matches.length} مباراة من API-Football بنجاح.`,
  };
}
