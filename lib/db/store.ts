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
import {
  DurableStoreError,
  decodeStoredSnapshot,
  describeDurableBackend,
  encodeSnapshot,
  isPersistenceDisabled,
  isServerlessRuntime,
  resolveDurableBackend,
  resolveLocalStoreFile,
  type DurableStoreErrorCode,
} from './durable-store';
import { writeFileAtomic } from './atomic-file';

export { isServerlessRuntime, resolveLocalStoreFile };

/**
 * Local structured-JSON layout. The writable snapshot is resolved by `durable-store.ts`
 * (`<cwd>/data` on a normal host, `/tmp` on serverless, `NEMO_DATA_DIR` when set). The bundled
 * snapshot shipped in the deployment is read-only on Vercel and only ever serves as a seed.
 */

/** The read-only snapshot bundled with the deployment; used only as a seed/fallback. */
export function bundledStoreFile(): string {
  return path.join(process.cwd(), 'data', 'gateway-store.json');
}

/**
 * Where the snapshot can actually be read back from:
 *  - `file` — the local structured JSON document (atomic writes). Durable on a normal server or a
 *    mounted volume; on serverless it is the warm-instance `/tmp` copy and is reported as such.
 *  - `memory` — process memory only (persistence explicitly disabled).
 */
export type PersistenceMode = 'memory' | 'file';

export interface PersistenceState {
  mode: PersistenceMode;
  /** The last local/durable write attempt succeeded. */
  ok: boolean;
  /** `true` only when the snapshot survives restarts *and* is visible to other instances. */
  durable: boolean;
  /** Whether this environment resolves to an external store at all — the actionable root cause. */
  durableConfigured: boolean;
  error: string | null;
  /** ISO timestamp of the last confirmed durable write/read. */
  at: string | null;
}

let memoryStore: GatewayDatabase | null = null;
let durableState: { ok: boolean; error: string | null; at: string | null } = {
  ok: false, error: 'not_flushed', at: null,
};
/** Set by every store mutation, cleared by a successful durable write. */
let durableDirty = false;
/**
 * A snapshot may only be pushed upstream *after* the current remote state was read. Otherwise a
 * freshly booted instance would overwrite newer production data with its bundled seed snapshot.
 */
let hydratedFromDurable = false;
let flushPromise: Promise<PersistenceState> | null = null;
let afterCallbackPending = false;
/** A local-file failure is logged once, never per mutation. */
let localWriteFailureLogged = false;

export function getPersistenceState(): PersistenceState {
  if (resolveDurableBackend()) {
    return {
      mode: 'file',
      ok: durableState.ok,
      // Survives cold starts and is visible to every instance only on a real disk (or a volume the
      // operator declared durable). On serverless `/tmp` is per-instance: reported as not durable.
      durable: durableState.ok && (!isServerlessRuntime() || isFileStorageDeclaredDurable()),
      durableConfigured: true,
      error: durableState.ok ? null : durableState.error,
      at: durableState.at,
    };
  }
  return {
    mode: 'memory',
    ok: false,
    durable: false,
    durableConfigured: false,
    error: 'persistence_disabled',
    at: null,
  };
}

/** True when the operator declared the local disk a persistent volume (see `lib/storage/`). */
export function isFileStorageDeclaredDurable(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NEMO_STORAGE_FILE_DURABLE || '').trim().toLowerCase() === 'true';
}

export function getDurableStoreStatus() {
  const backend = describeDurableBackend();
  return {
    ...backend,
    hydrated: hydratedFromDurable,
    dirty: durableDirty,
    serverless: isServerlessRuntime(),
    localFile: resolveLocalStoreFile(),
    lastError: durableState.error,
    lastSuccessAt: durableState.at,
  };
}

/**
 * Disk persistence is off when NEMO_GATEWAY_STORE_PERSIST=off. `npm test` sets it so a test run
 * never rewrites the committed data/gateway-store.json. Production and `npm run sync` persist.
 */
export function isStorePersistenceEnabled(): boolean {
  return !isPersistenceDisabled();
}

/**
 * Reads the newest snapshot from the configured durable backend into memory. Called once per
 * process (see `instrumentation.ts`) before the app serves traffic. Without a configured backend,
 * or when this instance already hydrated, it is a no-op. Failures never throw: the store keeps the
 * bundled/on-disk snapshot and reports the error through `getPersistenceState()`.
 */
