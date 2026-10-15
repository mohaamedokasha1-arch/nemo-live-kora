import {
  normalizeMatchStatus,
  parseNullableScore,
  toCairoDateString,
  toCairoTimeArabic,
} from '../cairo-time';
import {
  resolveCompetitionByMeta,
  resolveEgyptianTeam,
  resolveTeamNameFromSource,
} from '../catalog';
import { resolveNemoSportsLink } from '../nemo-resolver';
import { getStableMatchId } from '../match-identity';
import { CompetitionRecord, MatchRecord, SeasonRecord, SourceHealthStatus } from '../types';
import { fetchWithProtection } from './http-client';

const FOOTBALL_DATA_BASE_URL =
  process.env.FOOTBALL_DATA_BASE_URL || 'https://api.football-data.org/v4';

export interface FootballDataCompetitionRaw {
  id: number;
  name: string;
  code: string | null;
  type: string;
  emblem: string | null;
  area?: {
    name: string;
    code?: string;
    flag?: string | null;
  };
  currentSeason?: {
    id: number;
    startDate: string;
    endDate: string;
    currentMatchday: number | null;
  } | null;
}

export interface FootballDataCompetitionsEnvelope {
  count: number;
  competitions: FootballDataCompetitionRaw[];
}

export interface FootballDataMatchesEnvelope {
  resultSet?: {
    count: number;
    permission?: string | null;
  };
  matches?: Array<{
    id: number;
    utcDate: string;
    status: string;
    matchday?: number | null;
    competition: {
      id: number;
      name: string;
      code: string;
      emblem?: string | null;
    };
    homeTeam: {
      id: number;
      name: string;
      shortName?: string;
      crest?: string | null;
    };
    awayTeam: {
      id: number;
      name: string;
      shortName?: string;
      crest?: string | null;
    };
    score?: {
      fullTime?: {
        home: number | null;
        away: number | null;
      };
      halfTime?: {
        home: number | null;
        away: number | null;
      };
    };
  }>;
}

/**
 * Fetches Football-Data.org v4 competitions (works without an API key!)
 * and, when FOOTBALL_DATA_API_KEY is configured, also fetches matches by date range.
 */
