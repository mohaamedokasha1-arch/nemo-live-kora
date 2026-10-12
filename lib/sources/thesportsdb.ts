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
import { resolveNemoSportsLink } from '../nemo-resolver';
import { getStableMatchId } from '../match-identity';
import { MatchRecord } from '../types';
import { fetchWithProtection } from './http-client';

const THESPORTSDB_BASE_URL =
  process.env.THESPORTSDB_BASE_URL || 'https://www.thesportsdb.com/api/v1/json';
const THESPORTSDB_API_KEY = process.env.THESPORTSDB_API_KEY || '3';

export interface TheSportsDBRawEvent {
  idEvent: string;
  idAPIfootball?: string | null;
  strEvent: string;
  strSeason?: string | null;
  idLeague: string;
  strLeague: string;
  strLeagueBadge?: string | null;
  strHomeTeam: string;
  strAwayTeam: string;
  idHomeTeam?: string | null;
  idAwayTeam?: string | null;
  intRound?: string | null;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
  strTimestamp?: string | null;
  dateEvent: string;
  strTime?: string | null;
  strHomeTeamBadge?: string | null;
  strAwayTeamBadge?: string | null;
  strVenue?: string | null;
  strCountry?: string | null;
  strStatus?: string | null;
  strPostponed?: string | null;
}

export interface TheSportsDBEventsEnvelope {
  events?: TheSportsDBRawEvent[] | null;
  results?: TheSportsDBRawEvent[] | null;
}

/**
 * Normalizes a raw TheSportsDB event into our canonical MatchRecord.
 */
