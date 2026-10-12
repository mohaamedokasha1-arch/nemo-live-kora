import fs from 'fs';
import path from 'path';
import {
  CompetitionStandingTable,
  GatewayDatabase,
  MatchRecord,
  NewsDedupRecord,
  NewsImportErrorRecord,
  NewsItemRecord,
  NewsSourceSyncRecord,
  RawNewsCandidate,
  SeasonRecord,
  SourceErrorEntry,
  SourceId,
  SyncLogEntry,
} from '../types';
import { processNewsBatch } from '../news/ingest';
import { isValidDateParam } from '../cairo-time';
import { buildMatchDedupKey } from '../match-identity';
import { resolveNemoSportsLink } from '../nemo-resolver';

export { buildMatchDedupKey };
import { migrateGatewayDatabase } from '../news/migrate';
import {
  getArchiveNews,
  getLatestNews,
  getNewsAdminStats,
  getPublishedNews,
} from '../news/query';
import { buildInitialVerifiedDatabase, mergeMatchRecords } from './seed-data';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'gateway-store.json');

let memoryStore: GatewayDatabase | null = null;

/**
 * Loads the unified GatewayDatabase from disk (data/gateway-store.json) or initializes it
 * with the verified real seed dataset if not yet written.
 */
export function getGatewayDatabase(): GatewayDatabase {
  if (memoryStore) {
    return memoryStore;
  }

  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as GatewayDatabase;
      if (parsed && parsed.meta && Array.isArray(parsed.matches)) {
        memoryStore = migrateGatewayDatabase(parsed);
        return memoryStore;
      }
    }
  } catch {
    // Fallback to initial verified database if file read fails
  }

  const initial = buildInitialVerifiedDatabase();
  memoryStore = initial;
  persistGatewayDatabase(initial);
  return initial;
}

/**
 * Persists the GatewayDatabase to data/gateway-store.json safely (non-fatal on read-only serverless fs).
 */
export function persistGatewayDatabase(db: GatewayDatabase): void {
  memoryStore = db;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch {
    // In read-only serverless environments (like Vercel lambda runtime), memoryStore remains active
  }
}

/** Recomputes the NEMO Sports link from the stored source identifiers. */
export function refreshNemoLink(match: MatchRecord): MatchRecord {
  return {
    ...match,
    nemoLink: resolveNemoSportsLink({
      canonicalMatchId: match.id,
      sportscoreSlug: match.externalIds.sportscoreSlug,
      sportscoreTrackerId: match.externalIds.sportscoreTrackerId,
      thesportsdbEventId: match.externalIds.thesportsdbEventId,
      apiFootballFixtureId: match.externalIds.apiFootballFixtureId,
      competitionCode: match.competitionCode,
      homeTeamId: match.homeTeam.id,
      awayTeamId: match.awayTeam.id,
      cairoDate: match.cairoDate,
    }),
  };
}

/**
 * Idempotently upserts matches into the store without ever deleting existing matches on partial
 * failure. Matches are matched first by stable id, then by the cross-source dedup key so the same
 * fixture is never duplicated when a second provider reports it.
 */
export function upsertMatchesInStore(incomingMatches: MatchRecord[]): number {
  if (!incomingMatches || incomingMatches.length === 0) return 0;
  const db = getGatewayDatabase();
  const byId = new Map<string, MatchRecord>();
  const idByDedupKey = new Map<string, string>();
  for (const m of db.matches) {
    byId.set(m.id, m);
    const key = buildMatchDedupKey(m);
    if (!idByDedupKey.has(key)) idByDedupKey.set(key, m.id);
  }

  let upserted = 0;
  for (const inc of incomingMatches) {
    const dedupKey = buildMatchDedupKey(inc);
    const existingId = byId.has(inc.id) ? inc.id : idByDedupKey.get(dedupKey);
    const existing = existingId ? byId.get(existingId) : undefined;
    if (!existing) {
      byId.set(inc.id, inc);
      idByDedupKey.set(dedupKey, inc.id);
    } else {
      // Keep the record's existing id so links/news references stay stable; union ids/links.
      const merged = refreshNemoLink({ ...mergeMatchRecords(existing, { ...inc, id: existing.id }), id: existing.id });
      byId.set(existing.id, merged);
      idByDedupKey.set(dedupKey, existing.id);
    }
    upserted++;
  }

  db.matches = Array.from(byId.values()).sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return new Date(a.utcKickoff).getTime() - new Date(b.utcKickoff).getTime();
  });

  db.meta.lastLiveSyncAt = new Date().toISOString();
  persistGatewayDatabase(db);
  return upserted;
}

