import { findVerifiedMatchMapping } from './nemo-resolver';
import { MatchRecord } from './types';

export type MatchExternalIds = MatchRecord['externalIds'];

/**
 * Prefer a real provider fixture identifier over a synthetic teams/date key. The explicit
 * bridge table lets the two known SportScore fixtures share their API-Football identity with
 * TheSportsDB/API-Football records, but only when source id, competition and ordered teams agree.
 */
export function getStableMatchId(input: {
  externalIds: MatchExternalIds;
  competitionCode: string;
  homeTeamId: string;
  awayTeamId: string;
  cairoDate: string;
  fallbackId?: string;
}): string {
  const mapping = findVerifiedMatchMapping({
    ...input.externalIds,
    competitionCode: input.competitionCode,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
  });
  if (mapping?.apiFootballFixtureId) {
    return `match-api-football-${mapping.apiFootballFixtureId}`;
  }

  if (input.externalIds.apiFootballFixtureId) {
    return `match-api-football-${input.externalIds.apiFootballFixtureId}`;
  }
  if (input.externalIds.thesportsdbEventId) {
    return `match-thesportsdb-${input.externalIds.thesportsdbEventId}`;
  }
  if (input.externalIds.footballDataMatchId) {
    return `match-football-data-${input.externalIds.footballDataMatchId}`;
  }
  if (input.externalIds.sportscoreTrackerId) {
    return `match-sportscore-${input.externalIds.sportscoreTrackerId}`;
  }

  // No provider fixture id was supplied. Preserve the existing internal id when migrating
  // old records; otherwise use a clearly synthetic fallback rather than pretending it is a
  // source-provided id. Provider adapters should fill externalIds whenever the source has one.
  if (input.fallbackId) return input.fallbackId;
  return [
    'match-synthetic',
    input.competitionCode.toLowerCase(),
    input.cairoDate,
    input.homeTeamId,
    input.awayTeamId,
  ].join('-');
}

function isCatalogTeamId(teamId: string): boolean {
  return !/^team-(ss|tsdb|fd|apif)-/.test(teamId);
}

function normalizeTeamKey(team: MatchRecord['homeTeam']): string {
  if (isCatalogTeamId(team.id)) return team.id;
  return `name:${team.nameEn.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')}`;
}

/**
 * Cross-source identity key: the same fixture reported by two providers (e.g. SportScore and
 * TheSportsDB) carries different provider ids, so an id-only upsert would store it twice. Same
 * competition + same Cairo date + same ordered teams (catalog id, or normalized English name
 * when the team is not in the catalog) is treated as one match and merged.
 */
export function buildMatchDedupKey(match: MatchRecord): string {
  return [
    match.competitionCode,
    match.kickoffConfirmed === true && Number.isFinite(Date.parse(match.utcKickoff)) ? new Date(match.utcKickoff).toISOString() : `unknown:${match.id}`,
    match.seasonLabel,
    normalizeTeamKey(match.homeTeam),
    normalizeTeamKey(match.awayTeam),
  ].join('|');
}
