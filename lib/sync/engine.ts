import { getTodayCairoDate, shiftDateString } from '../cairo-time';
import { resolveSyncWindowForRun, SyncDateWindow } from './date-window';
import {
  getEgyptianRoundWindow,
  getGatewayDatabase,
  hydrateStore,
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
import { summarizeNewsRejectionsAr } from '../news/validate';
import { getSiteSettings, isSourceEnabled, loadManualDocument } from '../admin/manual-store';
import { maybeCreateScheduledBackup } from '../admin/backups';
import { fetchApiFootballSync } from '../sources/api-football';
import { fetchFootballDataSync } from '../sources/football-data';
import { fetchGoogleNewsRss, NEWS_FEEDS } from '../sources/google-news-rss';
import { fetchPublisherRss } from '../sources/publisher-rss';
import {
  fetchSportScoreDayCoverage,
  fetchSportScoreMatches,
  fetchSportScoreStandings,
} from '../sources/sportscore';
import { fetchTheSportsDBMatches } from '../sources/thesportsdb';
import {
  CompetitionStandingTable,
  MatchRecord,
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
  errors: SourceErrorEntry[],
  /**
   * بوابة التعطيل الإداري: عند `false` لا يُنادى المصدر إطلاقًا (صفر طلبات شبكة)
   * وتُعاد القيمة الاحتياطية **بلا** تسجيل خطأ مصدر — لأن التعطيل ليس فشلًا.
   */
  enabled: boolean = true
): Promise<T> {
  if (!enabled) return fallback;
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
  /**
   * قصر المحاولة على مصادر بعينها — يُستخدم في زر «إعادة المحاولة» داخل لوحة الإدارة
   * حتى لا تُشغّل إعادة محاولة مصدر واحد كل المصادر الأخرى معه.
   */
  sources?: SourceId[];
}

const EMPTY_WRITE: MatchUpsertStats = { processed: 0, inserted: 0, updated: 0, unchanged: 0 };

/**
 * ميزانية زمنية للتشغيل المجدول الواسع: لا يبدأ طلب اختياري جديد (يوم إضافي) بعد هذه المدة.
 * الهدف إبقاء المزامنة ضمن `maxDuration` للمسار (60 ثانية) حتى مع نافذة أيام كبيرة.
 * الأيام التي تُتخطى تُسجَّل في `dateWindow.skipped` ولا تُعدّ نجاحًا.
 */
export const WIDE_SYNC_SOURCE_BUDGET_MS = 25_000;

/**
 * يسجّل فشل مصدر كـ«خطأ» قابل للبحث (مع السبب ورمز HTTP) بدل الاكتفاء بنص الرسالة في النتيجة.
 * كان المسار يسجل الاستثناءات فقط؛ فالفشل بلا استثناء (مثل fetch failed داخل الغلاف) لم يظهر في
 * سجل الأخطاء أبدًا.
 */
function recordSourceFailure(
  errors: SourceErrorEntry[],
  sourceId: SourceId,
  detail: { endpoint?: string; httpStatus?: number | null; error?: string; messageAr: string }
): void {
  errors.push({
    id: `err-${sourceId}-${Date.now()}`,
    sourceId,
    timestamp: new Date().toISOString(),
    endpoint: detail.endpoint || sourceId,
    httpStatus: detail.httpStatus ?? null,
    errorCode: 'source_unavailable',
    message: (detail.error || 'no usable response').slice(0, 300),
    messageAr: detail.messageAr,
  });
}

/** Builds the date-window record stored on the sync log entry. */
function describeWindow(window: SyncDateWindow, skipped: {
  sportscoreDays: string[];
  thesportsdbDayCallsSkipped: number;
  apiFootballDays: string[];
}): NonNullable<SyncLogEntry['dateWindow']> {
  return {
    profile: window.profile,
    todayCairo: window.todayCairo,
    from: window.from,
    to: window.to,
    dates: [...window.dates],
    daysBack: window.daysBack,
    daysAhead: window.daysAhead,
    skipped: {
      sportscoreDays: skipped.sportscoreDays,
      thesportsdbDayCalls: skipped.thesportsdbDayCallsSkipped,
      apiFootballDays: skipped.apiFootballDays,
    },
  };
}

/** Merges the widget and day-endpoint responses: the same fixture arrives from both. */
function dedupeMatchesById(matches: MatchRecord[]): MatchRecord[] {
  const byId = new Map<string, MatchRecord>();
  for (const match of matches) {
    if (!byId.has(match.id)) byId.set(match.id, match);
  }
  return Array.from(byId.values());
}

/**
 * API-Football seasons are the *starting* year of a July–June season, so the Egyptian 2026/2027
 * season is requested as `season=2026`.
 */
export function apiFootballSeasonFor(cairoDate: string): number {
  const [year, month] = cairoDate.split('-').map(Number);
  return month >= 7 ? year : year - 1;
}

/** Default TheSportsDB time budget for the on-demand (quick) path. */
export const THESPORTSDB_QUICK_BUDGET_MS = 8000;

/**
 * Time budget per day for the SportScore priority-competition sweep on the on-demand path. The
 * three days run in parallel (and in parallel with TheSportsDB), so this bounds the added page
 * latency; competitions not requested in time are listed in the sync message.
 */
export const SPORTSCORE_QUICK_DAY_BUDGET_MS = 7000;

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
  options?: {
    timeoutMs?: number;
    retries?: number;
    limitFeeds?: number;
    /** موضع البداية داخل مجموعات الخلاصات — للتدوير في التحديث السريع عند الطلب. */
    feedOffset?: number;
    /** Retry only instant network failures on the on-demand path. */
    retryOnNetworkErrorOnly?: boolean;
    /** قيود مسار الخلاصات المباشرة عند التحديث عند الطلب (ميزانية زمن قصيرة). */
    publisher?: { timeoutMs?: number; retries?: number; maxItemsPerFeed?: number; budgetMs?: number; retryOnNetworkErrorOnly?: boolean };
  }): Promise<NewsSourceSyncRecord> {
  if (newsInFlight) return newsInFlight;
  newsInFlight = executeNewsSync(trigger, errors, options).finally(() => { newsInFlight = null; });
  return newsInFlight;
}

