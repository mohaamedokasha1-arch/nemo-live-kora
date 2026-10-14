import { getTodayCairoDate, shiftDateString } from '../cairo-time';
import {
  getEgyptianRoundWindow,
  getGatewayDatabase,
  hydrateGatewayDatabase,
  ingestNewsCandidatesInStore,
  MatchUpsertStats,
  recordMatchesSyncAttempt,
  recordNewsSync,
  recordSyncExecution,
  upsertMatchesInStoreWithStats,
  upsertSeasonsInStore,
  upsertCompetitionsInStore,
  upsertStandingsInStore,
} from '../db/store';
import { fetchApiFootballSync } from '../sources/api-football';
import { fetchFootballDataSync } from '../sources/football-data';
import { fetchGoogleNewsRss } from '../sources/google-news-rss';
import {
  fetchSportScoreMatches,
  fetchSportScoreStandings,
} from '../sources/sportscore';
import { fetchTheSportsDBMatches } from '../sources/thesportsdb';
import {
  CompetitionStandingTable,
  NewsSourceSyncRecord,
  SourceErrorEntry,
  SourceHealthStatus,
  SourceId,
  SourceSyncResult,
  SyncLogEntry,
} from '../types';

async function isolateSource<T>(
  sourceId: SourceId,
  fn: () => Promise<T>,
  fallback: T,
  errors: SourceErrorEntry[]
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    errors.push({
      id: `err-${sourceId}-${Date.now()}`,
      sourceId,
      timestamp: new Date().toISOString(),
      endpoint: sourceId,
      httpStatus: null,
      errorCode: 'source_exception',
      message: error instanceof Error ? error.message : String(error),
      messageAr: `تعطل المصدر ${sourceId} مؤقتًا دون إيقاف بقية المصادر.`,
    });
    return fallback;
  }
}

export interface RunGatewaySyncOptions {
  mode?: 'live' | 'daily' | 'standings' | 'manual';
  trigger?: string;
  targetDate?: string;
  /** عند true تُتخطى مزامنة الأخبار (التحديث عند الطلب للمباريات فقط). */
  skipNews?: boolean;
  /** عند true تُتخطى المصادر التي لا تضيف مباريات بدون مفتاح (Football-Data/API-Football) لتقليل زمن الاستجابة. */
  quick?: boolean;
  /**
   * Wall-clock budget for the TheSportsDB request chain in quick mode. Endpoints that would
   * start after the budget are recorded as skipped instead of being requested.
   */
  budgetMs?: number;
}

const EMPTY_WRITE: MatchUpsertStats = { processed: 0, inserted: 0, updated: 0, unchanged: 0 };

/** Default TheSportsDB time budget for the on-demand (quick) path. */
export const THESPORTSDB_QUICK_BUDGET_MS = 8000;

/**
 * Executes a non-destructive background sync across the 5 approved sources:
 * 1. SportScore (live matches + standings)
 * 2. TheSportsDB (Egyptian Premier League, Egypt League Cup, CAF Confederation Cup, daily fixtures)
 * 3. Football-Data.org (competitions/seasons + matches when key configured)
 * 4. API-Football (status check + fixtures when key configured)
 * 5. Google News RSS (Arabic & English Egyptian football news)
 *
 * If an external API is unreachable (e.g., restricted outbound network or temporary timeout),
 * existing verified data in the store is preserved and `usedCachedSnapshot: true` is recorded.
 */
let newsInFlight: Promise<NewsSourceSyncRecord> | null = null;
export function runNewsSync(trigger = 'مزامنة أخبار', errors: SourceErrorEntry[] = [],
  options?: { timeoutMs?: number; retries?: number; limitFeeds?: number }): Promise<NewsSourceSyncRecord> {
  if (newsInFlight) return newsInFlight;
  newsInFlight = executeNewsSync(trigger, errors, options).finally(() => { newsInFlight = null; });
  return newsInFlight;
}