export async function hydrateGatewayDatabase(): Promise<PersistenceState> {
  const backend = resolveDurableBackend();
  if (!backend) {
    hydratedFromDurable = false;
    return getPersistenceState();
  }
  if (hydratedFromDurable) return getPersistenceState();

  try {
    const raw = await backend.read();
    if (raw === null) {
      // No snapshot stored yet: this instance is free to create the first one.
      hydratedFromDurable = true;
      durableState = { ok: true, error: null, at: new Date().toISOString() };
    } else {
      // Envelope written by this layer, or a legacy raw document from lib/storage tooling.
      const { snapshot, savedAt } = decodeStoredSnapshot(raw);
      if (!isGatewayDatabaseShape(snapshot)) {
        throw new DurableStoreError('store_snapshot_invalid', 'shape_mismatch');
      }
      memoryStore = migrateGatewayDatabase(snapshot);
      hydratedFromDurable = true;
      durableDirty = false;
      durableState = { ok: true, error: null, at: savedAt || new Date().toISOString() };
    }
    console.info('[store] hydrated_from_durable', JSON.stringify({ backend: backend.id, at: durableState.at }));
  } catch (error) {
    hydratedFromDurable = false;
    durableState = { ok: false, error: errorCode(error, 'store_read_failed'), at: null };
    console.error('[store] hydrate_failed', durableState.error, error instanceof Error ? error.message : '');
  }
  return getPersistenceState();
}

/**
 * Writes the in-memory snapshot to the durable backend when it changed. The cron endpoint awaits
 * this so its response reflects real, shared storage rather than a lambda-local write.
 */
export function flushDurableStore(options: { force?: boolean } = {}): Promise<PersistenceState> {
  const backend = resolveDurableBackend();
  if (!backend) return Promise.resolve(getPersistenceState());
  if (!options.force && !durableDirty) return Promise.resolve(getPersistenceState());
  if (!hydratedFromDurable) {
    durableState = { ok: false, error: 'store_not_hydrated', at: null };
    console.error('[store] flush_refused_unhydrated_instance');
    return Promise.resolve(getPersistenceState());
  }
  if (flushPromise) return flushPromise;

  flushPromise = (async () => {
    try {
      // Drain in a bounded loop: a mutation landing while a write is in flight marks the store
      // dirty again, and an awaited flush must only resolve once the backend holds that data too.
      for (let pass = 0; pass < 3; pass += 1) {
        const payload = encodeSnapshot(memoryStore ?? getGatewayDatabase());
        durableDirty = false;
        try {
          await backend.write(payload);
          durableState = { ok: true, error: null, at: new Date().toISOString() };
        } catch (error) {
          durableDirty = true;
          durableState = { ok: false, error: errorCode(error, 'store_write_failed'), at: null };
          console.error('[store] durable_write_failed', durableState.error, error instanceof Error ? error.message : '');
          break;
        }
        if (!durableDirty) break;
      }
    } finally {
      flushPromise = null;
    }
    // Mutations that arrived during the final pass are flushed after the response, as usual.
    if (durableDirty && durableState.ok) scheduleDurableFlush();
    return getPersistenceState();
  })();
  return flushPromise;
}

/**
 * Best-effort flush for requests that are not the scheduled cron: registers a single post-response
 * callback via `after()` (outside a Next request scope, e.g. in a CLI script, it flushes inline).
 * Concurrent mutations coalesce into one write.
 */
export function scheduleDurableFlush(): void {
  if (!resolveDurableBackend()) return;
  if (afterCallbackPending) return;
  afterCallbackPending = true;
  void (async () => {
    try {
      const { after } = await import('next/server');
      after(() => {
        afterCallbackPending = false;
        void flushDurableStore();
      });
    } catch {
      afterCallbackPending = false;
      await flushDurableStore();
    }
  })();
}

/** Test-only: clears module-level state so environment changes take effect between cases. */
export function resetStoreStateForTests(): void {
  memoryStore = null;
  durableDirty = false;
  hydratedFromDurable = false;
  flushPromise = null;
  afterCallbackPending = false;
  durableState = { ok: false, error: 'not_flushed', at: null };
}

/** Compacts any thrown value into the short machine-readable code stored in the persistence state. */
function errorCode(error: unknown, fallback: DurableStoreErrorCode): string {
  if (error instanceof DurableStoreError) return error.code;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `${fallback}_timeout`;
  }
  return fallback;
}

