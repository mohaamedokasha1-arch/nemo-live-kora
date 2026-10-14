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

import { SOURCE_ENDPOINTS, THESPORTSDB_LEAGUES, thesportsdbKeyCandidates } from '../config/env';

const THESPORTSDB_BASE_URL = SOURCE_ENDPOINTS.thesportsdbBase;

/**
 * Free-tier keys. TheSportsDB documents `123` as its current free key; `3` is the historical
 * default that still resolves. A premium key set via THESPORTSDB_API_KEY is tried first, and if
 * the provider rejects it the documented free keys are tried in order — so a mistyped premium key
 * degrades to working free data instead of taking the whole Egyptian schedule offline.
 */
const THESPORTSDB_API_KEY = process.env.THESPORTSDB_API_KEY || '123';

export interface TheSportsDBKeyProbe {
  key: string;
  ok: boolean;
  httpStatus: number | null;
  error?: string;
}

let workingKey: string | null = null;
let keyProbes: TheSportsDBKeyProbe[] = [];

/** Keys tried in the most recent run, for the sources dashboard. */
export function thesportsdbKeyProbeLog(): TheSportsDBKeyProbe[] {
  return [...keyProbes];
}

/** The key that will be used for the next run (null until a probe succeeds). */
export function thesportsdbActiveKey(): string | null {
  return workingKey;
}

/** Test hook. */
export function resetTheSportsDBKeyState(): void {
  workingKey = null;
  keyProbes = [];
}

/**
 * Finds a key the provider accepts. `lookupleague.php` is the cheapest call that proves both the
 * key and the Egyptian league id at once. The result is cached per process, so a sync makes one
 * probe, not one per endpoint.
 */
export async function resolveTheSportsDBApiKey(options: {
  timeoutMs?: number;
  force?: boolean;
} = {}): Promise<{ key: string; httpStatus: number | null; probes: TheSportsDBKeyProbe[] }> {
  if (workingKey && !options.force) {
    return { key: workingKey, httpStatus: null, probes: keyProbes };
  }
  const candidates = thesportsdbKeyCandidates();
  const probes: TheSportsDBKeyProbe[] = [];
  for (const key of candidates) {
    const url = `${THESPORTSDB_BASE_URL}/${key}/lookupleague.php?id=${THESPORTSDB_LEAGUES.egyptianPremierLeague}`;
    const res = await fetchWithProtection<{ leagues?: unknown[] }>(url, {
      timeoutMs: options.timeoutMs ?? 6000,
      retries: 0,
      cacheTtlMs: 30 * 60_000,
    });
    const rejected = res.httpStatus === 400 || res.httpStatus === 401 || res.httpStatus === 403;
    if (res.ok && !rejected) {
      probes.push({ key: maskKey(key), ok: true, httpStatus: res.httpStatus });
      workingKey = key;
      keyProbes = probes;
      return { key, httpStatus: res.httpStatus, probes };
    }
    probes.push({
      key: maskKey(key),
      ok: false,
      httpStatus: res.httpStatus,
      error: rejected ? 'key_rejected' : res.error || `HTTP ${res.httpStatus ?? 'n/a'}`,
    });
    // A network failure is not a key problem: stop trying other keys and let the caller report it.
    if (!rejected && res.httpStatus === null) break;
  }
  keyProbes = probes;
  return { key: candidates[0] || THESPORTSDB_API_KEY, httpStatus: null, probes };
}

function maskKey(key: string): string {
  if (key.length <= 3) return key;
  return `${key.slice(0, 2)}${'*'.repeat(Math.max(1, key.length - 3))}${key.slice(-1)}`;
}

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
        ? 'سيُعرض الموعد الرسمي فور إعلانه.'
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
  { id: THESPORTSDB_LEAGUES.egyptianPremierLeague, labelAr: 'الدوري المصري الممتاز' },
  { id: THESPORTSDB_LEAGUES.egyptLeagueCup, labelAr: 'كأس الرابطة المصرية' },
  { id: THESPORTSDB_LEAGUES.cafConfederationCup, labelAr: 'كأس الكونفدرالية الأفريقية' },
];

