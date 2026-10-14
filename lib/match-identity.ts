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

/* -------------------------------------------------------------------------------------------
 * Link-integrity audit
 *
 * A visitor landing on a match card must reach the page for THAT fixture. The failure mode this
 * catches is the one that actually happened: a stored record kept an old verified match slug, so
 * a new fixture between the same two clubs opened last season's page. Every check below is
 * derived from the stored record itself, so the audit runs offline against real data.
 * ---------------------------------------------------------------------------------------- */

export interface MatchLinkIntegrityIssue {
  matchId: string;
  code:
    | 'link_date_mismatch'
    | 'link_team_mismatch'
    | 'link_competition_mismatch'
    | 'duplicate_identity'
    | 'missing_provider_id'
    | 'stale_upcoming'
    | 'live_outside_window';
  severity: 'error' | 'warning';
  messageAr: string;
}

export interface MatchLinkIntegrityReport {
  checked: number;
  linked: number;
  unlinked: number;
  issues: MatchLinkIntegrityIssue[];
}

/** Days after which a "not started" match is stale data rather than an upcoming fixture. */
export const STALE_UPCOMING_DAYS = 45;

/**
 * Verifies that every stored match's identity and its NEMO Sports link describe the same
 * fixture. Returns a report; it never mutates the store.
 */
export function auditMatchLinkIntegrity(
  matches: MatchRecord[],
  today: Date = new Date()
): MatchLinkIntegrityReport {
  const issues: MatchLinkIntegrityIssue[] = [];
  const seenIdentity = new Map<string, string>();
  let linked = 0;

  for (const match of matches) {
    const ids = match.externalIds || {};
    const hasProviderId = Boolean(
      ids.apiFootballFixtureId ||
        ids.thesportsdbEventId ||
        ids.footballDataMatchId ||
        ids.sportscoreTrackerId
    );
    if (!hasProviderId) {
      issues.push({
        matchId: match.id,
        code: 'missing_provider_id',
        severity: 'warning',
        messageAr: 'لا يحمل معرّفًا من أي مزوّد؛ الهوية مشتقة من الفرق والتاريخ فقط.',
      });
    }

    const identityKey = [
      match.competitionCode,
      match.seasonLabel,
      match.homeTeam.id,
      match.awayTeam.id,
      match.utcKickoff,
    ].join('|');
    const previous = seenIdentity.get(identityKey);
    if (previous && previous !== match.id) {
      issues.push({
        matchId: match.id,
        code: 'duplicate_identity',
        severity: 'error',
        messageAr: `سجل مكرر لنفس المباراة (معرّف آخر: ${previous}).`,
      });
    } else {
      seenIdentity.set(identityKey, match.id);
    }

    if (match.nemoLink?.url) {
      linked += 1;
      const entry = findVerifiedMatchMapping({
        ...ids,
        competitionCode: match.competitionCode,
        homeTeamId: match.homeTeam.id,
        awayTeamId: match.awayTeam.id,
      });
      if (entry) {
        if (entry.cairoDate !== match.cairoDate) {
          issues.push({
            matchId: match.id,
            code: 'link_date_mismatch',
            severity: 'error',
            messageAr: `الرابط موثّق لمباراة ${entry.cairoDate} بينما السجل بتاريخ ${match.cairoDate}؛ يجب ألا يفتح الزائر صفحة مباراة قديمة.`,
          });
        }
        if (entry.homeTeamId !== match.homeTeam.id || entry.awayTeamId !== match.awayTeam.id) {
          issues.push({
            matchId: match.id,
            code: 'link_team_mismatch',
            severity: 'error',
            messageAr: 'الفريقان في السجل لا يطابقان الفريقين الموثّقين للرابط.',
          });
        }
        if (entry.competitionCode !== match.competitionCode) {
          issues.push({
            matchId: match.id,
            code: 'link_competition_mismatch',
            severity: 'error',
            messageAr: 'البطولة في السجل لا تطابق البطولة الموثّقة للرابط.',
          });
        }
      }
    }

    const kickoffMs = Date.parse(match.utcKickoff);
    if (Number.isFinite(kickoffMs)) {
      const daysSince = (today.getTime() - kickoffMs) / 86_400_000;
      if (match.status === 'not_started' && daysSince > STALE_UPCOMING_DAYS) {
        issues.push({
          matchId: match.id,
          code: 'stale_upcoming',
          severity: 'warning',
          messageAr: `مباراة معروضة كـ«لم تبدأ» رغم مرور ${Math.floor(daysSince)} يومًا على موعدها.`,
        });
      }
      if (match.status === 'live' && (daysSince > 1 || daysSince < -1)) {
        issues.push({
          matchId: match.id,
          code: 'live_outside_window',
          severity: 'error',
          messageAr: 'مباراة معروضة كجارية خارج نافذة المباراة المعقولة.',
        });
      }
    }
  }

  return {
    checked: matches.length,
    linked,
    unlinked: matches.length - linked,
    issues,
  };
}

/** Errors only — the subset that must block a release. */
export function blockingLinkIssues(report: MatchLinkIntegrityReport): MatchLinkIntegrityIssue[] {
  return report.issues.filter((issue) => issue.severity === 'error');
}