/** Records the outcome (success or failure) of one matches fetch attempt. */
export function recordMatchesSyncAttempt(result: NonNullable<GatewayDatabase['meta']['lastMatchesSyncResult']>): void {
  const db = getGatewayDatabase();
  const now = new Date().toISOString();
  db.meta.lastMatchesSyncAttemptAt = now;
  db.meta.lastMatchesSyncResult = result;
  if (result.ok) db.meta.lastSuccessfulMatchesSyncAt = now;
  persistGatewayDatabase(db);
}

/**
 * Idempotently upserts standings tables into the store.
 */
export function upsertStandingsInStore(tables: CompetitionStandingTable[]): number {
  if (!tables || tables.length === 0) return 0;
  const db = getGatewayDatabase();
  let count = 0;
  for (const tbl of tables) {
    if (tbl && tbl.competitionCode && tbl.rows.length > 0) {
      db.standings[tbl.competitionCode] = tbl;
      count++;
    }
  }
  persistGatewayDatabase(db);
  return count;
}

/**
 * Idempotently upserts seasons metadata into the store.
 */
export function upsertSeasonsInStore(seasons: SeasonRecord[]): number {
  if (!seasons || seasons.length === 0) return 0;
  const db = getGatewayDatabase();
  const byId = new Map<string, SeasonRecord>();
  for (const s of db.seasons) byId.set(s.id, s);
  for (const s of seasons) byId.set(s.id, s);
  db.seasons = Array.from(byId.values());
  persistGatewayDatabase(db);
  return seasons.length;
}

/**
 * Idempotently upserts already-processed news items. Prefer ingestNewsCandidatesInStore for live imports.
 * Empty input never deletes existing news.
 */
export function upsertNewsInStore(newsItems: NewsItemRecord[]): number {
  if (!newsItems || newsItems.length === 0) return 0;
  const db = getGatewayDatabase();
  const result = processNewsBatch(
    db.news,
    newsItems.map((item) => ({
      sourceId: item.sourceId,
      sourceItemId: item.sourceItemId,
      title: item.title,
      link: item.link,
      originalUrl: item.originalUrl || item.link,
      publishedAt: item.publishedAt,
      publishedAtKnown: item.publishedAtKnown,
      updatedAt: item.updatedAt,
      excerpt: item.excerpt,
      imageUrl: item.imageUrl,
      publisherName: item.publisherName,
      publisherUrl: item.publisherUrl,
      language: item.language,
      categoryAr: item.categoryAr,
      fetchedAt: item.fetchedAt,
    })),
    {
      matches: db.matches,
      teams: db.teams,
      competitions: db.competitions,
    }
  );
  db.news = result.news;
  persistGatewayDatabase(db);
  return result.stats.imported;
}

export function ingestNewsCandidatesInStore(candidates: RawNewsCandidate[]): {
  imported: number;
  published: number;
  duplicates: number;
  rejected: number;
  updated: number;
} {
  if (!candidates || candidates.length === 0) {
    return { imported: 0, published: 0, duplicates: 0, rejected: 0, updated: 0 };
  }
  const db = getGatewayDatabase();
  const result = processNewsBatch(db.news, candidates, {
    matches: db.matches,
    teams: db.teams,
    competitions: db.competitions,
  });
  db.news = result.news;
  db.newsImportErrors = [...result.errors, ...db.newsImportErrors].slice(0, 80);
  db.newsDedupRecords = [...result.dedupRecords, ...db.newsDedupRecords].slice(0, 80);
  persistGatewayDatabase(db);
  return {
    imported: result.stats.imported,
    published: result.stats.published,
    duplicates: result.stats.duplicates,
    rejected: result.stats.rejected,
    updated: result.stats.updated,
  };
}

