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
/**
 * Free-tier key. TheSportsDB documents `123` as its free key; `3` is kept as the historical
 * default so existing deployments keep working. Set THESPORTSDB_API_KEY to override.
 */
const THESPORTSDB_API_KEY = process.env.THESPORTSDB_API_KEY || '3';

export interface TheSportsDBRawEvent {
  idEvent: string;
  idAPIfootball?: string | null;
  strEvent: string;
  strSport?: string | null;
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_WITH_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Kick-off time for a TheSportsDB event. `strTimestamp` is UTC without a suffix. When it is
 * missing or invalid, the time is NOT guessed (the old `dateEvent + T16:00Z` fallback is gone):
 * the match keeps its calendar day, anchored at 00:00 UTC, and is flagged `confirmed: false`.
 * Returns null when even the date is unusable.
 */
export function resolveTheSportsDBKickoff(
  raw: Pick<TheSportsDBRawEvent, 'strTimestamp' | 'dateEvent'>
): { utcIso: string; confirmed: boolean } | null {
  const ts = (raw.strTimestamp || '').trim();
  if (TIMESTAMP_WITH_TIME.test(ts)) {
    const withZone = /(Z|[+-]\d{2}:?\d{2})$/.test(ts) ? ts : `${ts}Z`;
    const parsed = new Date(withZone);
    if (!Number.isNaN(parsed.getTime())) {
      return { utcIso: parsed.toISOString(), confirmed: true };
    }
  }
  const day = (raw.dateEvent || '').trim();
  if (!ISO_DATE.test(day)) return null;
  const anchor = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(anchor.getTime())) return null;
  return { utcIso: anchor.toISOString(), confirmed: false };
}