async function executeNewsSync(
  trigger = 'مزامنة أخبار',
  errors: SourceErrorEntry[] = [],
  fetchOptions?: { timeoutMs?: number; retries?: number; limitFeeds?: number }
): Promise<NewsSourceSyncRecord> {
  const startedAt = new Date().toISOString();
  const gnRes = await isolateSource(
    'google-news-rss',
    () => fetchGoogleNewsRss(fetchOptions),
    {
      ok: false,
      httpStatus: null,
      latencyMs: 0,
      news: [],
      error: 'google-news-rss-unreachable',
      errorAr: 'تعذر الاتصال بـ Google News RSS.',
      feedResults: [],
    },
    errors
  );

  if (!gnRes.ok) {
    const failed: NewsSourceSyncRecord = {
      id: `news-sync-${Date.now()}`,
      sourceId: 'google-news-rss',
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      httpStatus: gnRes.httpStatus,
      latencyMs: gnRes.latencyMs,
      fetchedCount: 0,
      importedCount: 0,
      publishedCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      updatedCount: 0,
      errorCount: 1,
      messageAr:
        gnRes.errorAr ||
        'تعذر جلب الأخبار من Google News RSS. لم تُحذف الأخبار المنشورة سابقًا.',
    };
    recordNewsSync(failed);
    return failed;
  }

  const ingest = ingestNewsCandidatesInStore(gnRes.news);
  const finishedAt = new Date().toISOString();
  const sync: NewsSourceSyncRecord = {
    id: `news-sync-${Date.now()}`,
    sourceId: 'google-news-rss',
    startedAt,
    finishedAt,
    ok: ingest.published > 0 || ingest.duplicates > 0,
    httpStatus: gnRes.httpStatus,
    latencyMs: gnRes.latencyMs,
    fetchedCount: gnRes.news.length,
    importedCount: ingest.imported,
    publishedCount: ingest.published,
    duplicateCount: ingest.duplicates,
    rejectedCount: ingest.rejected,
    updatedCount: ingest.updated,
    errorCount: ingest.rejected,
    messageAr:
      gnRes.news.length === 0
        ? `تم الاتصال بـ Google News RSS دون عناصر جديدة. ${trigger}`
        : `جُلب ${gnRes.news.length} عنوانًا من RSS، نُشر ${ingest.published}، تحديث ${ingest.updated}، تكرار ${ingest.duplicates}، رفض ${ingest.rejected}.`,
  };
  recordNewsSync(sync);
  return sync;
}

let newsRefreshInFlight: Promise<NewsSourceSyncRecord> | null = null;

export async function ensureFreshNews(
  maxAgeMs = 15 * 60 * 1000
): Promise<NewsSourceSyncRecord | null> {
  // Adopt the shared snapshot before syncing so this instance flushes a superset, never a stale copy.
  await hydrateGatewayDatabase();
  const db = getGatewayDatabase();
  const lastAttempt = db.meta.lastNewsSyncAt || db.meta.lastSuccessfulNewsSyncAt;
  if (lastAttempt) {
    const age = Date.now() - new Date(lastAttempt).getTime();
    if (Number.isFinite(age) && age >= 0 && age < maxAgeMs) {
      return null;
    }
  }
  if (newsRefreshInFlight) return newsRefreshInFlight;
  newsRefreshInFlight = runNewsSync('تحديث أخبار عند الطلب', [], {
    timeoutMs: 4000,
    retries: 0,
    limitFeeds: 1,
  }).finally(() => {
    newsRefreshInFlight = null;
  });
  return newsRefreshInFlight;
}

let matchesRefreshInFlight: Promise<SyncLogEntry> | null = null;

/** Default on-demand freshness window for match data (yesterday/today/tomorrow pages and the API). */
export const MATCHES_FRESHNESS_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * On-demand refresh of match data.
 *
 * On Vercel the daily cron (Hobby plan: one schedule per day) and the JSON file store are not
 * enough to keep today's scores current — a fresh serverless instance starts from the committed
 * snapshot. So the schedule pages and `/api/matches` call this before reading: if the last
 * attempt (successful or not) is older than `maxAgeMs`, SportScore + TheSportsDB are fetched
 * with short timeouts, concurrent callers share one in-flight run, and the outcome is recorded
 * in `meta.lastMatchesSyncResult`. Failures keep the existing data untouched.
 */
