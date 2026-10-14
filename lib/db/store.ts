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
import type { TheSportsDBRoundWindow } from '../sources/thesportsdb';
import { FileStorageDriver } from '../storage/file-driver';
import { getStorageDriver } from '../storage';
import type { StorageDriverKind } from '../storage/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'gateway-store.json');

export interface PersistenceState {
  /** Active backend kind, or 'memory' when persistence is switched off. */
  mode: StorageDriverKind | 'memory';
  /** True when the last write actually landed in the backend. */
  ok: boolean;
  /**
   * True when that backend survives restarts AND is shared by every instance. A local file on a
   * serverless host is deliberately false, so the sync endpoint cannot report fake durability.
   */
  durable: boolean;
  error: string | null;
  target: string | null;
  bytes: number;
  writtenAt: string | null;
  lastWriteLatencyMs: number | null;
  /** True once `hydrateStore()` has loaded the authoritative document for this process. */
  hydrated: boolean;
  mirror: { matches: number; news: number; standings: number };
}

const INITIAL_PERSISTENCE_STATE: PersistenceState = {
  mode: 'memory',
  ok: false,
  durable: false,
  error: 'not_written',
  target: null,
  bytes: 0,
  writtenAt: null,
  lastWriteLatencyMs: null,
  hydrated: false,
  mirror: { matches: 0, news: 0, standings: 0 },
};

let memoryStore: GatewayDatabase | null = null;
let persistenceState: PersistenceState = { ...INITIAL_PERSISTENCE_STATE };
let hydrationPromise: Promise<GatewayDatabase> | null = null;

export function getPersistenceState(): PersistenceState {
  return { ...persistenceState, mirror: { ...persistenceState.mirror } };
}

/**
 * Persistence is off when NEMO_GATEWAY_STORE_PERSIST=off. `npm test` sets it so a test run never
 * rewrites the committed data/gateway-store.json or writes to a real cloud database. Production
 * and `npm run sync` persist.
 */
export function isStorePersistenceEnabled(): boolean {
  return (process.env.NEMO_GATEWAY_STORE_PERSIST || '').trim().toLowerCase() !== 'off';
}

/**
 * Synchronous bootstrap used only when a caller reads before hydration completed. It prefers the
 * local file (fast, always available) and never blocks a render on a network round-trip.
 */
function bootstrapStoreSynchronously(): GatewayDatabase {
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
    // Fall through to the verified seed dataset below.
  }
  memoryStore = migrateGatewayDatabase(buildInitialVerifiedDatabase());
  return memoryStore;
}

/**
 * Loads the authoritative GatewayDatabase from the configured storage backend.
 *
 * Every request entry point awaits this before reading, so a write performed by the cron job is
 * what the next visitor sees — including after a cold start, a redeploy, or a scale-out to a new
 * instance. When the cloud store is still empty (first deploy) it is seeded from the committed
 * local snapshot and written back, so the very first run publishes data instead of nothing.
 */
export function hydrateStore(options: { force?: boolean } = {}): Promise<GatewayDatabase> {
  if (memoryStore && persistenceState.hydrated && !options.force) {
    return Promise.resolve(memoryStore);
  }
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    const driver = getStorageDriver();
    const target = driver.describe().target;
    const read = await driver.read().catch((error: unknown) => ({
      ok: false as const,
      database: null,
      bytes: 0,
      origin: target,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    }));

    if (read.ok && read.database) {
      memoryStore = migrateGatewayDatabase(read.database);
      persistenceState = {
        ...persistenceState,
        mode: driver.kind,
        durable: driver.isDurable(),
        target,
        bytes: read.bytes,
        ok: true,
        error: null,
        hydrated: true,
      };
      return memoryStore;
    }

    // Cold start against an empty cloud store: seed it from the committed snapshot.
    const localDriver = new FileStorageDriver();
    const localRead = await localDriver.read();
    if (localRead.ok && localRead.database) {
      memoryStore = migrateGatewayDatabase(localRead.database);
      persistenceState = {
        ...persistenceState,
        mode: driver.kind,
        durable: driver.isDurable(),
        target,
        bytes: localRead.bytes,
        ok: false,
        error: `cloud_store_empty:${read.error || 'empty'}; seeded from local snapshot`,
        hydrated: true,
      };
      if (driver.kind !== 'file') {
        await persistGatewayDatabase(memoryStore);
      }
      return memoryStore;
    }

    const initial = migrateGatewayDatabase(buildInitialVerifiedDatabase());
    memoryStore = initial;
    persistenceState = {
      ...persistenceState,
      mode: driver.kind,
      durable: driver.isDurable(),
      target,
      ok: false,
      error: `empty_store_seeded:${read.error || 'empty'}`,
      hydrated: true,
    };
    await persistGatewayDatabase(initial);
    return memoryStore;
  })().finally(() => {
    hydrationPromise = null;
  });

  return hydrationPromise;
}

