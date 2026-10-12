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

/**
 * Fetches Egyptian Premier League rounds, Egypt League Cup, CAF Confederation Cup,
 * and daily soccer events from TheSportsDB v1 JSON API.
 */
export async function fetchTheSportsDBMatches(dates: string[]): Promise<{
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  matches: MatchRecord[];
  error?: string;
}> {
  const base = `${THESPORTSDB_BASE_URL}/${THESPORTSDB_API_KEY}`;
  const urls = [
    `${base}/eventsround.php?id=4829&r=6&s=2026-2027`, // Egyptian Premier League Round 6 (Oct 11-12, 2026)
    `${base}/eventsround.php?id=4829&r=7&s=2026-2027`, // Egyptian Premier League Round 7 (Oct 19-20, 2026)
    `${base}/eventsseason.php?id=5185&s=2026-2027`, // Egypt League Cup (Oct 7-8, 2026)
    `${base}/eventsround.php?id=5057&r=2&s=2026-2027`, // CAF Confederation Cup Round 2 (Oct 16-17, 2026)
    `${base}/eventsround.php?id=4668&r=8&s=2026-2027`, // Saudi Pro League Round 8 (Oct 9-10, 2026)
    ...dates.slice(0, 3).map((d) => `${base}/eventsday.php?d=${encodeURIComponent(d)}&s=Soccer`),
  ];

  const collected: MatchRecord[] = [];
  let anyOk = false;
  let lastStatus: number | null = null;
  let totalLatency = 0;
  let lastError: string | undefined;

  for (const url of urls) {
    const res = await fetchWithProtection<TheSportsDBEventsEnvelope>(url, {
      timeoutMs: 7000,
      retries: 1,
      cacheTtlMs: 3 * 60_000,
    });
    totalLatency += res.latencyMs;
    if (res.httpStatus) lastStatus = res.httpStatus;

    if (res.ok && res.data) {
      anyOk = true;
      const list = res.data.events || res.data.results || [];
      for (const ev of list) {
        if (ev && ev.idEvent && ev.strHomeTeam && ev.strAwayTeam) {
          collected.push(mapTheSportsDBEventToRecord(ev));
        }
      }
    } else if (res.error) {
      lastError = res.error;
    }
  }

  return {
    ok: anyOk,
    httpStatus: lastStatus,
    latencyMs: totalLatency,
    matches: collected,
    error: anyOk ? undefined : lastError || 'Failed to reach TheSportsDB endpoints',
  };
}