export async function ensureFreshMatches(
  maxAgeMs = MATCHES_FRESHNESS_MAX_AGE_MS,
  trigger = 'تحديث مباريات عند الطلب'
): Promise<SyncLogEntry | null> {
  // Adopt the shared snapshot before syncing so this instance flushes a superset, never a stale copy.
  await hydrateGatewayDatabase();
  const db = getGatewayDatabase();
  const lastAttempt = db.meta.lastMatchesSyncAttemptAt;
  if (lastAttempt) {
    const age = Date.now() - new Date(lastAttempt).getTime();
    if (Number.isFinite(age) && age >= 0 && age < maxAgeMs) return null;
  }
  if (matchesRefreshInFlight) return matchesRefreshInFlight;
  matchesRefreshInFlight = runGatewaySync({ mode: 'live', trigger, skipNews: true, quick: true }).finally(() => {
    matchesRefreshInFlight = null;
  });
  return matchesRefreshInFlight;
}

// One process-wide writer; a distributed lease still requires durable production storage.
let gatewayInFlight: Promise<SyncLogEntry> | null = null;
export function runGatewaySync(options: RunGatewaySyncOptions = {}): Promise<SyncLogEntry> {
  if (gatewayInFlight) return gatewayInFlight;
  gatewayInFlight = executeGatewaySync(options).finally(() => { gatewayInFlight = null; });
  return gatewayInFlight;
}

