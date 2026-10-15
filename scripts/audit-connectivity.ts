/**
 * Live connectivity + configuration audit.
 *
 * Read-only against the providers: it fetches, measures, and reports, but never writes the store
 * and never calls a production cron endpoint. Run it any time you change a key or an endpoint:
 *
 *   node --import tsx scripts/audit-connectivity.ts
 *   node --import tsx scripts/audit-connectivity.ts --out=docs/evidence/connectivity.json
 *
 * Exit code is 0 only when at least one match source AND at least one news source
 * (Google News RSS or the direct publisher feeds) returned real data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchSportScoreMatches, fetchSportScoreFixturesByDate } from '../lib/sources/sportscore';
import {
  fetchTheSportsDBMatches,
  thesportsdbKeyProbeLog,
} from '../lib/sources/thesportsdb';
import { fetchFootballDataSync } from '../lib/sources/football-data';
import { fetchApiFootballSync } from '../lib/sources/api-football';
import { fetchGoogleNewsRss } from '../lib/sources/google-news-rss';
import { fetchPublisherRss } from '../lib/sources/publisher-rss';
import { decodeGoogleNewsArticleToken } from '../lib/news/google-news-resolver';
import { getTodayCairoDate, shiftDateString } from '../lib/cairo-time';
import { describeSourceConfiguration } from '../lib/config/env';
import { describeStorage, getStorageDriver } from '../lib/storage';
import { verifyStorageRoundTrip } from '../lib/db/store';

interface ProbeResult {
  source: string;
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  matches: number;
  competitions: number;
  standings: number;
  news: number;
  newsResolved: number;
  newsPublishedCandidates: number;
  endpoints?: Array<{ url?: string; endpoint?: string; ok: boolean; httpStatus: number | null; error?: string }>;
  error?: string;
}

function parseOut(): string | null {
  const arg = process.argv.slice(2).find((value) => value.startsWith('--out='));
  return arg ? arg.slice('--out='.length) : null;
}

async function probe(source: string, run: () => Promise<Record<string, unknown>>): Promise<ProbeResult> {
  const base: ProbeResult = {
    source,
    ok: false,
    httpStatus: null,
    latencyMs: 0,
    matches: 0,
    competitions: 0,
    standings: 0,
    news: 0,
    newsResolved: 0,
    newsPublishedCandidates: 0,
  };
  try {
    const data = await run();
    return {
      ...base,
      ok: Boolean(data.ok),
      httpStatus: (data.httpStatus as number | null) ?? null,
      latencyMs: (data.latencyMs as number) ?? 0,
      matches: Array.isArray(data.matches) ? (data.matches as unknown[]).length : 0,
      competitions: Array.isArray(data.competitions) ? (data.competitions as unknown[]).length : 0,
      standings: Array.isArray(data.standings) ? (data.standings as unknown[]).length : 0,
      news: Array.isArray(data.news) ? (data.news as unknown[]).length : 0,
      newsResolved: (data.resolvedCount as number) ?? 0,
      newsPublishedCandidates: (data.enrichedCount as number) ?? 0,
      endpoints:
        (data.attempts as ProbeResult['endpoints']) ??
        (data.endpoints as ProbeResult['endpoints']) ??
        ((data.feedResults as unknown) as ProbeResult['endpoints']),
      error: (data.errorCode as string) || (data.error as string) || undefined,
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const today = getTodayCairoDate();
  const tomorrow = shiftDateString(today, 1);

  const results = await Promise.all([
    probe('sportscore', () =>
      fetchSportScoreMatches({ timeoutMs: 6000, retries: 1, cacheTtlMs: 0 }) as unknown as Promise<Record<string, unknown>>
    ),
    probe('sportscore-fixtures', () =>
      fetchSportScoreFixturesByDate(today, { timeoutMs: 6000, retries: 0, cacheTtlMs: 0 }) as unknown as Promise<Record<string, unknown>>
    ),
    probe('thesportsdb', () =>
      fetchTheSportsDBMatches([today, tomorrow], {
        timeoutMs: 6000,
        retries: 1,
        cacheTtlMs: 0,
        budgetMs: 25_000,
      }) as unknown as Promise<Record<string, unknown>>
    ),
    probe('football-data', () => fetchFootballDataSync(today, tomorrow) as unknown as Promise<Record<string, unknown>>),
    probe('api-football', () => fetchApiFootballSync(today, { includeLeague: true }) as unknown as Promise<Record<string, unknown>>),
    probe('google-news-rss', () =>
      fetchGoogleNewsRss({ timeoutMs: 8000, retries: 1, limitFeeds: 3 }) as unknown as Promise<Record<string, unknown>>
    ),
    probe('publisher-rss', () =>
      fetchPublisherRss({ timeoutMs: 8000, retries: 1, cacheTtlMs: 0, budgetMs: 40_000 }) as unknown as Promise<Record<string, unknown>>
    ),
  ]);

  /**
   * Offline proof of the relay root cause (needs no network): every link captured from the live
   * Arabic Google feed on 2026-10-15 must decode to NOTHING without an authenticated fetch.
   * If this ever becomes non-zero, Google changed the format and resolver upgrades may pay off.
   */
  const relaySamplePath = path.join(process.cwd(), 'tests/fixtures/google-news/rss-live-relay-tokens-2026-10-15.json');
  let relayOffline = { captured: 0, decodable: 0, note: 'fixture missing' };
  if (fs.existsSync(relaySamplePath)) {
    const relaySample = JSON.parse(fs.readFileSync(relaySamplePath, 'utf-8')) as {
      items: Array<{ relayUrl: string }>;
    };
    relayOffline = {
      captured: relaySample.items.length,
      decodable: relaySample.items.filter((item) => decodeGoogleNewsArticleToken(item.relayUrl).url !== null).length,
      note: 'recorded 2026-10-15 from news.google.com/rss/search (Arabic, ceid EG:ar)',
    };
  }

  const storageRoundTrip = await verifyStorageRoundTrip();
  const report = {
    testedAt: new Date().toISOString(),
    todayCairo: today,
    keys: describeSourceConfiguration(),
    storage: { ...describeStorage(), roundTrip: storageRoundTrip, driver: getStorageDriver().kind },
    thesportsdbKeyProbes: thesportsdbKeyProbeLog(),
    results,
    summary: {
      matchSourcesOk: results.filter((r) => !['google-news-rss', 'publisher-rss'].includes(r.source) && r.ok && r.matches > 0).length,
      newsSourceOk: results.some((r) => ['google-news-rss', 'publisher-rss'].includes(r.source) && r.ok),
      newsItemsFetched:
        (results.find((r) => r.source === 'google-news-rss')?.news ?? 0) +
        (results.find((r) => r.source === 'publisher-rss')?.news ?? 0),
      publisherFeedsOk: results.find((r) => r.source === 'publisher-rss')?.endpoints?.filter((f) => f.ok).length ?? 0,
      googleRelayLinksDecodableOffline: relayOffline,
      newsRelayLinksResolved: results.find((r) => r.source === 'google-news-rss')?.newsResolved ?? 0,
      storageVerified: storageRoundTrip.ok,
      storageDurable: storageRoundTrip.durable,
    },
  };

  const out = parseOut();
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf-8');
  }
  console.log(JSON.stringify(report, null, 2));

  const healthy = report.summary.matchSourcesOk > 0 && report.summary.newsSourceOk;
  if (!healthy) process.exitCode = 1;
}

void main();