/** True when this process has already loaded the authoritative document. */
export function isStoreHydrated(): boolean {
  return persistenceState.hydrated && memoryStore !== null;
}

/**
 * Synchronous accessor for render paths. Await `hydrateStore()` first in every request entry
 * point; this accessor then returns the hydrated document without another round-trip.
 */
export function getGatewayDatabase(): GatewayDatabase {
  if (memoryStore) {
    return memoryStore;
  }
  return bootstrapStoreSynchronously();
}

/**
 * Writes the GatewayDatabase through the active storage driver and records exactly what
 * happened, including whether that backend is actually durable. Callers that must not return
 * before the data is safe await this.
 */
export async function persistGatewayDatabase(db: GatewayDatabase): Promise<PersistenceState> {
  memoryStore = db;
  if (!isStorePersistenceEnabled()) {
    persistenceState = {
      ...persistenceState,
      mode: 'memory',
      ok: false,
      durable: false,
      error: 'persistence_disabled',
      hydrated: persistenceState.hydrated,
    };
    return getPersistenceState();
  }

  const driver = getStorageDriver();
  const description = driver.describe();
  try {
    const result = await driver.write(db);
    if (result.ok) {
      persistenceState = {
        mode: driver.kind,
        ok: true,
        durable: driver.isDurable(),
        error: result.error ?? null,
        target: description.target,
        bytes: result.bytes,
        writtenAt: result.writtenAt,
        lastWriteLatencyMs: result.latencyMs,
        hydrated: true,
        mirror: result.mirror,
      };
    } else {
      persistenceState = {
        mode: driver.kind,
        ok: false,
        durable: driver.isDurable(),
        error: result.error || 'store_write_failed',
        target: description.target,
        bytes: 0,
        writtenAt: null,
        lastWriteLatencyMs: result.latencyMs,
        hydrated: true,
        mirror: { matches: 0, news: 0, standings: 0 },
      };
      console.error(`[store] write_failed driver=${driver.kind} error=${result.error}`);
    }
  } catch (error) {
    persistenceState = {
      mode: driver.kind,
      ok: false,
      durable: driver.isDurable(),
      error: error instanceof Error ? error.message : String(error),
      target: description.target,
      bytes: 0,
      writtenAt: null,
      lastWriteLatencyMs: null,
      hydrated: true,
      mirror: { matches: 0, news: 0, standings: 0 },
    };
    console.error(`[store] write_exception driver=${driver.kind} error=${persistenceState.error}`);
  }
  return getPersistenceState();
}

/**
 * Round-trip verification: writes the current document and reads it back from the backend.
 * The cron endpoints use this to prove durability instead of asserting it.
 */
export async function verifyStorageRoundTrip(): Promise<{
  ok: boolean;
  durable: boolean;
  driver: StorageDriverKind;
  target: string | null;
  matchesReadBack: number;
  newsReadBack: number;
  error: string | null;
  latencyMs: number;
}> {
  const startedAt = Date.now();
  const driver = getStorageDriver();
  const db = getGatewayDatabase();
  const write = await persistGatewayDatabase(db);
  if (!write.ok) {
    return {
      ok: false,
      durable: write.durable,
      driver: write.mode === 'memory' ? 'memory' : driver.kind,
      target: write.target,
      matchesReadBack: 0,
      newsReadBack: 0,
      error: write.error,
      latencyMs: Date.now() - startedAt,
    };
  }
  const read = await driver.read();
  return {
    ok: read.ok === true && Array.isArray(read.database?.matches),
    durable: driver.isDurable(),
    driver: driver.kind,
    target: driver.describe().target,
    matchesReadBack: read.database?.matches?.length ?? 0,
    newsReadBack: read.database?.news?.length ?? 0,
    error: read.ok ? null : read.error ?? 'readback_failed',
    latencyMs: Date.now() - startedAt,
  };
}