async function executeGatewaySync(
  options: RunGatewaySyncOptions = {}
): Promise<SyncLogEntry> {
  const mode = options.mode || 'daily';
  const trigger = options.trigger || 'تحديث تلقائي مجدول';
  const startedAt = new Date().toISOString();
  const todayCairo = options.targetDate || getTodayCairoDate();
  const yesterdayCairo = shiftDateString(todayCairo, -1);
  const tomorrowCairo = shiftDateString(todayCairo, 1);

  const sourceResults: SourceSyncResult[] = [];
  const errors: SourceErrorEntry[] = [];
  const sourceUpdates: Partial<
    Record<SourceId, Partial<ReturnType<typeof getGatewayDatabase>['sources'][SourceId]>>
  > = {};
  const writeTotals: MatchUpsertStats & { recordsSkipped: number } = { ...EMPTY_WRITE, recordsSkipped: 0 };
  const writesBySource = new Map<SourceId, MatchUpsertStats>();
  const addWrite = (w: MatchUpsertStats, source: SourceId) => {
    writesBySource.set(source, w);
    writeTotals.processed += w.processed;
    writeTotals.inserted += w.inserted;
    writeTotals.updated += w.updated;
    writeTotals.unchanged += w.unchanged;
  };

  // 1. SportScore — matches/standings only, not a news source
  const ssRes = await isolateSource(
    'sportscore',
    () =>
      fetchSportScoreMatches(
        options.quick ? { timeoutMs: 4000, retries: 0 } : {}
      ),
    {
      ok: false,
      httpStatus: null,
      latencyMs: 0,
      matches: [] as Awaited<ReturnType<typeof fetchSportScoreMatches>>['matches'],
      skippedRecords: 0,
    },
    errors
  );
  writeTotals.recordsSkipped += ssRes.skippedRecords || 0;
  let ssStandingsCount = 0;
  if (mode === 'daily' || mode === 'standings' || mode === 'manual') {
    try {
      const slugs = ['egyptian-premier-league', 'caf-champions-league', 'saudi-professional-league'];
      const tables: CompetitionStandingTable[] = [];
      for (const slug of slugs) {
        const stRes = await fetchSportScoreStandings(slug);
        if (stRes.ok && stRes.table) {
          tables.push(stRes.table);
        }
      }
      ssStandingsCount = upsertStandingsInStore(tables);
    } catch {
      ssStandingsCount = 0;
    }
  }

  if (ssRes.ok && ssRes.matches.length > 0) {
    addWrite(upsertMatchesInStoreWithStats(ssRes.matches), 'sportscore');
    sourceResults.push({
      sourceId: 'sportscore',
      status: 'active',
      httpStatus: ssRes.httpStatus,
      latencyMs: ssRes.latencyMs,
      matchesFetched: ssRes.matches.length,
      standingsFetched: ssStandingsCount,
      newsFetched: 0,
      usedCachedSnapshot: false,
      messageAr: `تم تحديث ${ssRes.matches.length} مباراة و${ssStandingsCount} جدول ترتيب من SportScore${ssRes.skippedRecords ? ` (تخطي ${ssRes.skippedRecords} سجلًا غير صالح)` : ''}.`,
    });
    sourceUpdates.sportscore = {
      status: 'active',
      statusLabelAr: 'متصل ومفعّل بالكامل (200 OK)',
      lastSyncAt: new Date().toISOString(),
      lastHttpStatus: ssRes.httpStatus,
      lastLatencyMs: ssRes.latencyMs,
    };
  } else {
    sourceResults.push({
      sourceId: 'sportscore',
      status: 'degraded',
      httpStatus: ssRes.httpStatus,
      latencyMs: ssRes.latencyMs,
      matchesFetched: 0,
      standingsFetched: ssStandingsCount,
      newsFetched: 0,
      usedCachedSnapshot: true,
      messageAr: `تعذر جلب المباريات من SportScore (${ssRes.error || `HTTP ${ssRes.httpStatus ?? 'بدون استجابة'}`}). تم الاحتفاظ بالبيانات السابقة دون حذف.`,
    });
    sourceUpdates.sportscore = {
      status: 'degraded',
      statusLabelAr: 'تعذر الاتصال في آخر محاولة — البيانات السابقة محفوظة',
      lastSyncAt: new Date().toISOString(),
      lastHttpStatus: ssRes.httpStatus,
      lastLatencyMs: ssRes.latencyMs,
      errorCount: (getGatewayDatabase().sources.sportscore?.errorCount || 0) + 1,
    };
  }

  // 2. TheSportsDB — matches only, not a news source
  const tsdbRes = await isolateSource(
    'thesportsdb',
    () =>
      fetchTheSportsDBMatches([yesterdayCairo, todayCairo, tomorrowCairo], {
        rounds: getEgyptianRoundWindow(todayCairo),
        ...(options.quick
          ? {
              timeoutMs: 4000,
              retries: 0,
              budgetMs: options.budgetMs ?? THESPORTSDB_QUICK_BUDGET_MS,
            }
          : {}),
      }),
    {
      ok: false,
      httpStatus: null,
      latencyMs: 0,
      matches: [] as Awaited<ReturnType<typeof fetchTheSportsDBMatches>>['matches'],
      endpoints: [] as Awaited<ReturnType<typeof fetchTheSportsDBMatches>>['endpoints'],
      skippedRecords: 0,
      skippedEndpoints: 0,
    },
    errors
  );
  writeTotals.recordsSkipped += tsdbRes.skippedRecords || 0;
  if (tsdbRes.ok) {
    if (tsdbRes.matches.length > 0) addWrite(upsertMatchesInStoreWithStats(tsdbRes.matches), 'thesportsdb');
    const egyptianCount = tsdbRes.matches.filter((m) => m.competitionCode === 'EGY').length;
    const failedEndpoints = tsdbRes.endpoints.filter((e) => !e.ok).length;
    sourceResults.push({
      sourceId: 'thesportsdb',
      status: failedEndpoints > 0 ? 'degraded' : 'active',
      httpStatus: tsdbRes.httpStatus,
      latencyMs: tsdbRes.latencyMs,
      matchesFetched: tsdbRes.matches.length,
      standingsFetched: 0,
      newsFetched: 0,
      usedCachedSnapshot: false,
      messageAr: `تم جلب ${tsdbRes.matches.length} مباراة من TheSportsDB (منها ${egyptianCount} للدوري المصري الممتاز)${failedEndpoints > 0 ? ` — فشل ${failedEndpoints} من ${tsdbRes.endpoints.length} نقطة نهاية` : ''}${tsdbRes.skippedEndpoints ? ` — تجاوز الوقت المخصص فتُخطّي ${tsdbRes.skippedEndpoints} طلبًا` : ''}${tsdbRes.skippedRecords ? ` — تخطي ${tsdbRes.skippedRecords} سجلًا غير صالح أو غير كروي` : ''}.`,
      endpoints: tsdbRes.endpoints,
    });
    sourceUpdates.thesportsdb = {
      status: 'active',
      statusLabelAr: 'متصل ومفعّل بالكامل (200 OK — مفتاح عام 3)',
      lastSyncAt: new Date().toISOString(),
      lastHttpStatus: tsdbRes.httpStatus,
      lastLatencyMs: tsdbRes.latencyMs,
    };
  } else {
    sourceResults.push({
      sourceId: 'thesportsdb',
      status: 'degraded',
      httpStatus: tsdbRes.httpStatus,
      latencyMs: tsdbRes.latencyMs,
      matchesFetched: 0,
      standingsFetched: 0,
      newsFetched: 0,
      usedCachedSnapshot: true,
      messageAr: `تعذر جلب بيانات الدوري المصري من TheSportsDB (${tsdbRes.error || `HTTP ${tsdbRes.httpStatus ?? 'بدون استجابة'}`}). تم الاحتفاظ بالبيانات السابقة دون حذف.`,
      endpoints: tsdbRes.endpoints,
    });
    sourceUpdates.thesportsdb = {
      status: 'degraded',
      statusLabelAr: 'تعذر الاتصال في آخر محاولة — البيانات السابقة محفوظة',
      lastSyncAt: new Date().toISOString(),
      lastHttpStatus: tsdbRes.httpStatus,
      lastLatencyMs: tsdbRes.latencyMs,
      errorCount: (getGatewayDatabase().sources.thesportsdb?.errorCount || 0) + 1,
    };
  }

  const skipFootballData = Boolean(options.quick) && !(process.env.FOOTBALL_DATA_API_KEY || '').trim();
  const skipApiFootball = Boolean(options.quick) && !(process.env.API_FOOTBALL_KEY || '').trim();

  // 3. Football-Data.org — competitions/matches only, not a news source
  const fdRes = skipFootballData ? null : await isolateSource(
    'football-data',
    () => fetchFootballDataSync(yesterdayCairo, tomorrowCairo),
    {
      ok: false,
      status: 'partial_keyless' as SourceHealthStatus,
      httpStatus: null,
      latencyMs: 0,
      hasApiKey: false,
      competitions: [],
      seasons: [],
      matches: [],
      messageAr: 'تعذر الاتصال بـ Football-Data.org.',
    },
    errors
  );
  if (fdRes) {
    upsertCompetitionsInStore(fdRes.competitions);
    upsertSeasonsInStore(fdRes.seasons);
  }
  if (!fdRes) {
    // skipped in quick mode (no key => no matches from this source)
  } else if (fdRes.ok) {
    if (fdRes.matches.length > 0) addWrite(upsertMatchesInStoreWithStats(fdRes.matches), 'football-data');
    sourceResults.push({
      sourceId: 'football-data',
      status: fdRes.status,
      httpStatus: fdRes.httpStatus,
      latencyMs: fdRes.latencyMs,
      matchesFetched: fdRes.matches.length,
      standingsFetched: 0,
      newsFetched: 0,
      usedCachedSnapshot: false,
      messageAr: fdRes.messageAr,
    });
    sourceUpdates['football-data'] = {
      status: fdRes.status,
      isKeyConfigured: fdRes.hasApiKey,
      lastSyncAt: new Date().toISOString(),
      lastHttpStatus: fdRes.httpStatus,
      lastLatencyMs: fdRes.latencyMs,
    };
  } else {
    sourceResults.push({
      sourceId: 'football-data',
      status: 'degraded',
      httpStatus: fdRes.httpStatus,
      latencyMs: fdRes.latencyMs,
      matchesFetched: 0,
      standingsFetched: 0,
      newsFetched: 0,
      usedCachedSnapshot: true,
      messageAr: `تعذر الاتصال بـ Football-Data.org في هذه المحاولة؛ تم الاحتفاظ بفهرس البطولات والمواسم السابق. ${fdRes.messageAr || ''}`.trim(),
    });
  }

  // 4. API-Football — matches only, not a news source
  const apifRes = skipApiFootball ? null : await isolateSource(
    'api-football',
    () => fetchApiFootballSync(todayCairo),
    {
      ok: false,
      status: 'requires_api_key' as SourceHealthStatus,
      httpStatus: null,
      latencyMs: 0,
      hasApiKey: false,
      matches: [],
      messageAr: 'تعذر الاتصال بـ API-Football.',
    },
    errors
  );
  if (apifRes) {
    if (apifRes.ok && apifRes.matches.length > 0) {
      addWrite(upsertMatchesInStoreWithStats(apifRes.matches), 'api-football');
    }
    sourceResults.push({
      sourceId: 'api-football',
      status: apifRes.status,
      httpStatus: apifRes.httpStatus,
      latencyMs: apifRes.latencyMs,
      matchesFetched: apifRes.matches.length,
      standingsFetched: 0,
      newsFetched: 0,
      usedCachedSnapshot: !apifRes.ok,
      messageAr: apifRes.messageAr,
    });
    sourceUpdates['api-football'] = {
      status: apifRes.status,
      isKeyConfigured: apifRes.hasApiKey,
      lastSyncAt: new Date().toISOString(),
      lastHttpStatus: apifRes.httpStatus,
    };
  }

  for (const result of sourceResults) {
    const writes = writesBySource.get(result.sourceId);
    result.matchesInserted = writes?.inserted || 0;
    result.matchesUpdated = writes?.updated || 0;
    result.matchesUnchanged = writes?.unchanged || 0;
  }

  // Record the outcome of this matches fetch (success or failure) before news.
  const matchSources = sourceResults.filter((r) => r.sourceId !== 'google-news-rss');
  const sourcesOk = matchSources.filter((r) => r.matchesFetched > 0).map((r) => r.sourceId);
  const sourcesFailed = matchSources.filter((r) => r.usedCachedSnapshot || r.status === 'degraded').map((r) => r.sourceId);
  const matchesFetchedTotal = matchSources.reduce((t, r) => t + (r.matchesFetched || 0), 0);
  const matchesOk = matchSources.some((r) => r.matchesFetched > 0);
  recordMatchesSyncAttempt({
    ok: matchesOk,
    trigger,
    messageAr: matchesOk
      ? `جُلبت ${matchesFetchedTotal} مباراة من ${sourcesOk.length} مصدر${sourcesFailed.length > 0 ? ` (فشل: ${sourcesFailed.join('، ')})` : ''}.`
      : `لم يُرجع أي مصدر مباريات في هذه المحاولة (${sourcesFailed.join('، ') || 'بدون مصادر'}). البيانات السابقة محفوظة ولم تُحذف.`,
    matchesFetched: matchesFetchedTotal,
    sourcesOk,
    sourcesFailed,
    matchesInserted: writeTotals.inserted,
    matchesUpdated: writeTotals.updated,
    recordsSkipped: writeTotals.recordsSkipped,
    sourceStatus: Object.fromEntries(
      matchSources.map((r) => [
        r.sourceId,
        {
          httpStatus: r.httpStatus,
          ok: !r.usedCachedSnapshot && r.status !== 'degraded',
          ...(r.usedCachedSnapshot || r.status === 'degraded' ? { error: r.messageAr } : {}),
        },
      ])
    ) as NonNullable<Parameters<typeof recordMatchesSyncAttempt>[0]['sourceStatus']>,
  });

  // 5. Google News RSS — the only news-capable source among the five
  if (options.skipNews) {
    const dbSkip = getGatewayDatabase();
    const logEntry: SyncLogEntry = {
      id: `sync-${Date.now()}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      mode,
      trigger,
      sourceResults,
      totalMatchesInStore: dbSkip.matches.length,
      totalStandingsInStore: Object.keys(dbSkip.standings).length,
      totalNewsInStore: dbSkip.news.length,
    };
    recordSyncExecution(logEntry, errors, sourceUpdates);
    return logEntry;
  }
  const newsSync = await runNewsSync(trigger, errors);
  sourceResults.push({
    sourceId: 'google-news-rss',
    status: newsSync.ok ? 'active' : 'degraded',
    httpStatus: newsSync.httpStatus,
    latencyMs: newsSync.latencyMs,
    matchesFetched: 0,
    standingsFetched: 0,
    newsFetched: newsSync.fetchedCount,
    newsPublished: newsSync.publishedCount,
    newsDuplicates: newsSync.duplicateCount,
    newsRejected: newsSync.rejectedCount,
    usedCachedSnapshot: !newsSync.ok,
    messageAr: newsSync.messageAr,
  });
  sourceUpdates['google-news-rss'] = {
    status: newsSync.ok ? 'active' : 'degraded',
    statusLabelAr: newsSync.ok
      ? `تم جلب أخبار حقيقية ونشر ${newsSync.publishedCount} خبرًا بعد التحقق`
      : 'تعذر جلب الأخبار من Google News RSS — لم تُحذف الأخبار المنشورة سابقًا',
    lastSyncAt: newsSync.finishedAt,
    lastHttpStatus: newsSync.httpStatus,
    lastLatencyMs: newsSync.latencyMs,
    newsImportedCount: newsSync.importedCount,
    newsPublishedCount: newsSync.publishedCount,
    recordsImported: newsSync.publishedCount,
    errorCount: newsSync.errorCount,
    ...(newsSync.ok ? { lastSuccessfulNewsSyncAt: newsSync.finishedAt } : {}),
  };

  const dbAfter = getGatewayDatabase();
  const logEntry: SyncLogEntry = {
    id: `sync-${Date.now()}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    mode,
    trigger,
    sourceResults,
    totalMatchesInStore: dbAfter.matches.length,
    totalStandingsInStore: Object.keys(dbAfter.standings).length,
    totalNewsInStore: dbAfter.news.length,
  };

  recordSyncExecution(logEntry, errors, sourceUpdates);
  return logEntry;
}

export interface MatchesUpdateSourceSummary {
  sourceId: SourceId;
  status: string;
  matchesFetched: number;
  standingsFetched: number;
  newsFetched: number;
  usedCachedSnapshot: boolean;
  messageAr: string;
}

export interface MatchesUpdatePipelineResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  mode: 'live' | 'daily' | 'standings' | 'manual';
  /** عدد المباريات التي تغيّرت فعليًا في قاعدة البيانات = الجديدة + المعدّلة */
  matchesUpdated: number;
  /** مباريات لم تكن موجودة وأُضيفت حديثًا */
  matchesAdded: number;
  /** مباريات كانت موجودة وتغيّرت بياناتها (نتيجة/حالة/موعد…) */
  matchesChanged: number;
  /** عدد المباريات التي دخلت خط الأنابيب من المصادر قبل الدمج */
  matchesProcessed: number;
  totalMatchesInStore: number;
  standingsUpdated: number;
  newsUpdated: number;
  sources: MatchesUpdateSourceSummary[];
  log: SyncLogEntry;
}