export function mapTheSportsDBEventToRecord(raw: TheSportsDBRawEvent): MatchRecord {
  const comp = resolveCompetitionByMeta({
    nameEn: raw.strLeague,
    thesportsdbId: raw.idLeague,
    countryEn: raw.strCountry || undefined,
  });

  const homeEq =
    resolveEgyptianTeam(raw.idHomeTeam || '') || resolveEgyptianTeam(raw.strHomeTeam);
  const awayEq =
    resolveEgyptianTeam(raw.idAwayTeam || '') || resolveEgyptianTeam(raw.strAwayTeam);

  const homeId =
    homeEq?.id ||
    (raw.idHomeTeam
      ? `team-tsdb-${raw.idHomeTeam}`
      : `team-tsdb-${raw.strHomeTeam.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  const awayId =
    awayEq?.id ||
    (raw.idAwayTeam
      ? `team-tsdb-${raw.idAwayTeam}`
      : `team-tsdb-${raw.strAwayTeam.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);

  // Parse UTC kickoff timestamp safely
  let utcIso: string;
  if (raw.strTimestamp && raw.strTimestamp.includes('T')) {
    const cleanTs = raw.strTimestamp.endsWith('Z') || raw.strTimestamp.includes('+')
      ? raw.strTimestamp
      : `${raw.strTimestamp}Z`;
    const parsed = new Date(cleanTs);
    utcIso = !Number.isNaN(parsed.getTime())
      ? parsed.toISOString()
      : `${raw.dateEvent}T${raw.strTime || '16:00:00'}Z`;
  } else {
    utcIso = `${raw.dateEvent}T${raw.strTime || '16:00:00'}Z`;
  }

  const cairoDate = toCairoDateString(utcIso);
  const cairoTime = toCairoTimeArabic(utcIso);

  const effectiveRawStatus =
    raw.strPostponed?.toLowerCase() === 'yes' ? 'PST' : raw.strStatus;
  const normStatus = normalizeMatchStatus(effectiveRawStatus, raw.strStatus, utcIso);

  const externalIds = {
    thesportsdbEventId: raw.idEvent,
    apiFootballFixtureId: raw.idAPIfootball || undefined,
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

  // Link only to a direct match page explicitly mapped to this source fixture id.
  const nemoLink = resolveNemoSportsLink({
    canonicalMatchId: canonicalId,
    thesportsdbEventId: raw.idEvent,
    apiFootballFixtureId: raw.idAPIfootball || null,
    competitionCode: comp.code,
    homeTeamId: homeId,
    awayTeamId: awayId,
    cairoDate,
  });

  return {
    id: canonicalId,
    competitionId: comp.id,
    competitionCode: comp.code,
    competitionNameAr: comp.nameAr,
    competitionNameEn: comp.nameEn,
    competitionLogo: raw.strLeagueBadge || comp.logoUrl,
    countryAr: comp.countryAr,
    region: comp.region,
    priority: isEgyptianInterest ? Math.min(comp.priority, 19) : comp.priority,
    isEgyptianInterest,
    seasonLabel: raw.strSeason || comp.currentSeason,
    roundLabelAr: raw.intRound ? `الجولة ${raw.intRound}` : null,
    utcKickoff: utcIso,
    cairoDate,
    cairoTime,
    homeTeam: {
      id: homeId,
      nameAr: homeEq?.nameAr || translateTeamNameAr(raw.strHomeTeam),
      nameEn: homeEq?.nameEn || raw.strHomeTeam,
      logoUrl: resolveVerifiedTeamLogo(raw.strHomeTeam, raw.strHomeTeamBadge),
      isEgyptian: Boolean(homeEq?.isEgyptian),
      nemoTeamUrl:
        homeEq?.nemoTeamUrl ||
        `${NEMO_SPORTS_BASE_URL}/teams/${encodeURIComponent(raw.strHomeTeam)}`,
    },
    awayTeam: {
      id: awayId,
      nameAr: awayEq?.nameAr || translateTeamNameAr(raw.strAwayTeam),
      nameEn: awayEq?.nameEn || raw.strAwayTeam,
      logoUrl: resolveVerifiedTeamLogo(raw.strAwayTeam, raw.strAwayTeamBadge),
      isEgyptian: Boolean(awayEq?.isEgyptian),
      nemoTeamUrl:
        awayEq?.nemoTeamUrl ||
        `${NEMO_SPORTS_BASE_URL}/teams/${encodeURIComponent(raw.strAwayTeam)}`,
    },
    status: normStatus.status,
    statusLabelAr: normStatus.statusLabelAr,
    statusNoteAr: normStatus.statusNoteAr,
    liveMinute: null,
    score: {
      home: parseNullableScore(raw.intHomeScore),
      away: parseNullableScore(raw.intAwayScore),
    },
    venue: raw.strVenue || homeEq?.stadium || null,
    primarySource: 'thesportsdb',
    contributingSources: ['thesportsdb'],
    externalIds,
    nemoLink,
    lastUpdatedAt: new Date().toISOString(),
  };
}

export interface TheSportsDBEndpointResult {
  endpoint: string;
  labelAr: string;
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  fromCache: boolean;
  eventsCount: number;
  error?: string;
}

/**
 * Competitions followed automatically on TheSportsDB (free v1 key `3`).
 * `eventsnextleague.php` (next 15 fixtures) and `eventspastleague.php` (last 15 results)
 * follow the calendar on their own, unlike a hard-coded round number that silently goes
 * stale once the round is played. Both endpoints are documented for the free tier.
 */
export const THESPORTSDB_FOLLOWED_LEAGUES: Array<{ id: string; labelAr: string }> = [
  { id: '4829', labelAr: 'الدوري المصري الممتاز' },
  { id: '4830', labelAr: 'كأس مصر' },
  { id: '5185', labelAr: 'كأس الرابطة المصرية' },
  { id: '5057', labelAr: 'كأس الكونفدرالية الأفريقية' },
];

/**
 * Builds the endpoint list for one sync run: next/past fixtures for each followed league
 * plus the per-day listing for yesterday/today/tomorrow (Cairo). Exported for tests.
 */
export function buildTheSportsDBEndpoints(dates: string[]): Array<{ url: string; labelAr: string }> {
  const base = `${THESPORTSDB_BASE_URL}/${THESPORTSDB_API_KEY}`;
  const leagueUrls = THESPORTSDB_FOLLOWED_LEAGUES.flatMap((league) => [
    { url: `${base}/eventsnextleague.php?id=${league.id}`, labelAr: `${league.labelAr} — المباريات القادمة` },
    { url: `${base}/eventspastleague.php?id=${league.id}`, labelAr: `${league.labelAr} — آخر النتائج` },
  ]);
  const dayUrls = dates.slice(0, 3).map((d) => ({
    url: `${base}/eventsday.php?d=${encodeURIComponent(d)}&s=Soccer`,
    labelAr: `مباريات يوم ${d}`,
  }));
  return [...leagueUrls, ...dayUrls];
}

/**
 * Fetches the followed Egyptian/African competitions (next fixtures + latest results) and the
 * daily soccer listing from TheSportsDB v1 JSON API. Every endpoint is reported individually
 * so the sync log shows exactly which calls succeeded, were rate-limited, or failed.
 */
export async function fetchTheSportsDBMatches(dates: string[]): Promise<{
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  matches: MatchRecord[];
  endpoints: TheSportsDBEndpointResult[];
  error?: string;
}> {
  const endpoints = buildTheSportsDBEndpoints(dates);

  const collected: MatchRecord[] = [];
  const seenEventIds = new Set<string>();
  const results: TheSportsDBEndpointResult[] = [];
  let anyOk = false;
  let lastStatus: number | null = null;
  let totalLatency = 0;
  let lastError: string | undefined;

  for (const endpoint of endpoints) {
    const res = await fetchWithProtection<TheSportsDBEventsEnvelope>(endpoint.url, {
      timeoutMs: 7000,
      retries: 1,
      cacheTtlMs: 3 * 60_000,
    });
    totalLatency += res.latencyMs;
    if (res.httpStatus) lastStatus = res.httpStatus;

    let eventsCount = 0;
    if (res.ok && res.data) {
      anyOk = true;
      const list = res.data.events || res.data.results || [];
      for (const ev of list) {
        if (ev && ev.idEvent && ev.strHomeTeam && ev.strAwayTeam && !seenEventIds.has(ev.idEvent)) {
          seenEventIds.add(ev.idEvent);
          collected.push(mapTheSportsDBEventToRecord(ev));
          eventsCount += 1;
        }
      }
    } else if (res.error) {
      lastError = res.error;
    }

    results.push({
      endpoint: endpoint.url.replace(`${THESPORTSDB_BASE_URL}/${THESPORTSDB_API_KEY}`, ''),
      labelAr: endpoint.labelAr,
      ok: res.ok,
      httpStatus: res.httpStatus,
      latencyMs: res.latencyMs,
      fromCache: res.fromCache,
      eventsCount,
      error: res.ok ? undefined : res.error || `HTTP ${res.httpStatus ?? 'n/a'}`,
    });
  }

  return {
    ok: anyOk,
    httpStatus: lastStatus,
    latencyMs: totalLatency,
    matches: collected,
    endpoints: results,
    error: anyOk ? undefined : lastError || 'Failed to reach TheSportsDB endpoints',
  };
}