export function recordNewsSync(sync: NewsSourceSyncRecord, errors: NewsImportErrorRecord[] = [], dedup: NewsDedupRecord[] = []): void {
  const db = getGatewayDatabase();
  db.newsSourceSyncs = [sync, ...db.newsSourceSyncs].slice(0, 40);
  if (errors.length > 0) {
    db.newsImportErrors = [...errors, ...db.newsImportErrors].slice(0, 80);
  }
  if (dedup.length > 0) {
    db.newsDedupRecords = [...dedup, ...db.newsDedupRecords].slice(0, 80);
  }
  db.meta.lastNewsSyncAt = sync.finishedAt;
  if (sync.ok) {
    db.meta.lastSuccessfulNewsSyncAt = sync.finishedAt;
  }
  const source = db.sources[sync.sourceId];
  if (source) {
    source.lastSyncAt = sync.finishedAt;
    source.lastHttpStatus = sync.httpStatus;
    source.lastLatencyMs = sync.latencyMs;
    source.newsImportedCount = db.news.filter((item) => item.sourceId === sync.sourceId).length;
    source.newsPublishedCount = db.news.filter(
      (item) => item.sourceId === sync.sourceId && item.publishStatus === 'published'
    ).length;
    source.recordsImported = source.newsPublishedCount;
    source.errorCount = sync.ok ? source.errorCount : (source.errorCount || 0) + 1;
    if (sync.ok) {
      source.status = 'active';
      source.statusLabelAr = `تم جلب أخبار حقيقية ونشر ${sync.publishedCount} خبرًا بعد التحقق`;
      source.lastSuccessfulNewsSyncAt = sync.finishedAt;
    } else {
      source.status = 'degraded';
      source.statusLabelAr =
        'تعذر جلب الأخبار من المصدر — لم تُحذف الأخبار المنشورة سابقًا ولم يُعرض فشل HTTP باعتباره نجاحًا';
    }
  }
  persistGatewayDatabase(db);
}

export function queryPublishedNews(limit = 12) {
  const db = getGatewayDatabase();
  return getLatestNews(db.news, limit);
}

export function queryArchiveNews() {
  const db = getGatewayDatabase();
  return getArchiveNews(db.news);
}

export function queryAllPublishedNews() {
  const db = getGatewayDatabase();
  return getPublishedNews(db.news);
}

export function queryNewsAdminStats() {
  const db = getGatewayDatabase();
  return getNewsAdminStats(db.news);
}

/**
 * Records a sync log entry and optional source error entries.
 */
export function recordSyncExecution(
  log: SyncLogEntry,
  errors: SourceErrorEntry[],
  sourceUpdates: Partial<Record<SourceId, Partial<GatewayDatabase['sources'][SourceId]>>>
): void {
  const db = getGatewayDatabase();
  for (const [sId, patch] of Object.entries(sourceUpdates) as Array<
    [SourceId, Partial<GatewayDatabase['sources'][SourceId]>]
  >) {
    if (db.sources[sId] && patch) {
      db.sources[sId] = {
        ...db.sources[sId],
        ...patch,
      };
    }
  }

  db.syncLogs = [log, ...db.syncLogs].slice(0, 30);
  if (errors.length > 0) {
    db.sourceErrors = [...errors, ...db.sourceErrors].slice(0, 50);
  }
  db.meta.lastFullSyncAt = log.finishedAt;
  persistGatewayDatabase(db);
}

/** A "live" status older than this is not shown as live; the source has not confirmed it recently. */
export const STALE_LIVE_MAX_AGE_MS = 20 * 60 * 1000;

/**
 * A record can only be presented as "جارية الآن" while the data behind it is fresh. Between
 * refreshes (or after a source outage) a stale live record is downgraded to "unconfirmed"
 * instead of pretending a live score is current. Nothing is deleted; the next successful
 * fetch restores the real status.
 */
export function guardStaleLiveStatus(match: MatchRecord, now: Date = new Date()): MatchRecord {
  if (match.status !== 'live') return match;
  const updatedMs = Date.parse(match.lastUpdatedAt);
  if (Number.isFinite(updatedMs) && now.getTime() - updatedMs <= STALE_LIVE_MAX_AGE_MS) return match;
  return {
    ...match,
    status: 'unconfirmed',
    statusLabelAr: 'غير مؤكدة أو غير متاحة من المصدر',
    statusNoteAr: 'آخر تحديث من المصدر قديم؛ لا نعرض المباراة كجارية حتى يصل تحديث جديد.',
    liveMinute: null,
  };
}

/**
 * Query helper: returns matches for a specific Cairo date (or all dates) with optional filters,
 * plus available filter options computed ONLY from real data (Section 5: "لا تعرض خيار تصفية لا توجد له بيانات فعلية").
 */
