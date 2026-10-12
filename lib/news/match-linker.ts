import {
  CompetitionRecord,
  MatchRecord,
  NewsItemRecord,
  TeamRecord,
} from '../types';
import { toCairoDateStringOrNull } from './age-policy';
import { normalizeNewsTitle } from './normalize';

export interface NewsMatchContext {
  matches: MatchRecord[];
  teams: TeamRecord[];
  competitions: CompetitionRecord[];
}

function titleContainsName(normalizedTitle: string, name: string): boolean {
  const normalizedName = normalizeNewsTitle(name);
  if (!normalizedName || normalizedName.length < 3) return false;
  return (
    normalizedTitle.includes(` ${normalizedName} `) ||
    normalizedTitle.startsWith(`${normalizedName} `) ||
    normalizedTitle.endsWith(` ${normalizedName}`) ||
    normalizedTitle === normalizedName
  );
}

export function linkNewsToMatches(
  title: string,
  publishedAt: string | null,
  context: NewsMatchContext
): Pick<
  NewsItemRecord,
  | 'relatedMatchIds'
  | 'relatedTeamIds'
  | 'relatedCompetitionCodes'
  | 'nemoRelatedUrl'
  | 'nemoRelatedLabelAr'
> {
  const normalizedTitle = ` ${normalizeNewsTitle(title)} `;
  const relatedTeams = context.teams.filter((team) => {
    return (
      titleContainsName(normalizedTitle, team.nameAr) ||
      titleContainsName(normalizedTitle, team.nameEn) ||
      titleContainsName(normalizedTitle, team.shortNameAr)
    );
  });

  const relatedCompetitions = context.competitions.filter((comp) => {
    return (
      titleContainsName(normalizedTitle, comp.nameAr) ||
      titleContainsName(normalizedTitle, comp.nameEn)
    );
  });

  const relatedTeamIds = relatedTeams.map((team) => team.id);
  const relatedCompetitionCodes = relatedCompetitions.map((comp) => comp.code);
  const publishedCairo = toCairoDateStringOrNull(publishedAt);

  const relatedMatches = context.matches.filter((match) => {
    const homeHit = relatedTeamIds.includes(match.homeTeam.id);
    const awayHit = relatedTeamIds.includes(match.awayTeam.id);
    if (homeHit && awayHit) {
      if (!publishedCairo) return true;
      return Math.abs(dateDiffDays(match.cairoDate, publishedCairo)) <= 2;
    }
    if ((homeHit || awayHit) && relatedCompetitionCodes.includes(match.competitionCode)) {
      if (!publishedCairo) return false;
      return match.cairoDate === publishedCairo;
    }
    return false;
  });

  // A news item has no independently verified match destination. Related fixtures remain plain
  // text (see app/news/[slug]/page.tsx); generic or incidental match links are never attached.
  return {
    relatedMatchIds: relatedMatches.map((match) => match.id),
    relatedTeamIds,
    relatedCompetitionCodes,
    nemoRelatedUrl: null,
    nemoRelatedLabelAr: null,
  };
}

function dateDiffDays(a: string, b: string): number {
  const aDate = Date.parse(`${a}T12:00:00Z`);
  const bDate = Date.parse(`${b}T12:00:00Z`);
  if (!Number.isFinite(aDate) || !Number.isFinite(bDate)) return Number.POSITIVE_INFINITY;
  return Math.round((aDate - bDate) / (24 * 60 * 60 * 1000));
}
