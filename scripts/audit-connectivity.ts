/** Read-only live probes. Does not write the store or invoke production cron endpoints. */
import { fetchSportScoreMatches } from '../lib/sources/sportscore';
import { fetchTheSportsDBMatches } from '../lib/sources/thesportsdb';
import { fetchFootballDataSync } from '../lib/sources/football-data';
import { fetchApiFootballSync } from '../lib/sources/api-football';
import { fetchGoogleNewsRss } from '../lib/sources/google-news-rss';
import { getTodayCairoDate } from '../lib/cairo-time';

async function main() {
const date = getTodayCairoDate();
const probes = [
  ['sportscore', () => fetchSportScoreMatches({ timeoutMs: 2000, retries: 0, cacheTtlMs: 0 })],
  ['thesportsdb', () => fetchTheSportsDBMatches([date], { timeoutMs: 2000, retries: 0, budgetMs: 4000 })],
  ['football-data', () => fetchFootballDataSync(date, date)],
  ['api-football', () => fetchApiFootballSync(date)],
  ['google-news-rss', () => fetchGoogleNewsRss({ timeoutMs: 2000, retries: 0, limitFeeds: 1 })],
] as const;
const results = await Promise.all(probes.map(async ([source, probe]) => {
  try {
    const data = await probe();
    return { source, ok: data.ok, httpStatus: data.httpStatus, latencyMs: data.latencyMs,
      matches: 'matches' in data ? data.matches.length : 0,
      competitions: 'competitions' in data ? data.competitions.length : 0,
      news: 'news' in data ? data.news.length : 0,
      error: 'errorCode' in data ? data.errorCode : 'error' in data ? data.error : undefined };
  } catch { return { source, ok: false, error: 'probe_exception' }; }
}));
console.log(JSON.stringify({ testedAt: new Date().toISOString(), environment: 'Arena sandbox; restricted egress; not production', persisted: 0, results }, null, 2));

}
void main();