/** Test hook: clears the in-memory document and the persistence bookkeeping. */
export function resetStoreForTesting(): void {
  memoryStore = null;
  hydrationPromise = null;
  persistenceState = { ...INITIAL_PERSISTENCE_STATE };
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
export interface MatchUpsertStats {
  /** Records received from the sources (after source-level filtering). */
  processed: number;
  /** Records that did not exist in the store before. */
  inserted: number;
  /** Existing records whose stored content actually changed. */
  updated: number;
  /** Existing records that matched a fetched record with no content change. */
  unchanged: number;
}

function matchContentFingerprint(match: MatchRecord): string {
  return JSON.stringify({ ...match, lastUpdatedAt: null });
}

export async function upsertMatchesInStore(incomingMatches: MatchRecord[]): Promise<number> {
  return (await upsertMatchesInStoreWithStats(incomingMatches)).processed;
}

/** Same as upsertMatchesInStore but reports how many records were inserted or changed. */
export async function upsertMatchesInStoreWithStats(incomingMatches: MatchRecord[]): Promise<MatchUpsertStats> {
  const stats: MatchUpsertStats = { processed: 0, inserted: 0, updated: 0, unchanged: 0 };
  if (!incomingMatches || incomingMatches.length === 0) return stats;
  const db = getGatewayDatabase();
  const byId = new Map<string, MatchRecord>();
  const idByDedupKey = new Map<string, string>();
  for (const m of db.matches) {
    byId.set(m.id, m);
    const key = buildMatchDedupKey(m);
    if (!idByDedupKey.has(key)) idByDedupKey.set(key, m.id);
  }

  for (const inc of incomingMatches) {
    const dedupKey = buildMatchDedupKey(inc);
    const existingId = byId.has(inc.id) ? inc.id : idByDedupKey.get(dedupKey);
    const existing = existingId ? byId.get(existingId) : undefined;
    stats.processed++;
    if (!existing) {
      const fieldProvenance = Object.fromEntries(Object.entries(inc).filter(([key, value]) => value != null && !['nemoLink', 'fieldProvenance'].includes(key)).map(([key]) => [key, { source: inc.primarySource, observedAt: inc.lastUpdatedAt }]));
      byId.set(inc.id, { ...inc, fieldProvenance: inc.fieldProvenance || fieldProvenance });
      idByDedupKey.set(dedupKey, inc.id);
      stats.inserted++;
    } else {
      // Keep the record's existing id so links/news references stay stable; union ids/links.
      const merged = refreshNemoLink({ ...mergeMatchRecords(existing, { ...inc, id: existing.id }), id: existing.id });
      if (matchContentFingerprint(merged) === matchContentFingerprint(existing)) {
        stats.unchanged++;
      } else {
        stats.updated++;
      }
      byId.set(existing.id, merged);
      idByDedupKey.set(dedupKey, existing.id);
    }
  }

  db.matches = Array.from(byId.values()).sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return new Date(a.utcKickoff).getTime() - new Date(b.utcKickoff).getTime();
  });

  db.meta.lastLiveSyncAt = new Date().toISOString();
  await persistGatewayDatabase(db);
  return stats;
}