/** League ids that must never enter the soccer schedule, with the reason. */
export const THESPORTSDB_EXCLUDED_LEAGUE_IDS = new Set<string>(THESPORTSDB_LEAGUES.excludedLeagueIds);

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
  rounds?: TheSportsDBRoundWindow | null,
  apiKey: string = THESPORTSDB_API_KEY,
  /**
   * أقصى عدد من طلبات `eventsday.php` (طلب واحد لكل يوم). الافتراضي 3 للتوافق مع المسار السريع؛
   * المزامنة المجدولة تمرّر كل أيام النافذة. لم يعد هذا الحد يُسقط الأيام بصمت: الأيام الزائدة
   * تُسجَّل في السجل بعد الجلب (انظر `dayCallsSkipped` في الاستجابة).
   */
  maxDayCalls = 3
): Array<{ url: string; labelAr: string; kind: 'round' | 'season' | 'league' | 'day' }> {
  const base = `${THESPORTSDB_BASE_URL}/${apiKey}`;
  const leagueId = THESPORTSDB_LEAGUES.egyptianPremierLeague;
  const season = rounds?.season;
  const roundUrls = (rounds?.rounds || []).map((r) => ({
    url: `${base}/eventsround.php?id=${leagueId}&r=${r}&s=${encodeURIComponent(rounds!.season)}`,
    labelAr: `الدوري المصري الممتاز — الجولة ${r}`,
    kind: 'round' as const,
  }));
  // Whole-season listing: the fallback that still works when `eventsround.php` returns 404 for a
  // premium key (documented provider behaviour), and the only call that yields every round.
  const seasonUrls = season
    ? [{
        url: `${base}/eventsseason.php?id=${leagueId}&s=${encodeURIComponent(season)}`,
        labelAr: `الدوري المصري الممتاز — موسم ${season} كاملًا`,
        kind: 'season' as const,
      }]
    : [];
  const leagueUrls = THESPORTSDB_FOLLOWED_LEAGUES.flatMap((league) => [
    { url: `${base}/eventsnextleague.php?id=${league.id}`, labelAr: `${league.labelAr} — المباريات القادمة`, kind: 'league' as const },
    { url: `${base}/eventspastleague.php?id=${league.id}`, labelAr: `${league.labelAr} — آخر النتائج`, kind: 'league' as const },
  ]);
  const dayUrls = dates.slice(0, Math.max(0, maxDayCalls)).map((d) => ({
    url: `${base}/eventsday.php?d=${encodeURIComponent(d)}&s=Soccer`,
    labelAr: `مباريات يوم ${d}`,
    kind: 'day' as const,
  }));
  return [...roundUrls, ...seasonUrls, ...leagueUrls, ...dayUrls];
}

export interface TheSportsDBFetchOptions {
  timeoutMs?: number;
  retries?: number;
  cacheTtlMs?: number;
  /** Total wall-clock budget for this fetch. Endpoints that would start after it are skipped. */
  budgetMs?: number;
  rounds?: TheSportsDBRoundWindow | null;
  /** أقصى عدد من طلبات eventsday (انظر buildTheSportsDBEndpoints). */
  maxDayCalls?: number;
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
  /** أيام من النافذة لم تُطلب لأن أقصى عدد لطلبات eventsday أقل من طول النافذة. */
  dayCallsSkipped: number;
  /** Which API keys were tried and what the provider answered (masked). */
  apiKeyProbes: TheSportsDBKeyProbe[];
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
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? Number.POSITIVE_INFINITY;
  // One probe per process: a bad premium key must not take the whole Egyptian schedule offline.
  const keyResolution = await resolveTheSportsDBApiKey({ timeoutMs: options.timeoutMs ?? 6000 });
  const apiKey = keyResolution.key;
  const endpoints = buildTheSportsDBEndpoints(dates, options.rounds, apiKey, options.maxDayCalls ?? 3);
  const requestedDayCount = Math.min(dates.length, Math.max(0, options.maxDayCalls ?? 3));
  const dayCallsSkipped = Math.max(0, dates.length - requestedDayCount);

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
    dayCallsSkipped,
    apiKeyProbes: keyResolution.probes,
    error: anyOk ? undefined : lastError || 'Failed to reach TheSportsDB endpoints',
  };
}