async function executeNewsSync(
  trigger = 'مزامنة أخبار',
  errors: SourceErrorEntry[] = [],
  fetchOptions?: {
    timeoutMs?: number;
    retries?: number;
    limitFeeds?: number;
    feedOffset?: number;
    retryOnNetworkErrorOnly?: boolean;
    publisher?: { timeoutMs?: number; retries?: number; maxItemsPerFeed?: number; budgetMs?: number; retryOnNetworkErrorOnly?: boolean };
  }
): Promise<NewsSourceSyncRecord> {
  const startedAt = new Date().toISOString();
  // Adopt the shared snapshot first (as the gateway sync does), so a cold instance never builds
  // on its bundled copy and later overwrites newer shared news with it.
  await hydrateStore();

  /*
   * مصدر الأخبار المباشر من الناشرين (خلاصات RSS عامة تنشرها المؤسسة نفسها): يعمل **بالتوازي**
   * مع Google News RSS وبمعزل عنه — لا source معطّل إداريًا ولا عطل خلاصة يوقف الأخرى.
   * يُسجَّل ويُدقَّم أولًا (دوره في الاستيعاب يسبق Google) حتى تُدمج نسخ Google الوسيطة لنفس
   * المقال عبر طابق الرابط المطبَّع داخل `processNewsBatch`، فلا يظهر الخبر مرتين.
   */
  const prRes = await isolateSource(
    'publisher-rss',
    () => fetchPublisherRss(fetchOptions?.publisher),
    {
      ok: false,
      httpStatus: null,
      latencyMs: 0,
      news: [],
      feedResults: [],
      rejectedCount: 0,
      error: 'publisher-rss-unreachable',
      errorAr: 'تعذر الاتصال بخلاصات الناشرين المباشرة.',
    },
    errors,
    isSourceEnabled('publisher-rss')
  );
  {
    const prIngest = prRes.ok && prRes.news.length > 0
      ? await ingestNewsCandidatesInStore(prRes.news)
      : { imported: 0, published: 0, duplicates: 0, rejected: 0, updated: 0, rejectionBreakdown: {} as Record<string, number> };
    const prFeedOk = prRes.ok && prRes.news.length > 0;
    const prSync: NewsSourceSyncRecord = {
      id: `news-sync-${Date.now()}-publisher`,
      sourceId: 'publisher-rss',
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: prFeedOk && (prIngest.published > 0 || prIngest.duplicates > 0 || prIngest.updated > 0),
      feedOk: prFeedOk,
      rejectionBreakdown: prIngest.rejectionBreakdown,
      httpStatus: prRes.httpStatus,
      latencyMs: prRes.latencyMs,
      fetchedCount: prRes.news.length,
      importedCount: prIngest.imported,
      publishedCount: prIngest.published,
      duplicateCount: prIngest.duplicates,
      rejectedCount: prIngest.rejected,
      updatedCount: prIngest.updated,
      errorCount: prRes.ok ? prIngest.rejected : 1,
      messageAr: !prRes.ok
        ? prRes.errorAr || 'تعذر جلب خلاصات الناشرين المباشرة. لم تُحذف الأخبار المنشورة سابقًا.'
        : `جُلب ${prRes.news.length} مقالًا من ${prRes.feedResults.filter((f) => f.ok).length} من ${prRes.feedResults.length} خلاصات ناشرين مباشرة، نُشر ${prIngest.published}، تحديث ${prIngest.updated}، تكرار ${prIngest.duplicates}، رفض ${prIngest.rejected}.`,
      resolutionReport: {
        attempted: 0,
        resolved: prRes.news.length,
        unresolved: 0,
        strategies: { 'publisher-direct': prRes.news.length },
        errors: {},
      },
    };
    await recordNewsSync(prSync);
  }

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
      resolvedCount: 0,
      enrichedCount: 0,
      resolution: { attempted: 0, resolved: 0, unresolved: 0, strategies: {}, errors: {} },
    },
    errors,
    isSourceEnabled('google-news-rss')
  );

  if (!gnRes.ok) {
    recordSourceFailure(errors, 'google-news-rss', {
      httpStatus: gnRes.httpStatus,
      error: gnRes.error,
      messageAr: gnRes.errorAr || 'تعذر جلب الأخبار من Google News RSS',
    });
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
      feedOk: false,
      messageAr:
        gnRes.errorAr ||
        'تعذر جلب الأخبار من Google News RSS. لم تُحذف الأخبار المنشورة سابقًا.',
      resolutionReport: gnRes.resolution,
    };
    await recordNewsSync(failed);
    return failed;
  }

  const ingest = await ingestNewsCandidatesInStore(gnRes.news);
  const finishedAt = new Date().toISOString();
  /**
   * فصل صريح بين «هل يعمل المصدر؟» و«هل نتج عنوان قابل للنشر؟».
   * كان `ok` يُسقط أي حالة بلا نشر/تكرار إلى «تعذر جلب الأخبار من المصدر»، وهو وصف غير
   * صحيح لمصدر استجاب فعلًا وأعاد عناوين لم تجتز شروط الجودة — يُضلّل المشغّل ويدفعه للبحث
   * عن عطل شبكة لا وجود له.
   */
  const feedOk = gnRes.ok && gnRes.news.length > 0;
  const producedPublishedNews = ingest.published > 0 || ingest.duplicates > 0 || ingest.updated > 0;
  /** أكثر سبب رفض تكرارًا في هذه الدفعة: يُكتب في وصف المزامنة ليُقرأ السبب لا النتيجة فقط. */
  const rejectionSummary = summarizeNewsRejectionsAr(ingest.rejectionBreakdown);
  const sync: NewsSourceSyncRecord = {
    id: `news-sync-${Date.now()}`,
    sourceId: 'google-news-rss',
    startedAt,
    finishedAt,
    ok: feedOk && producedPublishedNews,
    feedOk,
    rejectionBreakdown: ingest.rejectionBreakdown,
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
        : `جُلب ${gnRes.news.length} عنوانًا من RSS، حُلَّت ${gnRes.resolvedCount} من ${gnRes.resolution.attempted} روابط وسيطة إلى مقالات الناشرين، أُثري ${gnRes.enrichedCount} بمحتوى المصدر، نُشر ${ingest.published}، تحديث ${ingest.updated}، تكرار ${ingest.duplicates}، رفض ${ingest.rejected}.${
            producedPublishedNews
              ? ''
              : ` المصدر استجاب فعلًا، ولم يجتز أي عنوان شرط النشر (جودة/رابط ناشر).${
                  rejectionSummary ? ` الأكثر: ${rejectionSummary.labelAr} (${rejectionSummary.count}).` : ''
                }`
          }`,
    resolutionReport: gnRes.resolution,
  };
  await recordNewsSync(sync);
  return sync;
}

