/** A match-like record whose start time is available as an ISO timestamp. */
export interface KickoffDatedMatch {
  utcKickoff: string;
}

/**
 * Return related matches in order of temporal proximity to a reference kickoff.
 * Invalid timestamps are kept at the end (stably) rather than affecting valid results.
 */
export function sortMatchesByKickoffProximity<T extends KickoffDatedMatch>(
  matches: readonly T[],
  referenceKickoff: string
): T[] {
  const referenceTime = Date.parse(referenceKickoff);
  const distanceFromReference = (match: T): number => {
    const matchTime = Date.parse(match.utcKickoff);
    if (!Number.isFinite(referenceTime) || !Number.isFinite(matchTime)) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.abs(matchTime - referenceTime);
  };

  return [...matches].sort((a, b) => {
    const aDistance = distanceFromReference(a);
    const bDistance = distanceFromReference(b);
    if (aDistance === bDistance) return 0;
    return aDistance < bDistance ? -1 : 1;
  });
}