export async function fetchFootballDataSync(dateFrom?: string, dateTo?: string): Promise<{
  ok: boolean;
  status: SourceHealthStatus;
  httpStatus: number | null;
  latencyMs: number;
  competitions: CompetitionRecord[];
  seasons: SeasonRecord[];
  matches: MatchRecord[];
  hasApiKey: boolean;
  messageAr: string;
  error?: string;
}> {
  const apiKey = (process.env.FOOTBALL_DATA_API_KEY || '').trim();
  const hasApiKey = apiKey.length > 0;
  const headers: Record<string, string> = {};
  if (hasApiKey) {
    headers['X-Auth-Token'] = apiKey;
  }

  const compRes = await fetchWithProtection<FootballDataCompetitionsEnvelope>(
    `${FOOTBALL_DATA_BASE_URL}/competitions`,
    {
      timeoutMs: 8000,
      retries: 1,
      cacheTtlMs: 30 * 60_000,
      headers,
    }
  );

  const competitions: CompetitionRecord[] = [];
  const seasons: SeasonRecord[] = [];
  if (compRes.ok && compRes.data?.competitions) {
    for (const c of compRes.data.competitions) {
      if (!c.code) continue;
      const comp = resolveCompetitionByMeta({
        nameEn: c.name,
        footballDataCode: c.code,
        countryEn: c.area?.name,
      });
      competitions.push({ ...comp, logoUrl: c.emblem || comp.logoUrl, currentSeason: c.currentSeason ? `${c.currentSeason.startDate.slice(0, 4)}/${c.currentSeason.endDate.slice(0, 4)}` : '' });
      if (!c.currentSeason) continue;
      seasons.push({
        id: `season-fd-${c.code}-${c.currentSeason.id}`,
        competitionId: comp.id,
        competitionCode: comp.code,
        label: `${c.currentSeason.startDate.slice(0, 4)}/${c.currentSeason.endDate.slice(0, 4)}`,
        startDate: c.currentSeason.startDate,
        endDate: c.currentSeason.endDate,
        currentMatchday: c.currentSeason.currentMatchday,
        sourceId: 'football-data',
      });
    }
  }

  const matches: MatchRecord[] = [];
  let matchFailure: { httpStatus: number | null; latencyMs: number; error: string } | null = null;
  if (hasApiKey && dateFrom && dateTo) {
    const matchUrl = `${FOOTBALL_DATA_BASE_URL}/matches?dateFrom=${encodeURIComponent(
      dateFrom
    )}&dateTo=${encodeURIComponent(dateTo)}`;
    const matchRes = await fetchWithProtection<FootballDataMatchesEnvelope>(matchUrl, {
      timeoutMs: 8000,
      retries: 1,
      cacheTtlMs: 60_000,
      headers,
    });

    if (!matchRes.ok || !Array.isArray(matchRes.data?.matches)) matchFailure = { httpStatus: matchRes.httpStatus, latencyMs: matchRes.latencyMs, error: matchRes.error || 'invalid_matches_payload' };
    if (matchRes.ok && Array.isArray(matchRes.data?.matches)) {
      for (const m of matchRes.data.matches) {
        const comp = resolveCompetitionByMeta({
          nameEn: m.competition.name,
          footballDataCode: m.competition.code,
        });
        const homeEq = resolveEgyptianTeam(m.homeTeam.name);
        const awayEq = resolveEgyptianTeam(m.awayTeam.name);
        const homeId = homeEq?.id || `team-fd-${m.homeTeam.id}`;
        const awayId = awayEq?.id || `team-fd-${m.awayTeam.id}`;
        const cairoDate = toCairoDateString(m.utcDate);
        const cairoTime = toCairoTimeArabic(m.utcDate);
        const normStatus = normalizeMatchStatus(m.status, m.status, m.utcDate);
        const externalIds = {
          footballDataMatchId: String(m.id),
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

        matches.push({
          id: canonicalId,
          competitionId: comp.id,
          competitionCode: comp.code,
          competitionNameAr: comp.nameAr,
          competitionNameEn: comp.nameEn,
          competitionLogo: m.competition.emblem || comp.logoUrl,
          countryAr: comp.countryAr,
          region: comp.region,
          priority: comp.priority,
          isEgyptianInterest: Boolean(comp.isEgyptianPriority || homeEq || awayEq),
          seasonLabel: comp.currentSeason,
          roundLabelAr: m.matchday ? `الجولة ${m.matchday}` : null,
          utcKickoff: m.utcDate,
          kickoffConfirmed: true,
          cairoDate,
          cairoTime,
          homeTeam: {
            id: homeId,
            nameAr: homeEq?.nameAr || resolveTeamNameFromSource(m.homeTeam.name, homeId).nameAr,
            nameEn: m.homeTeam.name,
            logoUrl: m.homeTeam.crest || homeEq?.logoUrl || null,
            isEgyptian: Boolean(homeEq),
          },
          awayTeam: {
            id: awayId,
            nameAr: awayEq?.nameAr || resolveTeamNameFromSource(m.awayTeam.name, awayId).nameAr,
            nameEn: m.awayTeam.name,
            logoUrl: m.awayTeam.crest || awayEq?.logoUrl || null,
            isEgyptian: Boolean(awayEq),
          },
          status: normStatus.status,
          statusLabelAr: normStatus.statusLabelAr,
          statusNoteAr: normStatus.statusNoteAr,
          liveMinute: null,
          score: {
            home: parseNullableScore(m.score?.fullTime?.home),
            away: parseNullableScore(m.score?.fullTime?.away),
            halfTimeHome: parseNullableScore(m.score?.halfTime?.home),
            halfTimeAway: parseNullableScore(m.score?.halfTime?.away),
          },
          venue: null,
          primarySource: 'football-data',
          contributingSources: ['football-data'],
          externalIds,
          nemoLink: resolveNemoSportsLink({
            canonicalMatchId: canonicalId,
            competitionCode: comp.code,
            homeTeamId: homeId,
            awayTeamId: awayId,
            cairoDate,
          }),
          lastUpdatedAt: new Date().toISOString(),
        });
      }
    }
  }

  if (matchFailure) return { ok: false, status: 'degraded', ...matchFailure, competitions, seasons, matches, hasApiKey, messageAr: 'فشل مسار مباريات Football-Data؛ نجاح فهرس البطولات لا يثبت جلب المباريات.' };

  if (!compRes.ok) {
    return {
      ok: false,
      status: 'error',
      httpStatus: compRes.httpStatus,
      latencyMs: compRes.latencyMs,
      competitions: [],
      seasons: [],
      matches: [],
      hasApiKey,
      messageAr: 'تعذر الاتصال المباشر بـ Football-Data.org في هذه البيئة؛ يتم استخدام البيانات المخزنة الموثقة.',
      error: compRes.error,
    };
  }

  return {
    ok: true,
    status: hasApiKey ? 'active' : 'partial_keyless',
    httpStatus: compRes.httpStatus,
    latencyMs: compRes.latencyMs,
    competitions,
    seasons,
    matches,
    hasApiKey,
    messageAr: hasApiKey
      ? `تم جلب ${seasons.length} موسمًا و${matches.length} مباراة من Football-Data.org`
      : `تم جلب ${seasons.length} بطولة وموسم بنجاح من /v4/competitions بدون مفتاح؛ مسار /v4/matches يتطلب FOOTBALL_DATA_API_KEY`,
  };
}