/** Why a raw TheSportsDB event is not turned into a match record (null = accepted). */
export function theSportsDBSkipReason(raw: TheSportsDBRawEvent): string | null {
  if (!raw || !raw.idEvent || !raw.strHomeTeam || !raw.strAwayTeam) return 'incomplete';
  if (raw.strSport && raw.strSport.trim().toLowerCase() !== 'soccer') return 'not_soccer';
  if (THESPORTSDB_EXCLUDED_LEAGUE_IDS.has(String(raw.idLeague))) return 'excluded_league';
  if (!resolveTheSportsDBKickoff(raw)) return 'invalid_date';
  return null;
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

  const kickoff = resolveTheSportsDBKickoff(raw);
  if (!kickoff) {
    throw new Error(`TheSportsDB event ${raw.idEvent} has no usable date`);
  }
  const utcIso = kickoff.utcIso;
  const kickoffConfirmed = kickoff.confirmed;

  const cairoDate = toCairoDateString(utcIso);
  const cairoTime = kickoffConfirmed ? toCairoTimeArabic(utcIso) : 'الموعد غير مؤكد';

  const effectiveRawStatus =
    raw.strPostponed?.toLowerCase() === 'yes' ? 'PST' : raw.strStatus;
  const normStatus = normalizeMatchStatus(effectiveRawStatus, raw.strStatus, utcIso);
  const unconfirmedStatus = !kickoffConfirmed && normStatus.status === 'not_started';
  const unconfirmedLive = !kickoffConfirmed && normStatus.status === 'live';

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
    kickoffConfirmed,
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
    status: unconfirmedStatus || unconfirmedLive ? 'unconfirmed' : normStatus.status,
    statusLabelAr:
      unconfirmedStatus || unconfirmedLive
        ? 'الموعد غير مؤكد من المصدر'
        : normStatus.statusLabelAr,
    statusNoteAr:
      unconfirmedStatus || unconfirmedLive
        ? 'لم يرسل المصدر موعد انطلاق لهذه المباراة، لذلك لا نعرض حالتها كمباراة لم تبدأ أو جارية.'
        : normStatus.statusNoteAr,
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
 * Competitions followed on TheSportsDB (free v1 key).
 *
 * - 4829 Egyptian Premier League: verified (strLeague "Egyptian Premier League").
 * - 5185 Egypt League Cup: verified.
 * - 5057 CAF Confederation Cup: verified.
 *
 * Egypt Cup (4830) is NOT followed: TheSportsDB returns "Korean KBO League" (baseball) for
 * that id, so it would put baseball into the soccer schedule. No verified TheSportsDB soccer
 * id for the Egypt Cup was found (`search_all_leagues.php?c=Egypt` lists only 4829 and 5185).
 */
export const THESPORTSDB_FOLLOWED_LEAGUES: Array<{ id: string; labelAr: string }> = [
  { id: '4829', labelAr: 'الدوري المصري الممتاز' },
  { id: '5185', labelAr: 'كأس الرابطة المصرية' },
  { id: '5057', labelAr: 'كأس الكونفدرالية الأفريقية' },
];

/** League ids that must never enter the soccer schedule, with the reason. */
export const THESPORTSDB_EXCLUDED_LEAGUE_IDS = new Set<string>(['4830']);

/** Egyptian league (4829) round-by-round fetch: season label and round numbers. */
export interface TheSportsDBRoundWindow {
  season: string;
  rounds: number[];
}

/**
 * Builds the endpoint list for one sync run, in priority order:
 * 1. Egyptian league rounds (`eventsround.php`). This is the only free call that returns a
 *    whole round (the free key returns 1 event for next/past league calls and 3 for day calls).
 * 2. Next/past fixtures for each followed league (1 event each on the free key).
 * 3. Per-day soccer listing for yesterday/today/tomorrow (3 events each on the free key).
 * Exported for tests.
 */
export function buildTheSportsDBEndpoints(
  dates: string[],
  rounds?: TheSportsDBRoundWindow | null
): Array<{ url: string; labelAr: string }> {
  const base = `${THESPORTSDB_BASE_URL}/${THESPORTSDB_API_KEY}`;
  const roundUrls = (rounds?.rounds || []).map((r) => ({
    url: `${base}/eventsround.php?id=4829&r=${r}&s=${encodeURIComponent(rounds!.season)}`,
    labelAr: `الدوري المصري الممتاز — الجولة ${r}`,
  }));
  const leagueUrls = THESPORTSDB_FOLLOWED_LEAGUES.flatMap((league) => [
    { url: `${base}/eventsnextleague.php?id=${league.id}`, labelAr: `${league.labelAr} — المباريات القادمة` },
    { url: `${base}/eventspastleague.php?id=${league.id}`, labelAr: `${league.labelAr} — آخر النتائج` },
  ]);
  const dayUrls = dates.slice(0, 3).map((d) => ({
    url: `${base}/eventsday.php?d=${encodeURIComponent(d)}&s=Soccer`,
    labelAr: `مباريات يوم ${d}`,
  }));
  return [...roundUrls, ...leagueUrls, ...dayUrls];
}

export interface TheSportsDBFetchOptions {
  timeoutMs?: number;
  retries?: number;
  cacheTtlMs?: number;
  /** Total wall-clock budget for this fetch. Endpoints that would start after it are skipped. */
  budgetMs?: number;
  rounds?: TheSportsDBRoundWindow | null;
}

export interface TheSportsDBFetchResult {
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  matches: MatchRecord[];
  endpoints: TheSportsDBEndpointResult[];
  /** Events received but not stored (not soccer, excluded league, incomplete, bad date). */
  skippedRecords: number;
  /** Endpoints not requested because the time budget was used up. */
  skippedEndpoints: number;
  error?: string;
}

/**
 * Fetches the followed Egyptian/African competitions and the daily soccer listing from the
 * TheSportsDB v1 JSON API. Every endpoint is reported individually so the sync log shows
 * exactly which calls succeeded, were rate-limited, or failed. One bad event never discards
 * the rest of the response.
 */
export async function fetchTheSportsDBMatches(
  dates: string[],
  options: TheSportsDBFetchOptions = {}
): Promise<TheSportsDBFetchResult> {
  const endpoints = buildTheSportsDBEndpoints(dates, options.rounds);
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? Number.POSITIVE_INFINITY;

  const collected: MatchRecord[] = [];
  const seenEventIds = new Set<string>();
  const results: TheSportsDBEndpointResult[] = [];
  let anyOk = false;
  let lastStatus: number | null = null;
  let totalLatency = 0;
  let lastError: string | undefined;
  let skippedRecords = 0;
  let skippedEndpoints = 0;

  for (const endpoint of endpoints) {
    const endpointPath = endpoint.url.replace(`${THESPORTSDB_BASE_URL}/${THESPORTSDB_API_KEY}`, '');
    if (Date.now() - startedAt >= budgetMs) {
      skippedEndpoints += 1;
      lastError = lastError || 'تجاوز الوقت المخصص لهذه المزامنة';
      results.push({
        endpoint: endpointPath,
        labelAr: endpoint.labelAr,
        ok: false,
        httpStatus: null,
        latencyMs: 0,
        fromCache: false,
        eventsCount: 0,
        error: 'skipped: time budget used',
      });
      continue;
    }

    const res = await fetchWithProtection<TheSportsDBEventsEnvelope>(endpoint.url, {
      timeoutMs: options.timeoutMs ?? 7000,
      retries: options.retries ?? 1,
      cacheTtlMs: options.cacheTtlMs ?? 3 * 60_000,
    });
    totalLatency += res.latencyMs;
    if (res.httpStatus) lastStatus = res.httpStatus;

    let eventsCount = 0;
    if (res.ok && res.data) {
      anyOk = true;
      const list = res.data.events || res.data.results || [];
      for (const ev of list) {
        if (!ev || !ev.idEvent || seenEventIds.has(ev.idEvent)) continue;
        const reason = theSportsDBSkipReason(ev);
        if (reason) {
          skippedRecords += 1;
          continue;
        }
        try {
          collected.push(mapTheSportsDBEventToRecord(ev));
          seenEventIds.add(ev.idEvent);
          eventsCount += 1;
        } catch {
          skippedRecords += 1;
        }
      }
    } else if (res.error) {
      lastError = res.error;
    }

    results.push({
      endpoint: endpointPath,
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
    skippedRecords,
    skippedEndpoints,
    error: anyOk ? undefined : lastError || 'Failed to reach TheSportsDB endpoints',
  };
}