function isGatewayDatabaseShape(value: unknown): value is GatewayDatabase {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GatewayDatabase>;
  return Boolean(candidate.meta && Array.isArray(candidate.matches));
}

/** Reads and validates one local JSON snapshot file; returns null when absent or invalid. */
function readLocalStoreFile(file: string): GatewayDatabase | null {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as GatewayDatabase;
    if (parsed && parsed.meta && Array.isArray(parsed.matches)) {
      return migrateGatewayDatabase(parsed);
    }
  } catch {
    // An unreadable local copy must never take the store down; the caller falls back.
  }
  return null;
}

/**
 * Loads the unified GatewayDatabase: durable hydration (when configured) has already replaced
 * the in-memory copy by the time most callers run; this synchronous path seeds memory from the
 * writable local file, then the bundled snapshot, then the verified seed dataset.
 */
export function getGatewayDatabase(): GatewayDatabase {
  if (memoryStore) {
    return memoryStore;
  }

  const writable = readLocalStoreFile(resolveLocalStoreFile());
  if (writable) {
    memoryStore = writable;
    return memoryStore;
  }
  const bundledFile = bundledStoreFile();
  if (bundledFile !== resolveLocalStoreFile()) {
    const bundled = readLocalStoreFile(bundledFile);
    if (bundled) {
      memoryStore = bundled;
      return memoryStore;
    }
  }

  const initial = buildInitialVerifiedDatabase();
  memoryStore = initial;
  persistGatewayDatabase(initial);
  return initial;
}

/**
 * Persists the GatewayDatabase: an atomic structured-JSON write to the writable local file plus
 * a debounced push to the durable backend when one is configured.
 *
 * On serverless the local write goes to the writable temp directory — never into the read-only
 * deployment bundle, which is what used to log `store_write_failed` for every mutation even when
 * the durable write later succeeded. A local failure is recorded in the persistence state and
 * logged once as a warning; it is only the whole story when no durable backend is configured,
 * and `getPersistenceState()` then still reports the data as non-durable.
 */