export function queryGatewayMatches(params: {
  cairoDate?: string;
  competitionCode?: string;
  countryAr?: string;
  searchQuery?: string;
  onlyEgyptianInterest?: boolean;
}) {
  const db = getGatewayDatabase();
  const targetDate = params.cairoDate;

  // Step 1: Filter by date first to compute real available competitions & countries on that date
  const matchesWithValidDate = db.matches
    .filter((match) => isValidDateParam(match.cairoDate))
    .map((match) => guardStaleLiveStatus(match));
  const matchesOnDate = targetDate
    ? matchesWithValidDate.filter((match) => match.cairoDate === targetDate)
    : matchesWithValidDate;

  // Compute filter options ONLY from competitions and countries that actually have matches on this date
  const competitionCounts = new Map<
    string,
    { code: string; nameAr: string; countryAr: string; priority: number; count: number }
  >();
  const countryCounts = new Map<string, number>();

  for (const m of matchesOnDate) {
    const existingComp = competitionCounts.get(m.competitionCode);
    if (existingComp) {
      existingComp.count += 1;
    } else {
      competitionCounts.set(m.competitionCode, {
        code: m.competitionCode,
        nameAr: m.competitionNameAr,
        countryAr: m.countryAr,
        priority: m.priority,
        count: 1,
      });
    }
    countryCounts.set(m.countryAr, (countryCounts.get(m.countryAr) || 0) + 1);
  }

  const availableCompetitions = Array.from(competitionCounts.values()).sort(
    (a, b) => a.priority - b.priority
  );
  const availableCountries = Array.from(countryCounts.entries())
    .map(([countryAr, count]) => ({ countryAr, count }))
    .sort((a, b) => {
      if (a.countryAr === 'مصر') return -1;
      if (b.countryAr === 'مصر') return 1;
      return b.count - a.count;
    });

  // Compute all dates that have matches in the database
  const dateCounts = new Map<string, { date: string; total: number; egyptianCount: number }>();
  for (const m of db.matches) {
    const entry = dateCounts.get(m.cairoDate) || {
      date: m.cairoDate,
      total: 0,
      egyptianCount: 0,
    };
    entry.total += 1;
    if (m.isEgyptianInterest) entry.egyptianCount += 1;
    dateCounts.set(m.cairoDate, entry);
  }
  const availableDates = Array.from(dateCounts.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // Step 2: Apply user filters (competition, country, search, Egyptian interest)
  let filtered = matchesOnDate;
  if (params.competitionCode && params.competitionCode !== 'ALL') {
    filtered = filtered.filter((m) => m.competitionCode === params.competitionCode);
  }
  if (params.countryAr && params.countryAr !== 'ALL') {
    filtered = filtered.filter((m) => m.countryAr === params.countryAr);
  }
  if (params.onlyEgyptianInterest) {
    filtered = filtered.filter((m) => m.isEgyptianInterest);
  }
  if (params.searchQuery && params.searchQuery.trim() !== '') {
    const q = params.searchQuery.trim().toLowerCase();
    filtered = filtered.filter(
      (m) =>
        m.homeTeam.nameAr.toLowerCase().includes(q) ||
        m.awayTeam.nameAr.toLowerCase().includes(q) ||
        m.homeTeam.nameEn.toLowerCase().includes(q) ||
        m.awayTeam.nameEn.toLowerCase().includes(q) ||
        m.competitionNameAr.toLowerCase().includes(q) ||
        m.competitionNameEn.toLowerCase().includes(q)
    );
  }

  // Group filtered matches by competition, ordered by Egyptian priority first
  const groupedMap = new Map<
    string,
    {
      competitionCode: string;
      competitionNameAr: string;
      competitionNameEn: string;
      competitionLogo: string | null;
      countryAr: string;
      priority: number;
      isEgyptianInterest: boolean;
      nemoCompetitionUrl: string | null;
      matches: MatchRecord[];
    }
  >();

  for (const m of filtered) {
    const existingGroup = groupedMap.get(m.competitionCode);
    if (existingGroup) {
      existingGroup.matches.push(m);
    } else {
      groupedMap.set(m.competitionCode, {
        competitionCode: m.competitionCode,
        competitionNameAr: m.competitionNameAr,
        competitionNameEn: m.competitionNameEn,
        competitionLogo: m.competitionLogo,
        countryAr: m.countryAr,
        priority: m.priority,
        isEgyptianInterest: m.isEgyptianInterest,
        nemoCompetitionUrl: m.nemoLink.competitionUrl,
        matches: [m],
      });
    }
  }

  const groups = Array.from(groupedMap.values()).sort((a, b) => a.priority - b.priority);

  return {
    matches: filtered,
    groups,
    totalOnDate: matchesOnDate.length,
    totalInStore: db.matches.length,
    availableCompetitions,
    availableCountries,
    availableDates,
    lastSyncAt: db.meta.lastLiveSyncAt,
    lastMatchesSyncAttemptAt: db.meta.lastMatchesSyncAttemptAt ?? null,
    lastSuccessfulMatchesSyncAt: db.meta.lastSuccessfulMatchesSyncAt ?? null,
    lastMatchesSyncResult: db.meta.lastMatchesSyncResult ?? null,
  };
}