let newsRefreshInFlight: Promise<NewsSourceSyncRecord> | null = null;

export async function ensureFreshNews(maxAgeMs?: number): Promise<NewsSourceSyncRecord | null> {
  await loadManualDocument();
  // نافذة تحديث الأخبار من إعدادات اللوحة (قابلة للتغيير بلا إعادة نشر).
  maxAgeMs = maxAgeMs ?? getSiteSettings().newsFreshnessMinutes * 60 * 1000;
  // مصدرَا الأخبار قابلان للتعطيل من اللوحة: بلا هذا الفحص كان زر التعطيل
  // سيبدو فعّالًا ثم تعود الأخبار تتحدّث عند أول زيارة.
  if (!isSourceEnabled('google-news-rss') && !isSourceEnabled('publisher-rss')) return null;
  const db = await hydrateStore();
  const lastAttempt = db.meta.lastNewsSyncAt || db.meta.lastSuccessfulNewsSyncAt;
  if (lastAttempt) {
    const age = Date.now() - new Date(lastAttempt).getTime();
    if (Number.isFinite(age) && age >= 0 && age < maxAgeMs) {
      return null;
    }
  }
  if (newsRefreshInFlight) return newsRefreshInFlight;
  /*
   * التدوير: كل نافذة ١٥ دقيقة تنتقل لمجموعة الخلاصات التالية، فيمرّ التحديث عند الطلب
   * على كل المصادر على مدار اليوم (المجموعة الأولى = الدوري المصري تأتي دائمًا أولًا
   * في المزامنة اليومية الكاملة). بهذا يتجدّد المحتوى تلقائيًا بلا أي تدخل يدوي.
   */
  const feedWindowMs = 15 * 60 * 1000;
  const feedOffset = Math.floor(Date.now() / feedWindowMs) % Math.max(NEWS_FEEDS.length, 1);
  newsRefreshInFlight = runNewsSync('تحديث أخبار عند الطلب', [], {
    timeoutMs: 4000,
    // إعادة محاولة واحدة عند عطل شبكة لحظي (خطأ الاتصال الفوري عند إقلاع نسخة Vercel
    // الباردة كان يُنهي محاولة كاملة بلا أي خبر — مثبت من /api/health يوم 2026-10-15).
    retries: 1,
    limitFeeds: 1,
    feedOffset,
    retryOnNetworkErrorOnly: true,
    publisher: { timeoutMs: 2500, retries: 1, maxItemsPerFeed: 6, budgetMs: 3500, retryOnNetworkErrorOnly: true },
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
  maxAgeMs?: number,
  trigger = 'تحديث مباريات عند الطلب'
): Promise<SyncLogEntry | null> {
  await loadManualDocument();
  // نافذة التحديث قابلة للتحكم من لوحة الإدارة (إعدادات الموقع) — بلا إعادة نشر.
  const effectiveMaxAgeMs = maxAgeMs ?? getSiteSettings().matchesFreshnessMinutes * 60 * 1000;
  maxAgeMs = effectiveMaxAgeMs;
  const db = await hydrateStore();
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
  // ═══ تحكّم المصادر من لوحة الإدارة ═══
  // مصدر معطّل من اللوحة لا يُنادى أصلًا (صفر طلبات شبكة)، ويُسجَّل في نتيجة المزامنة
  // بسبب واضح. و`options.sources` يقصر المحاولة على مصدر واحد عند إعادة المحاولة.
  await loadManualDocument();
  const shouldRunSource = (sourceId: SourceId): boolean =>
    isSourceEnabled(sourceId) && (!options.sources || options.sources.includes(sourceId));
  /**
   * نفس بوابة التشغيل — منفصلة بالاسم لأنها تُمرَّر إلى `isolateSource` في مواضع
   * كثيرة، فالاسم الواضح هنا يمنع الخلط بين «معطّل إداريًا» و«فشل اتصال».
   */
  const shouldRequireSource = (sourceId: SourceId): boolean => shouldRunSource(sourceId);
  /** سبب عدم تشغيل المصدر كما سيظهر للمشغّل — بلا أي التباس مع «فشل اتصال». */
  const skipReasonAr = (sourceId: SourceId): string =>
    isSourceEnabled(sourceId)
      ? 'مستبعَد من هذه المحاولة (إعادة محاولة مصدر واحد)'
      : 'المصدر معطّل من لوحة الإدارة — لم يُجرَ أي نداء شبكة';
  /** رسالة الفشل الصادقة: تمييز التعطيل الإداري عن فشل الاتصال. */
  const failureReasonAr = (sourceId: SourceId, res: { error?: string }): string =>
    shouldRunSource(sourceId) ? res.error || 'بدون استجابة' : skipReasonAr(sourceId);
  // Read the authoritative document before mutating it, so this run builds on whatever the last
  // cron wrote to the shared store instead of on a stale in-memory copy.
  await hydrateStore();
  const syncStartedMs = Date.now();
  const todayCairo = options.targetDate || getTodayCairoDate();
  const tomorrowCairo = shiftDateString(todayCairo, 1);
  // التشغيل المجدول/اليدوي (غير السريع) يغطي نافذة قابلة للضبط؛ التحديث عند الطلب يبقى الأمس/اليوم/غدًا.
  const wideRun = !options.quick && (mode === 'daily' || mode === 'manual');
  const syncWindow = resolveSyncWindowForRun({ todayCairo, wide: wideRun });
  const windowSkipped = {
    sportscoreDays: [] as string[],
    thesportsdbDayCallsSkipped: 0,
    apiFootballDays: [] as string[],
  };

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

  // TheSportsDB runs in parallel with SportScore (different hosts): the on-demand refresh is
  // awaited by the page, so the two providers' latencies must not add up.
  const tsdbResPromise = isolateSource(
    'thesportsdb',
    () => fetchTheSportsDBMatches(syncWindow.dates, {
        rounds: getEgyptianRoundWindow(todayCairo),
        maxDayCalls: syncWindow.dates.length,
        ...(options.quick
          ? {
              timeoutMs: 4000,
              retries: 1,
              retryOnNetworkErrorOnly: true,
              budgetMs: options.budgetMs ?? THESPORTSDB_QUICK_BUDGET_MS,
            }
          : {}),
        ...(wideRun ? { budgetMs: WIDE_SYNC_SOURCE_BUDGET_MS } : {}),
      }),
    {
      ok: false,
      httpStatus: null,
      latencyMs: 0,
      matches: [] as Awaited<ReturnType<typeof fetchTheSportsDBMatches>>['matches'],
      endpoints: [] as Awaited<ReturnType<typeof fetchTheSportsDBMatches>>['endpoints'],
      skippedRecords: 0,
      skippedEndpoints: 0,
      dayCallsSkipped: 0,
      apiKeyProbes: [],
    },
    errors,
    shouldRunSource('thesportsdb')
  );

  // 1. SportScore — matches/standings only, not a news source
  const ssResPromise = isolateSource(
    'sportscore',
    () => fetchSportScoreMatches(
      options.quick ? { timeoutMs: 4000, retries: 1, retryOnNetworkErrorOnly: true } : {}
    ),
    {
      ok: false,
      httpStatus: null,
      latencyMs: 0,
      matches: [] as Awaited<ReturnType<typeof fetchSportScoreMatches>>['matches'],
      skippedRecords: 0,
      endpoint: null,
      attempts: [],
    },
    errors,
    shouldRequireSource('sportscore')
  );
  // Day fixtures: the rolling widget alone is a 50-match window of live/recent games, so the
  // full matchday (and tomorrow's whole schedule) only arrives from `/api/v1/fixtures/`. This now
  // runs on the on-demand path too — before, only the 05:00 UTC cron requested it, so between two
  // daily crons most of today's and tomorrow's fixtures never reached the site.
  // Each day is fetched with `fetchSportScoreDayCoverage` (capped lists partitioned by status, plus
  // a priority-competition sweep for today/tomorrow when the provider cap is hit).
  const sportScoreDays = syncWindow.dates;
  const fetchSportScoreDay = (day: string) =>
    isolateSource(
      'sportscore',
      () =>
        fetchSportScoreDayCoverage(day, {
          timeoutMs: options.quick ? 5000 : 6000,
          retries: options.quick ? 1 : 0,
          retryOnNetworkErrorOnly: options.quick ? true : undefined,
          prioritySweep: day === todayCairo || day === tomorrowCairo,
          // Today's sweep must follow live scores; tomorrow's schedule changes far less often.
          sweepCacheTtlMs: day === todayCairo ? 5 * 60_000 : 30 * 60_000,
          budgetMs: options.quick ? SPORTSCORE_QUICK_DAY_BUDGET_MS : WIDE_SYNC_SOURCE_BUDGET_MS,
          concurrency: options.quick ? 2 : 4,
        }),
      {
        ok: false,
        date: day,
        complete: false,
        httpStatus: null,
        latencyMs: 0,
        matches: [] as MatchRecord[],
        skippedRecords: 0,
        endpoint: null,
        attempts: [],
        requests: [],
        skippedCompetitions: [],
      } as Awaited<ReturnType<typeof fetchSportScoreDayCoverage>>,
      errors,
      shouldRequireSource('sportscore')
    );
  const dayResultsPromise: Promise<Array<Awaited<ReturnType<typeof fetchSportScoreDay>>>> = options.quick
    ? // On-demand: the three days in parallel (each day caps its own concurrency).
      Promise.all(sportScoreDays.map((day) => fetchSportScoreDay(day)))
    : (async () => {
        const results: Array<Awaited<ReturnType<typeof fetchSportScoreDay>>> = [];
        for (const day of sportScoreDays) {
          if (wideRun && Date.now() - syncStartedMs > WIDE_SYNC_SOURCE_BUDGET_MS) {
            windowSkipped.sportscoreDays.push(day);
            continue;
          }
          results.push(await fetchSportScoreDay(day));
        }
        return results;
      })();
  const ssRes = await ssResPromise;
  writeTotals.recordsSkipped += ssRes.skippedRecords || 0;

  // The widget is a rolling 50-match window; the day endpoint fills in the rest of the matchday.
  const ssMatches = [...ssRes.matches];
  let ssEndpoint = ssRes.endpoint;
  const ssAttempts = [...(ssRes.attempts || [])];
  let ssLatency = ssRes.latencyMs;
  let ssStatus = ssRes.httpStatus;
  let ssSkipped = ssRes.skippedRecords || 0;
  const dayResults = await dayResultsPromise;
  const incompleteDays: string[] = [];
  for (const dayRes of dayResults) {
    ssLatency += dayRes.latencyMs;
    if (dayRes.httpStatus) ssStatus = dayRes.httpStatus;
    ssAttempts.push(...dayRes.attempts);
    ssSkipped += dayRes.skippedRecords;
    if (dayRes.ok) {
      ssEndpoint = ssEndpoint || dayRes.endpoint;
      ssMatches.push(...dayRes.matches);
    }
    if (!dayRes.complete) incompleteDays.push(dayRes.date);
  }
  const ssDeduped = dedupeMatchesById(ssMatches);
  let ssStandingsCount = 0;
  if (shouldRunSource('sportscore') && (mode === 'daily' || mode === 'standings' || mode === 'manual')) {
    try {
      const slugs = ['egyptian-premier-league', 'caf-champions-league', 'saudi-professional-league'];
      const tables: CompetitionStandingTable[] = [];
      for (const slug of slugs) {
        const stRes = await fetchSportScoreStandings(slug);
        if (stRes.ok && stRes.table) {
          tables.push(stRes.table);
        }
      }
      ssStandingsCount = await upsertStandingsInStore(tables);
    } catch {
      ssStandingsCount = 0;
    }
  }

  if (ssDeduped.length > 0) {
    addWrite(await upsertMatchesInStoreWithStats(ssDeduped), 'sportscore');
    sourceResults.push({
      sourceId: 'sportscore',
      status: 'active',
      httpStatus: ssStatus,
      latencyMs: ssLatency,
      matchesFetched: ssDeduped.length,
      standingsFetched: ssStandingsCount,
      newsFetched: 0,
      usedCachedSnapshot: false,
      messageAr: `تم تحديث ${ssDeduped.length} مباراة و${ssStandingsCount} جدول ترتيب من SportScore عبر ${ssEndpoint || 'نقطة النهاية الموثقة'}${ssSkipped ? ` (تخطي ${ssSkipped} سجلًا غير صالح)` : ''}${incompleteDays.length ? ` — أيام تجاوزت حدّ المزوّد (200 مباراة لكل طلب) أو فشل فيها طلب: ${incompleteDays.join('، ')}؛ مباريات البطولات ذات الأولوية طُلبت كلٌّ على حدة` : ''}.`,
    });
    sourceUpdates.sportscore = {
      status: 'active',
      statusLabelAr: `متصل ومفعّل بالكامل (200 OK) — ${ssEndpoint || ''}`.trim(),
      lastSyncAt: new Date().toISOString(),
      lastHttpStatus: ssStatus,
      lastLatencyMs: ssLatency,
    };
  } else {
    recordSourceFailure(errors, 'sportscore', {
      endpoint: ssEndpoint || 'sportscore',
      httpStatus: ssStatus,
      error: ssRes.error,
      messageAr: `تعذر جلب المباريات من SportScore (${failureReasonAr('sportscore', ssRes)})`,
    });
    sourceResults.push({
      sourceId: 'sportscore',
      status: 'degraded',
      httpStatus: ssRes.httpStatus,
      latencyMs: ssRes.latencyMs,
      matchesFetched: 0,
      standingsFetched: ssStandingsCount,
      newsFetched: 0,
      usedCachedSnapshot: true,
      messageAr: `تعذر جلب المباريات من SportScore (${failureReasonAr('sportscore', ssRes)}${ssStatus ? ` — HTTP ${ssStatus}` : ''}${ssAttempts.length ? ` بعد تجربة ${ssAttempts.length} نقطة نهاية` : ''}). تم الاحتفاظ بالبيانات السابقة دون حذف.`,
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

  // 2. TheSportsDB — matches only, not a news source (started in parallel with SportScore above)
  const tsdbRes = await tsdbResPromise;
  writeTotals.recordsSkipped += tsdbRes.skippedRecords || 0;
  windowSkipped.thesportsdbDayCallsSkipped = tsdbRes.dayCallsSkipped || 0;
  if (tsdbRes.ok) {
    if (tsdbRes.matches.length > 0) addWrite(await upsertMatchesInStoreWithStats(tsdbRes.matches), 'thesportsdb');
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
      messageAr: `تم جلب ${tsdbRes.matches.length} مباراة من TheSportsDB (منها ${egyptianCount} للدوري المصري الممتاز)${failedEndpoints > 0 ? ` — فشل ${failedEndpoints} من ${tsdbRes.endpoints.length} نقطة نهاية` : ''}${tsdbRes.skippedEndpoints ? ` — تجاوز الوقت المخصص فتُخطّي ${tsdbRes.skippedEndpoints} طلبًا` : ''}${tsdbRes.dayCallsSkipped ? ` — لم تُطلب ${tsdbRes.dayCallsSkipped} أيام من النافذة` : ''}${tsdbRes.skippedRecords ? ` — تخطي ${tsdbRes.skippedRecords} سجلًا غير صالح أو غير كروي` : ''}.`,
      endpoints: tsdbRes.endpoints,
    });
    sourceUpdates.thesportsdb = {
      status: 'active',
      statusLabelAr: `متصل ومفعّل بالكامل (200 OK — مفتاح TheSportsDB مقبول من المزوّد)`,
      apiKeyProbes: tsdbRes.apiKeyProbes,
      lastSyncAt: new Date().toISOString(),
      lastHttpStatus: tsdbRes.httpStatus,
      lastLatencyMs: tsdbRes.latencyMs,
    };
  } else {
    recordSourceFailure(errors, 'thesportsdb', {
      httpStatus: tsdbRes.httpStatus,
      error: tsdbRes.error,
      messageAr: `تعذر جلب بيانات الدوري المصري من TheSportsDB (${failureReasonAr('thesportsdb', tsdbRes)})`,
    });
    sourceResults.push({
      sourceId: 'thesportsdb',
      status: 'degraded',
      httpStatus: tsdbRes.httpStatus,
      latencyMs: tsdbRes.latencyMs,
      matchesFetched: 0,
      standingsFetched: 0,
      newsFetched: 0,
      usedCachedSnapshot: true,
      messageAr: `تعذر جلب بيانات الدوري المصري من TheSportsDB (${failureReasonAr('thesportsdb', tsdbRes)}${tsdbRes.httpStatus ? ` — HTTP ${tsdbRes.httpStatus}` : ''}). تم الاحتفاظ بالبيانات السابقة دون حذف.`,
      endpoints: tsdbRes.endpoints,
    });
    sourceUpdates.thesportsdb = {
      status: 'degraded',
      statusLabelAr: 'تعذر الاتصال في آخر محاولة — البيانات السابقة محفوظة',
      lastSyncAt: new Date().toISOString(),
      lastHttpStatus: tsdbRes.httpStatus,
      lastLatencyMs: tsdbRes.latencyMs,
      apiKeyProbes: tsdbRes.apiKeyProbes,
      errorCount: (getGatewayDatabase().sources.thesportsdb?.errorCount || 0) + 1,
    };
  }

  const skipFootballData = Boolean(options.quick) && !(process.env.FOOTBALL_DATA_API_KEY || '').trim();
  const skipApiFootball = Boolean(options.quick) && !(process.env.API_FOOTBALL_KEY || '').trim();

  // 3. Football-Data.org — competitions/matches only, not a news source
  const fdRes = skipFootballData ? null : await isolateSource(
    'football-data',
    () => fetchFootballDataSync(syncWindow.from, syncWindow.to),
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
    errors,
    shouldRequireSource('football-data')
  );
  if (fdRes) {
    await upsertCompetitionsInStore(fdRes.competitions);
    await upsertSeasonsInStore(fdRes.seasons);
  }
  if (!fdRes) {
    // skipped in quick mode (no key => no matches from this source)
  } else if (fdRes.ok) {
    if (fdRes.matches.length > 0) addWrite(await upsertMatchesInStoreWithStats(fdRes.matches), 'football-data');
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
    recordSourceFailure(errors, 'football-data', {
      httpStatus: fdRes.httpStatus,
      error: fdRes.error,
      messageAr: `تعذر الاتصال بـ Football-Data.org (${fdRes.messageAr || 'بدون استجابة'})`,
    });
    sourceResults.push({
      sourceId: 'football-data',
      status: 'degraded',
      httpStatus: fdRes.httpStatus,
      latencyMs: fdRes.latencyMs,
      matchesFetched: 0,
      standingsFetched: 0,
      newsFetched: 0,
      usedCachedSnapshot: true,
      messageAr: shouldRunSource('football-data')
        ? `تعذر الاتصال بـ Football-Data.org في هذه المحاولة؛ تم الاحتفاظ بفهرس البطولات والمواسم السابق. ${fdRes.messageAr || ''}`.trim()
        : `${skipReasonAr('football-data')} — وحُفظ فهرس البطولات والمواسم السابق كما هو.`,
    });
  }

  // 4. API-Football — matches only, not a news source
  const apifRes = skipApiFootball ? null : await isolateSource(
    'api-football',
    () => fetchApiFootballSync(todayCairo, { includeLeague: true, season: apiFootballSeasonFor(todayCairo) }),
    {
      ok: false,
      status: 'requires_api_key' as SourceHealthStatus,
      httpStatus: null,
      latencyMs: 0,
      hasApiKey: false,
      matches: [],
      standings: [] as CompetitionStandingTable[],
      messageAr: 'تعذر الاتصال بـ API-Football.',
    },
    errors,
    shouldRequireSource('api-football')
  );
  let apifStandingsCount = 0;
  // التشغيل الواسع مع مفتاح API-Football: يُجلب كل يوم في النافذة (الترتيب يُجلب مع اليوم الحالي فقط).
  const apifExtraMatches: MatchRecord[] = [];
  if (apifRes && wideRun && (process.env.API_FOOTBALL_KEY || '').trim()) {
    for (const day of syncWindow.dates) {
      if (day === todayCairo) continue;
      if (Date.now() - syncStartedMs > WIDE_SYNC_SOURCE_BUDGET_MS) {
        windowSkipped.apiFootballDays.push(day);
        continue;
      }
      const extra = await isolateSource(
        'api-football',
        () => fetchApiFootballSync(day, { includeLeague: false, season: apiFootballSeasonFor(day) }),
        {
          ok: false,
          status: 'requires_api_key' as SourceHealthStatus,
          httpStatus: null,
          latencyMs: 0,
          hasApiKey: true,
          matches: [] as MatchRecord[],
          standings: [] as CompetitionStandingTable[],
          messageAr: 'تعذر الاتصال بـ API-Football لهذا اليوم.',
        },
        errors,
        shouldRequireSource('api-football')
      );
      if (extra.ok) apifExtraMatches.push(...extra.matches);
    }
  }
  if (apifRes) {
    const apifAllMatches = [...apifRes.matches, ...apifExtraMatches];
    if (apifRes.ok && apifAllMatches.length > 0) {
      addWrite(await upsertMatchesInStoreWithStats(apifAllMatches), 'api-football');
    }
    if (apifRes.ok && apifRes.standings.length > 0) {
      apifStandingsCount = await upsertStandingsInStore(apifRes.standings);
    }
    sourceResults.push({
      sourceId: 'api-football',
      status: apifRes.status,
      httpStatus: apifRes.httpStatus,
      latencyMs: apifRes.latencyMs,
      matchesFetched: apifAllMatches.length,
      standingsFetched: apifStandingsCount,
      newsFetched: 0,
      usedCachedSnapshot: !apifRes.ok,
      messageAr: shouldRunSource('api-football')
        ? apifRes.messageAr
        : `${skipReasonAr('api-football')} — وحُفظت بيانات المباريات السابقة كما هي.`,
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
  await recordMatchesSyncAttempt({
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
      dateWindow: describeWindow(syncWindow, windowSkipped),
    };
    await recordSyncExecution(logEntry, errors, sourceUpdates);
    return logEntry;
  }
  const newsSync = await runNewsSync(trigger, errors);
  // الخلاصات المباشرة تُسجَّل بسجلها الخاص قبل جريان Google؛ النافذة تُقاس من بداية
  // تشغيل البوابة كله حتى لا يُفلت الصف منها لترتيب السجلات داخل المخزن.
  const prRow = getGatewayDatabase().newsSourceSyncs.find(
    (rec) => rec.sourceId === 'publisher-rss' && rec.startedAt >= startedAt
  );
  if (prRow) {
    sourceResults.push({
      sourceId: 'publisher-rss',
      status: prRow.ok ? 'active' : 'degraded',
      httpStatus: prRow.httpStatus,
      latencyMs: prRow.latencyMs,
      matchesFetched: 0,
      standingsFetched: 0,
      newsFetched: prRow.fetchedCount,
      newsPublished: prRow.publishedCount,
      newsDuplicates: prRow.duplicateCount,
      newsRejected: prRow.rejectedCount,
      usedCachedSnapshot: !prRow.ok,
      messageAr: prRow.messageAr,
    });
  }
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
    dateWindow: describeWindow(syncWindow, windowSkipped),
  };

  await recordSyncExecution(logEntry, errors, sourceUpdates);

  /*
   * نسخة احتياطية مجدولة: خطة Vercel المجانية تسمح بمهمتين مجدولتين يوميًا،
   * وكلتاهما مستخدمة بالفعل للمزامنة — لذلك لا نضيف مهمة ثالثة، بل ننشئ النسخة
   * داخل مهمة المزامنة الصباحية نفسها، وبشرط ألّا تكون هناك نسخة أحدث من 20 ساعة.
   * ولو لم يكن هناك تخزين دائم فالنتيجة تقول ذلك صريحًا ولا تُنشئ شيئًا.
   */
  if (mode === 'daily') {
    try {
      const backup = await maybeCreateScheduledBackup({ minHours: 20, actor: { username: 'cron', role: 'owner' } });
      logEntry.trigger = `${logEntry.trigger} • ${backup.created ? `أُنشئت نسخة احتياطية (${backup.summary?.id ?? '—'})` : backup.messageAr}`;
    } catch (error) {
      errors.push({
        id: `err-backup-${Date.now()}`,
        sourceId: 'sportscore',
        timestamp: new Date().toISOString(),
        endpoint: 'backup',
        httpStatus: null,
        errorCode: 'backup_failed',
        message: error instanceof Error ? error.message : String(error),
        messageAr: 'تعذّر إنشاء النسخة الاحتياطية المجدولة؛ المزامنة نفسها اكتملت.',
      });
    }
  }

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
  const beforeDb = await hydrateStore();
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