/** Season label (e.g. "2026-2027") for a Cairo date; the Egyptian season starts in July. */
export function egyptianSeasonLabelFor(cairoDate: string): string {
  const [year, month] = cairoDate.split('-').map(Number);
  return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

/**
 * Round window to request for the Egyptian league this run: the highest round already stored
 * for the current season, plus the one before and the one after. Only matches of the same
 * season count, so last season's round numbers never shift the window.
 */
export function getEgyptianRoundWindow(todayCairo: string): TheSportsDBRoundWindow {
  const season = egyptianSeasonLabelFor(todayCairo);
  const db = getGatewayDatabase();
  let highest = 0;
  for (const match of db.matches) {
    if (match.competitionCode !== 'EGY' || match.seasonLabel !== season || !match.roundLabelAr) continue;
    const n = Number(match.roundLabelAr.match(/(\d+)/)?.[1]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  const base = Math.max(1, highest);
  const rounds = Array.from(new Set([base - 1, base, base + 1])).filter((r) => r >= 1);
  return { season, rounds };
}

/** Records the outcome (success or failure) of one matches fetch attempt. */
export async function recordMatchesSyncAttempt(result: NonNullable<GatewayDatabase['meta']['lastMatchesSyncResult']>): Promise<void> {
  const db = getGatewayDatabase();
  const now = new Date().toISOString();
  db.meta.lastMatchesSyncAttemptAt = now;
  db.meta.lastMatchesSyncResult = result;
  if (result.ok) db.meta.lastSuccessfulMatchesSyncAt = now;
  await persistGatewayDatabase(db);
}

/**
 * Idempotently upserts standings tables into the store.
 */
export async function upsertStandingsInStore(tables: CompetitionStandingTable[]): Promise<number> {
  if (!tables || tables.length === 0) return 0;
  const db = getGatewayDatabase();
  let count = 0;
  for (const tbl of tables) {
    if (tbl && tbl.competitionCode && tbl.rows.length > 0) {
      db.standings[tbl.competitionCode] = tbl;
      count++;
    }
  }
  await persistGatewayDatabase(db);
  return count;
}

/**
 * Idempotently upserts seasons metadata into the store.
 */
export async function upsertSeasonsInStore(seasons: SeasonRecord[]): Promise<number> {
  if (!seasons || seasons.length === 0) return 0;
  const db = getGatewayDatabase();
  const byId = new Map<string, SeasonRecord>();
  for (const s of db.seasons) byId.set(s.id, s);
  for (const s of seasons) byId.set(s.id, s);
  db.seasons = Array.from(byId.values());
  await persistGatewayDatabase(db);
  return seasons.length;
}

/**
 * Idempotently upserts already-processed news items. Prefer ingestNewsCandidatesInStore for live imports.
 * Empty input never deletes existing news.
 */
export async function upsertNewsInStore(newsItems: NewsItemRecord[]): Promise<number> {
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
  await persistGatewayDatabase(db);
  return result.stats.imported;
}

export async function ingestNewsCandidatesInStore(candidates: RawNewsCandidate[]): Promise<{
  imported: number;
  published: number;
  duplicates: number;
  rejected: number;
  updated: number;
}> {
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
  await persistGatewayDatabase(db);
  return {
    imported: result.stats.imported,
    published: result.stats.published,
    duplicates: result.stats.duplicates,
    rejected: result.stats.rejected,
    updated: result.stats.updated,
  };
}

export async function recordNewsSync(sync: NewsSourceSyncRecord, errors: NewsImportErrorRecord[] = [], dedup: NewsDedupRecord[] = []): Promise<void> {
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
  await persistGatewayDatabase(db);
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
export async function recordSyncExecution(
  log: SyncLogEntry,
  errors: SourceErrorEntry[],
  sourceUpdates: Partial<Record<SourceId, Partial<GatewayDatabase['sources'][SourceId]>>>
): Promise<void> {
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

  for (const result of log.sourceResults) {
    const source = db.sources[result.sourceId];
    if (!source) continue;
    const hasData = result.matchesFetched > 0 || (result.newsPublished || 0) > 0 || result.standingsFetched > 0;
    source.lastSyncAt = log.finishedAt;
    source.lastHttpStatus = result.httpStatus;
    source.status = result.status;
    if (hasData && !result.usedCachedSnapshot) source.lastSuccessfulDataAt = log.finishedAt;
    else source.lastFailedDataAt = log.finishedAt;
  }
  db.syncLogs = [log, ...db.syncLogs].slice(0, 30);
  if (errors.length > 0) {
    db.sourceErrors = [...errors, ...db.sourceErrors].slice(0, 50);
  }
  db.meta.lastFullSyncAt = log.finishedAt;
  await persistGatewayDatabase(db);
}

/** A "live" status whose data has not been refreshed recently is not shown as live. */
export const STALE_LIVE_MAX_AGE_MS = 20 * 60 * 1000;

/**
 * Longest a match can plausibly stay "live" after kick-off: two halves, half-time, stoppage
 * time and extra time. Past this, a provider's "live" flag is treated as stale.
 */
export const LIVE_MAX_AFTER_KICKOFF_MS = 180 * 60 * 1000;

/** A match still shown as "not started" this long after kick-off is no longer believed. */
export const NOT_STARTED_GRACE_MS = 15 * 60 * 1000;

/**
 * Downgrades statuses the data no longer supports. Nothing is deleted, and the next successful
 * fetch restores the real status.
 *
 * - live: the record must be recently refreshed AND its kick-off must be known and within the
 *   plausible match window. The kick-off check is what catches a provider that keeps saying
 *   "live" hours after the match ended: each sync resets `lastUpdatedAt`, so freshness alone
 *   can never detect that.
 * - not_started: once the kick-off plus the grace period has passed, the match is no longer
 *   presented as "لم تبدأ بعد".
 * - Any match whose kick-off time was not confirmed by the source is shown as unconfirmed
 *   when its status is live or not_started.
 */
export function guardStaleLiveStatus(match: MatchRecord, now: Date = new Date()): MatchRecord {
  const nowMs = now.getTime();
  const kickoffMs = Date.parse(match.utcKickoff);
  const kickoffKnown = match.kickoffConfirmed === true && Number.isFinite(kickoffMs);

  if (match.status === 'live') {
    const updatedMs = Date.parse(match.lastUpdatedAt);
    const fresh = Number.isFinite(updatedMs) && nowMs - updatedMs <= STALE_LIVE_MAX_AGE_MS;
    const sinceKickoff = nowMs - kickoffMs;
    const plausible =
      kickoffKnown &&
      sinceKickoff >= -15 * 60 * 1000 &&
      sinceKickoff <= LIVE_MAX_AFTER_KICKOFF_MS;
    if (fresh && plausible) return match;
    return {
      ...match,
      status: 'unconfirmed',
      statusLabelAr: 'غير مؤكدة أو غير متاحة من المصدر',
      statusNoteAr: plausible
        ? 'آخر تحديث من المصدر قديم؛ لا نعرض المباراة كجارية حتى يصل تحديث جديد.'
        : 'المصدر يصفها بالمباشرة خارج مدة المباراة المعتادة أو بلا موعد مؤكد؛ لا نعرضها كمباراة جارية.',
      liveMinute: null,
    };
  }

  if (match.status === 'not_started') {
    if (!kickoffKnown) {
      return {
        ...match,
        status: 'unconfirmed',
        statusLabelAr: 'الموعد غير مؤكد من المصدر',
        statusNoteAr: 'لم يرسل المصدر موعد انطلاق مؤكدًا لهذه المباراة.',
      };
    }
    if (nowMs - kickoffMs > NOT_STARTED_GRACE_MS) {
      return {
        ...match,
        status: 'unconfirmed',
        statusLabelAr: 'بانتظار تأكيد الحالة من المصدر',
        statusNoteAr:
          'موعد انطلاق المباراة مضى ولم يصل تحديث من المصدر؛ لا نعرضها كمباراة لم تبدأ بعد.',
      };
    }
  }

  return match;
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

/** Persist newly observed provider competitions; discovery does not imply fixture entitlement. */
export async function upsertCompetitionsInStore(records: GatewayDatabase['competitions']): Promise<void> {
  if (!records.length) return;
  const db = getGatewayDatabase();
  const byId = new Map(db.competitions.map((c) => [c.id, c]));
  for (const record of records) byId.set(record.id, record);
  db.competitions = [...byId.values()];
  await persistGatewayDatabase(db);
}