/**
 * Database Pipeline used by the update API `/api/cron/update-matches` (manual or external scheduler).
 *
 * Wraps `runGatewaySync` with a before/after fingerprint of every match record so the
 * endpoint can report an honest "how many matches were updated" number
 * (newly inserted + actually modified) instead of the raw fetch count.
 */
export async function runMatchesUpdatePipeline(
  options: RunGatewaySyncOptions = {}
): Promise<MatchesUpdatePipelineResult> {
  const mode = options.mode || 'live';
  const beforeDb = getGatewayDatabase();
  const beforeMatches = new Map<string, string>();
  for (const match of beforeDb.matches) {
    beforeMatches.set(match.id, JSON.stringify(match));
  }
  const beforeStandingsCount = Object.keys(beforeDb.standings).length;
  const beforeNewsCount = beforeDb.news.length;

  const log = await runGatewaySync({
    ...options,
    mode,
    trigger: options.trigger || 'API: /api/cron/update-matches',
  });

  const afterDb = getGatewayDatabase();
  let matchesAdded = 0;
  let matchesChanged = 0;
  for (const match of afterDb.matches) {
    const fingerprint = JSON.stringify(match);
    const previous = beforeMatches.get(match.id);
    if (previous === undefined) {
      matchesAdded += 1;
    } else if (previous !== fingerprint) {
      matchesChanged += 1;
    }
  }

  const matchesProcessed = log.sourceResults.reduce(
    (total, source) => total + (source.matchesFetched || 0),
    0
  );
  const standingsUpdated = Math.max(
    0,
    Object.keys(afterDb.standings).length - beforeStandingsCount
  );
  const newsUpdated = Math.max(0, afterDb.news.length - beforeNewsCount);

  return {
    startedAt: log.startedAt,
    finishedAt: log.finishedAt,
    durationMs:
      new Date(log.finishedAt).getTime() - new Date(log.startedAt).getTime(),
    mode,
    matchesUpdated: matchesAdded + matchesChanged,
    matchesAdded,
    matchesChanged,
    matchesProcessed,
    totalMatchesInStore: afterDb.matches.length,
    standingsUpdated,
    newsUpdated,
    sources: log.sourceResults.map((source) => ({
      sourceId: source.sourceId,
      status: source.status,
      matchesFetched: source.matchesFetched,
      standingsFetched: source.standingsFetched,
      newsFetched: source.newsFetched,
      usedCachedSnapshot: source.usedCachedSnapshot,
      messageAr: source.messageAr,
    })),
    log,
  };
}
