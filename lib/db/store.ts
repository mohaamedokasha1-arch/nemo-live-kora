import fs from 'fs';
import path from 'path';
import {
  CompetitionStandingTable,
  GatewayDatabase,
  MatchRecord,
  NewsItemRecord,
  SeasonRecord,
  SourceErrorEntry,
  SourceId,
  SyncLogEntry,
} from '../types';
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
        memoryStore = parsed;
        return parsed;
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

/**
 * Idempotently upserts matches into the store without ever deleting existing matches on partial failure.
 */
export function upsertMatchesInStore(incomingMatches: MatchRecord[]): number {
  if (!incomingMatches || incomingMatches.length === 0) return 0;
  const db = getGatewayDatabase();
  const byId = new Map<string, MatchRecord>();
  for (const m of db.matches) {
    byId.set(m.id, m);
  }

  let upserted = 0;
  for (const inc of incomingMatches) {
    const existing = byId.get(inc.id);
    if (!existing) {
      byId.set(inc.id, inc);
    } else {
      byId.set(inc.id, mergeMatchRecords(existing, inc));
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
 * Idempotently upserts news items into the store while preserving existing items if RSS is empty.
 */
export function upsertNewsInStore(newsItems: NewsItemRecord[]): number {
  if (!newsItems || newsItems.length === 0) return 0;
  const db = getGatewayDatabase();
  const byTitle = new Map<string, NewsItemRecord>();
  for (const n of db.news) {
    byTitle.set(n.title.toLowerCase(), n);
  }
  for (const inc of newsItems) {
    byTitle.set(inc.title.toLowerCase(), inc);
  }
  db.news = Array.from(byTitle.values())
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 24);
  persistGatewayDatabase(db);
  return newsItems.length;
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
  const matchesOnDate = targetDate
    ? db.matches.filter((m) => m.cairoDate === targetDate)
    : db.matches;

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
  };
}