export function persistGatewayDatabase(db: GatewayDatabase): void {
  memoryStore = db;
  durableDirty = true;
  if (isStorePersistenceEnabled()) {
    const file = resolveLocalStoreFile();
    try {
      writeFileAtomic(file, encodeSnapshot(db));
    } catch (error) {
      if (!localWriteFailureLogged) {
        localWriteFailureLogged = true;
        console.warn(
          '[store] local_file_write_failed',
          JSON.stringify({
            file,
            message: error instanceof Error ? error.message : 'unknown_error',
          })
        );
      }
    }
  }
  // The debounced flush re-writes the snapshot and records its outcome in the persistence state.
  scheduleDurableFlush();
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

export function upsertMatchesInStore(incomingMatches: MatchRecord[]): number {
  return upsertMatchesInStoreWithStats(incomingMatches).processed;
}

/** Same as upsertMatchesInStore but reports how many records were inserted or changed. */
export function upsertMatchesInStoreWithStats(incomingMatches: MatchRecord[]): MatchUpsertStats {
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
  persistGatewayDatabase(db);
  return stats;
}

/** Season label (e.g. "2026-2027") for a Cairo date; the Egyptian season starts in July. */
export function egyptianSeasonLabelFor(cairoDate: string): string {
  const [year, month] = cairoDate.split('-').map(Number);
  return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

/**
 * Round window to request for the Egyptian league this run: the highest round already stored
 * for the current season,d numbers never shift the window.
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
  persistGatewayDatabase(db);
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
      statusLabelAr: 'قيد التحديث',
      statusNoteAr: plausible
        ? 'تُحدَّث حالة المباراة تلقائيًا من المصدر.'
        : 'تُحدَّث حالة المباراة تلقائيًا من المصدر.',
      liveMinute: null,
    };
  }

  if (match.status === 'not_started') {
    if (!kickoffKnown) {
      return {
        ...match,
        status: 'unconfirmed',
        statusLabelAr: 'الموعد غير مؤكد من المصدر',
        statusNoteAr: 'سيُعرض الموعد الرسمي فور إعلانه.',
      };
    }
    if (nowMs - kickoffMs > NOT_STARTED_GRACE_MS) {
      return {
        ...match,
        status: 'unconfirmed',
        statusLabelAr: 'بانتظار تأكيد الحالة من المصدر',
        statusNoteAr:
          'تُحدَّث حالة المباراة تلقائيًا من المصدر.',
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
export function upsertCompetitionsInStore(records: GatewayDatabase['competitions']): void {
  if (!records.length) return;
  const db = getGatewayDatabase();
  const byId = new Map(db.competitions.map((c) => [c.id, c]));
  for (const record of records) byId.set(record.id, record);
  db.competitions = [...byId.values()];
  persistGatewayDatabase(db);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Compatibility adapters
 *
 * The durable-store layer above is the single writer for the request path. These adapters keep the
 * older call convention (`hydrateStore()` returning the database) working without duplicating any
 * write logic, so pages, API routes and the audit tooling read the very same snapshot the durable
 * layer adopted. They never write.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Adopts the shared snapshot, then returns the in-memory database. */
export async function hydrateStore(): Promise<GatewayDatabase> {
  await hydrateGatewayDatabase();
  return getGatewayDatabase();
}

/** Alias kept for existing tests; the durable layer owns the real reset. */
export function resetStoreForTesting(): void {
  resetStoreStateForTests();
}

export interface StorageRoundTripResult {
  ok: boolean;
  /** True when the snapshot is stored somewhere shared and persistent, not lambda-local. */
  durable: boolean;
  driver: PersistenceMode;
  target: string;
  matchesReadBack: number;
  newsReadBack: number;
  error: string | null;
  latencyMs: number;
}

/**
 * Proves the snapshot can be read back from the local document, and that what comes back is the
 * data we hold — not a bundled or stale copy. A sync that reports success without this would be
 * reporting a write nobody can read.
 */
export async function verifyStorageRoundTrip(): Promise<StorageRoundTripResult> {
  const startedAt = Date.now();
  const state = getPersistenceState();
  const backend = resolveDurableBackend();
  const base = {
    durable: state.durable,
    driver: state.mode,
    target: backend?.target ?? resolveLocalStoreFile(),
    latencyMs: 0,
  };

  if (!backend) {
    return { ...base, ok: false, matchesReadBack: 0, newsReadBack: 0, error: 'no_durable_backend', latencyMs: Date.now() - startedAt };
  }

  try {
    const raw = await backend.read();
    const latencyMs = Date.now() - startedAt;
    if (raw === null) {
      return { ...base, ok: false, matchesReadBack: 0, newsReadBack: 0, error: 'store_empty', latencyMs };
    }
    const { snapshot } = decodeStoredSnapshot(raw);
    if (!isGatewayDatabaseShape(snapshot)) {
      return { ...base, ok: false, matchesReadBack: 0, newsReadBack: 0, error: 'store_snapshot_invalid', latencyMs };
    }
    const db = snapshot as GatewayDatabase;
    const expected = getGatewayDatabase();
    const ok =
      db.matches.length === expected.matches.length &&
      db.news.length === expected.news.length &&
      Object.keys(db.standings).length === Object.keys(expected.standings).length;
    return {
      ...base,
      ok,
      matchesReadBack: db.matches.length,
      newsReadBack: db.news.length,
      error: ok ? null : 'store_readback_mismatch',
      latencyMs,
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      matchesReadBack: 0,
      newsReadBack: 0,
      error: error instanceof DurableStoreError ? error.code : 'store_read_failed',
      latencyMs: Date.now() - startedAt,
    };
  }
}

/**
 * Honest, operator-readable notes for the sync and cron responses. They never change the HTTP
 * status: the endpoints answer 200 and expose the real state through `status`, `syncOk`, `durable`
 * and this list, so a monitor can still see a degraded run.
 */
export function describeStorageWarnings(persistence: PersistenceState, syncOk: boolean): string[] {
  const warnings: string[] = [];
  if (!syncOk) {
    warnings.push('لم تُجلب بيانات جديدة من المصادر في هذه المحاولة؛ بقيت آخر بيانات محفوظة كما هي.');
  }
  if (!persistence.ok) {
    warnings.push(`تعذّر حفظ اللقطة في الملف المحلي (${persistence.error ?? 'unknown'}).`);
  } else if (!persistence.durable) {
    warnings.push(
      'البيانات محفوظة في ذاكرة النسخة الحالية (/tmp على الاستضافة السحابية)؛ قد تُعاد تهيئتها عند البدء البارد، وهذا متوقع لهذه البيئة.'
    );
  }
  return warnings;
}
