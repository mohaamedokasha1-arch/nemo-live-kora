import {
  ALL_SOURCE_IDS,
  AdminRole,
  AuditEntry,
  LOCKABLE_FIELDS,
  LockableField,
  MANUAL_STATUS_LABEL_AR,
  MANUAL_STATUS_ORDER,
  MANUAL_STATUS_TO_SOURCE_STATUS,
  ManualCompetitionOverride,
  ManualMatchRecord,
  ManualMatchStatus,
  ManualNewsRecord,
  ManualOverride,
  ManualSiteSettings,
  ManualTeamRecord,
  buildScore,
  cairoFieldsFor,
  createId,
  emptyManualDocument,
  slugifyMatchId,
  validateManualMatchInput,
} from './manual-document';
import {
  ManualMutationResult,
  getManualDocument,
  getManualStatus,
  loadManualDocument,
  mutateManualDocument,
  replaceManualDocument,
  serializeManualDocument,
} from './manual-store';
import {
  buildNewsRecordFromManual,
  mergeManualLayerIntoDatabase,
  normalizeAdminKey as normalizeKey,
  type ManualLayerApplyResult,
} from './merge';
import { CANONICAL_COMPETITIONS } from '../catalog';
import { NEWS_INDEX_MIN_FIRST_PARTY, isIndexableNewsArticle } from '../news/validate';
import { getGatewayDatabase, persistGatewayDatabase } from '../db/store';
import { buildMatchDedupKey, findDuplicateFixtureGroups } from '../match-identity';
import { describeDuplicateAr } from '../matches/fixture-consolidation';
import { buildMatchLandingPath } from '../matches/match-links';
import { findServedCatalogEntryForMatch } from './served-catalog';
import { getTodayCairoDate } from '../cairo-time';
import type {
  GatewayDatabase,
  MatchRecord,
  SourceDefinition,
  SourceId,
} from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  خدمات لوحة الإدارة — كل زر في الواجهة ينتهي إلى دالة هنا
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  القواعد المتّبعة في هذا الملف:
 *   1. لا وعد بلا تنفيذ: كل دالة تُعيد `ok` الحقيقي ورسالة عربية تصف ما حدث فعلًا.
 *   2. لا حذف صامت: الحذف يتطلب تأكيدًا نصيًا صريحًا من الواجهة.
 *   3. لا نسخ مكرّرة: الإنشاء يفحص التكرار (معرّف/مفتاح تمييز/فرق+تاريخ) ويعيد
 *      المباراة القائمة ليعدّلها المدير بدل إنشاء نسخة ثانية.
 *   4. النشر فوري في نفس النسخة (المخزن في الذاكرة + `revalidatePath` من المسار)،
 *      ودائم بعد إيداع المستند (GitHub) أو على قرص الخادم.
 */

// ── دمج الطبقة اليدوية في مخزن الموقع ────────────────────────────────────────

export { buildNewsRecordFromManual, resetManualLayerStateForTests } from './merge';

/**
 * يدمج الطبقة اليدوية في المخزن الحي ثم يحفظه — يُنادى بعد كل عملية إدارية
 * وبعد كل تحميل للمخزن، فتظهر تعديلات المدير في الموقع فورًا.
 */
export function applyManualLayerToStore(): ManualLayerApplyResult {
  const document = getManualDocument();
  const db = getGatewayDatabase();
  const result = mergeManualLayerIntoDatabase(db, document);
  persistGatewayDatabase(db);
  return result;
}

// ── قراءة عامة للوحة المؤشرات ────────────────────────────────────────────────

export interface AdminSourceRow {
  id: SourceId;
  nameAr: string;
  type: string;
  baseUrl: string;
  requiresKey: boolean;
  isKeyConfigured: boolean;
  keyEnvVar: string | null;
  enabled: boolean;
  priority: number;
  controlNoteAr: string | null;
  status: string;
  statusLabelAr: string;
  providesMatches: boolean;
  providesNews: boolean;
  providesStandings: boolean;
  lastSyncAt: string | null;
  lastSuccessfulDataAt: string | null;
  lastFailedDataAt: string | null;
  lastHttpStatus: number | null;
  lastLatencyMs: number | null;
  recordsImported: number;
  errorCount: number;
  newsImportedCount: number;
  newsPublishedCount: number;
  /** البيانات أقدم من الحد المسموح في الإعدادات. */
  stale: boolean;
  staleHours: number | null;
  recentErrors: Array<{ at: string; messageAr: string; httpStatus: number | null; endpoint: string }>;
  notesAr: string;
}

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.round(((Date.now() - ms) / 3_600_000) * 10) / 10;
}

/** صفوف المصادر لكل مصدر مع كل ما يحتاجه المشغّل: حالة، آخر نجاح/فشل، أخطاء، تفعيل. */
export function getSourceRows(): AdminSourceRow[] {
  const db = getGatewayDatabase();
  const document = getManualDocument();
  const settings = document.settings;
  const rows: AdminSourceRow[] = [];

  for (const id of ALL_SOURCE_IDS) {
    const source: SourceDefinition | undefined = db.sources?.[id];
    if (!source) continue;
    const control = document.sourceControls[id] ?? null;
    const lastSuccess = source.lastSuccessfulDataAt ?? null;
    const ageHours = hoursSince(lastSuccess ?? source.lastSyncAt);
    const stale = ageHours === null || ageHours > settings.staleSourceWarningHours;
    const recentErrors = (db.sourceErrors || [])
      .filter((error) => error.sourceId === id)
      .slice(0, 5)
      .map((error) => ({
        at: error.timestamp,
        messageAr: error.messageAr,
        httpStatus: error.httpStatus,
        endpoint: error.endpoint,
      }));

    rows.push({
      id,
      nameAr: source.nameAr,
      type: source.type,
      baseUrl: source.baseUrl,
      requiresKey: source.requiresKey,
      isKeyConfigured: source.isKeyConfigured,
      keyEnvVar: source.keyEnvVar,
      enabled: control?.enabled !== false,
      priority: control?.priority ?? 0,
      controlNoteAr: control?.noteAr ?? null,
      status: source.status,
      statusLabelAr: source.statusLabelAr,
      providesMatches: source.providesMatches,
      providesNews: source.providesNews,
      providesStandings: source.providesStandings,
      lastSyncAt: source.lastSyncAt,
      lastSuccessfulDataAt: lastSuccess,
      lastFailedDataAt: source.lastFailedDataAt ?? null,
      lastHttpStatus: source.lastHttpStatus,
      lastLatencyMs: source.lastLatencyMs,
      recordsImported: source.recordsImported,
      errorCount: source.errorCount,
      newsImportedCount: source.newsImportedCount,
      newsPublishedCount: source.newsPublishedCount,
      stale,
      staleHours: ageHours,
      recentErrors,
      notesAr: source.notesAr,
    });
  }

  return rows.sort((a, b) => a.priority - b.priority || a.nameAr.localeCompare(b.nameAr, 'ar'));
}

export interface AdminDashboard {
  generatedAt: string;
  /** حالة تخزين مستند الإدارة كما تُعرض للمشغّل (مع هل هو دائم أم لا). */
  storage: ReturnType<typeof getManualStatus>;
  counts: {
    matches: number;
    liveMatches: number;
    todayMatches: number;
    /** سجلات أُثبت أنها نسخة ثانية لمباراة موجودة: محفوظة للمراجعة ولا تُعرض للزائر. */
    mergedDuplicateMatches: number;
    /** مجموعات فيها نفس المباراة أكثر من مرة ولم تُعالج تلقائيًا (تحتاج قرارًا). */
    unresolvedDuplicateGroups: number;
    manualMatches: number;
    overriddenMatches: number;
    teams: number;
    competitions: number;
    seasons: number;
    newsPublished: number;
    newsManual: number;
    standings: number;
  };
  sync: {
    lastFullSyncAt: string;
    lastLiveSyncAt: string;
    lastNewsSyncAt: string | null;
    lastMatchesSyncAttemptAt: string | null;
    lastSuccessfulMatchesSyncAt: string | null;
    lastMatchesSyncResult: GatewayDatabase['meta']['lastMatchesSyncResult'] | null;
    lastSyncLog: { at: string; mode: string; trigger: string; totalMatchesInStore: number } | null;
  };
  sources: AdminSourceRow[];
  staleSources: string[];
  enabledSources: number;
  disabledSources: number;
  recentErrors: Array<{ at: string; sourceId: string; messageAr: string; httpStatus: number | null; endpoint: string }>;
  audit: AuditEntry[];
  settings: ManualSiteSettings;
  warnings: string[];
}

/** لوحة المؤشرات: كل رقم هنا محسوب من المخزن الفعلي لا من إعدادات مفترضة. */
export async function getDashboard(): Promise<AdminDashboard> {
  await loadManualDocument();
  const db = getGatewayDatabase();
  const document = getManualDocument();
  const storage = getManualStatus();
  const todayCairo = getTodayCairoDate();
  const sources = getSourceRows();

  const overridden = document.overrides.filter(
    (override) => override.locked.length > 0 || override.lockAll || override.suppressedSources.length > 0
  ).length;

  /**
   * التكرار عبر المصادر: سجل مُعلَّم كتكرار = نسخة ثانية لنفس المباراة محفوظة ببيانات
   * مصدرها ولا تُعرض. والمجموعات غير المُعلَّمة = ما يحتاج مراجعة بشرية.
   */
  const standaloneMatches = db.matches.filter((match) => !match.duplicateOfId);
  const standaloneMatchCount = standaloneMatches.length;
  const mergedDuplicateMatches = db.matches.length - standaloneMatchCount;
  const unresolvedDuplicateGroups = findDuplicateFixtureGroups(standaloneMatches);

  const warnings: string[] = [];
  const staleSources = sources.filter((source) => source.stale && source.enabled).map((source) => source.id);
  if (staleSources.length > 0) {
    warnings.push(
      `بيانات متقادمة: ${staleSources.join('، ')} — آخر نجاح أقدم من ${document.settings.staleSourceWarningHours} ساعة.`
    );
  }
  if (!storage.durable) {
    warnings.push(
      'تعديلات الإدارة غير محفوظة في تخزين دائم على هذه البيئة: اضبط GITHUB_TOKEN وGITHUB_REPO ليُحفظ كل تعديل كإيداع في المستودع.'
    );
  }
  if (staleSources.length > 0 && sources.filter((source) => source.enabled && source.providesMatches).length <= 1) {
    warnings.push('لا يوجد سوى مصدر مباريات واحد مفعّل — أضف مصادر احتياطية أو أدخل المباريات يدويًا من صفحة المباريات.');
  }
  const disabledAll = sources.filter((source) => !source.enabled).length;
  if (disabledAll === sources.length && sources.length > 0) {
    warnings.push('كل المصادر معطّلة من اللوحة — الموقع يعرض البيانات المحفوظة فقط ولا يُحدَّث تلقائيًا.');
  }
  if (storage.lastError) warnings.push(storage.lastError);
  if (mergedDuplicateMatches > 0) {
    warnings.push(
      `تكرار موحَّد: ${mergedDuplicateMatches} سجلًا كان نسخة ثانية لمباريات موجودة، عُرضت المباراة مرة واحدة ولم يُحذف أي سجل (راجع عمود «تكرار» في صفحة المباريات).`
    );
  }
  if (unresolvedDuplicateGroups.length > 0) {
    warnings.push(
      `تكرار يحتاج مراجعة: ${unresolvedDuplicateGroups.length} مجموعة فيها نفس المباراة أكثر من مرة ولم تُعالج تلقائيًا (فريقان متماثلان أو سجل مجمَّد أو سجل إداري).`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    storage,
    counts: {
      /** السجلات التي تُعرض للزائر: مباراة واحدة لكل تكرار مُثبت. */
      matches: standaloneMatchCount,
      liveMatches: standaloneMatches.filter((match) => match.status === 'live').length,
      todayMatches: standaloneMatches.filter((match) => match.cairoDate === todayCairo).length,
      /** سجلات محفوظة أُثبت أنها نسخة ثانية لنفس المباراة (لم تُحذف، ولا تُعرض). */
      mergedDuplicateMatches: mergedDuplicateMatches,
      /** ما زال بلا معالجة: نفس المباراة في أكثر من سجل ولم يُعلَّم بعد (يحتاج مراجعة). */
      unresolvedDuplicateGroups: unresolvedDuplicateGroups.length,
      manualMatches: document.matches.length,
      overriddenMatches: overridden,
      teams: new Set(db.matches.flatMap((match) => [match.homeTeam.id, match.awayTeam.id])).size + document.teams.length,
      competitions: new Set(db.matches.map((match) => match.competitionCode)).size + CANONICAL_COMPETITIONS.length,
      seasons: new Set(db.matches.map((match) => `${match.competitionCode}:${match.seasonLabel}`)).size,
      newsPublished: db.news.filter((item) => item.publishStatus === 'published').length,
      newsManual: document.news.length,
      standings: Object.keys(db.standings || {}).length,
    },
    sync: {
      lastFullSyncAt: db.meta.lastFullSyncAt,
      lastLiveSyncAt: db.meta.lastLiveSyncAt,
      lastNewsSyncAt: db.meta.lastNewsSyncAt,
      lastMatchesSyncAttemptAt: db.meta.lastMatchesSyncAttemptAt ?? null,
      lastSuccessfulMatchesSyncAt: db.meta.lastSuccessfulMatchesSyncAt ?? null,
      lastMatchesSyncResult: db.meta.lastMatchesSyncResult ?? null,
      lastSyncLog: db.syncLogs?.[0]
        ? {
            at: db.syncLogs[0].finishedAt,
            mode: db.syncLogs[0].mode,
            trigger: db.syncLogs[0].trigger,
            totalMatchesInStore: db.syncLogs[0].totalMatchesInStore,
          }
        : null,
    },
    sources,
    staleSources,
    enabledSources: sources.filter((source) => source.enabled).length,
    disabledSources: sources.filter((source) => !source.enabled).length,
    recentErrors: (db.sourceErrors || []).slice(0, 15).map((error) => ({
      at: error.timestamp,
      sourceId: error.sourceId,
      messageAr: error.messageAr,
      httpStatus: error.httpStatus,
      endpoint: error.endpoint,
    })),
    audit: document.audit.slice(0, 40),
    settings: document.settings,
    warnings,
  };
}

// ── المباريات ────────────────────────────────────────────────────────────────

export interface AdminMatchRow {
  id: string;
  cairoDate: string;
  cairoTime: string;
  kickoffUtc: string;
  competitionCode: string;
  competitionNameAr: string;
  homeNameAr: string;
  awayNameAr: string;
  status: string;
  statusLabelAr: string;
  /** ملخّص نصي «home - away» للترتيب/التصدير — العرض المرئي يُبنى من الحقول أدناه. */
  scoreLabel: string;
  /** نتيجة الفريق الأول بالمفتاح — مرتبطة حتمًا بـ`homeNameAr` (لا بالاسم ولا بالموضع). */
  scoreHome: number | null;
  /** نتيجة الفريق الثاني بالمفتاح — مرتبطة حتمًا بـ`awayNameAr`. */
  scoreAway: number | null;
  primarySource: string;
  sourceLabelAr: string;
  lastUpdatedAt: string;
  hasManualOverride: boolean;
  manualFields: LockableField[];
  lockAll: boolean;
  suppressedSources: SourceId[];
  origin: 'source' | 'manual';
  landingPath: string | null;
  staleHours: number | null;
  /** معرّف السجل الأساسي عندما يكون هذا السجل تكرارًا مُثبتًا لمباراة واحدة. */
  duplicateOfId: string | null;
  /** شرح عربي لدليل الدمج حتى يراجع المدير السبب قبل أي قرار. */
  duplicateReasonAr: string | null;
}

export interface AdminMatchQuery {
  search?: string;
  cairoDate?: string;
  competitionCode?: string;
  status?: string;
  origin?: 'source' | 'manual' | 'all';
  onlyOverridden?: boolean;
  limit?: number;
  offset?: number;
}

const STATUS_FILTER_ALIASES: Record<string, string[]> = {
  scheduled: ['not_started', 'unconfirmed'],
  live: ['live'],
  finished: ['finished'],
  postponed: ['postponed'],
  cancelled: ['cancelled'],
  suspended: ['suspended'],
};

function scoreLabelFor(match: MatchRecord): string {
  const { home, away } = match.score;
  if (home === null || away === null) return '—';
  return `${home} - ${away}`;
}

/** قائمة المباريات للوحة، مع حالة التثبيت لكل سجل حتى يراها المدير قبل التعديل. */
export function queryAdminMatches(query: AdminMatchQuery = {}): { rows: AdminMatchRow[]; total: number } {
  const db = getGatewayDatabase();
  const document = getManualDocument();
  const overrideById = new Map(document.overrides.map((override) => [override.matchId, override]));
  const manualIds = new Set(document.matches.map((match) => match.id));
  const gatewayPathByMatchId = buildLandingPathMapSafely();
  const search = normalizeKey(query.search);

  let rows: AdminMatchRow[] = db.matches.map((match) => {
    const override = overrideById.get(match.id) ?? null;
    return {
      id: match.id,
      cairoDate: match.cairoDate,
      cairoTime: match.cairoTime,
      kickoffUtc: match.utcKickoff,
      competitionCode: match.competitionCode,
      competitionNameAr: match.competitionNameAr,
      homeNameAr: match.homeTeam.nameAr,
      awayNameAr: match.awayTeam.nameAr,
      status: match.status,
      statusLabelAr: match.statusLabelAr,
      scoreLabel: scoreLabelFor(match),
      scoreHome: match.score.home,
      scoreAway: match.score.away,
      primarySource: match.primarySource,
      sourceLabelAr: manualIds.has(match.id) ? 'إدخال يدوي من اللوحة' : match.primarySource,
      lastUpdatedAt: match.lastUpdatedAt,
      hasManualOverride: Boolean(override && (override.locked.length > 0 || override.lockAll || override.suppressedSources.length > 0)),
      manualFields: override?.locked ?? [],
      lockAll: override?.lockAll ?? false,
      suppressedSources: override?.suppressedSources ?? [],
      origin: manualIds.has(match.id) ? 'manual' : 'source',
      landingPath: gatewayPathByMatchId[match.id] ?? (manualIds.has(match.id) ? `/matches/${match.id}` : null),
      staleHours: hoursSince(match.lastUpdatedAt),
      duplicateOfId: match.duplicateOfId ?? null,
      duplicateReasonAr: describeDuplicateAr(match),
    };
  });

  if (query.origin && query.origin !== 'all') rows = rows.filter((row) => row.origin === query.origin);
  if (query.cairoDate) rows = rows.filter((row) => row.cairoDate === query.cairoDate);
  if (query.competitionCode) rows = rows.filter((row) => row.competitionCode === query.competitionCode);
  if (query.status) {
    const accepted = STATUS_FILTER_ALIASES[query.status] ?? [query.status];
    rows = rows.filter((row) => accepted.includes(row.status));
  }
  if (query.onlyOverridden) {
    rows = rows.filter((row) => row.hasManualOverride || row.origin === 'manual');
  }
  if (search) {
    rows = rows.filter((row) =>
      [
        row.id,
        row.homeNameAr,
        row.awayNameAr,
        row.competitionNameAr,
        row.competitionCode,
        row.cairoDate,
      ].some((value) => normalizeKey(value).includes(search))
    );
  }

  rows.sort((a, b) => Date.parse(b.kickoffUtc) - Date.parse(a.kickoffUtc));
  const total = rows.length;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 50;
  return { rows: rows.slice(offset, offset + limit), total };
}

/** خريطة `معرّف المباراة ← مسار صفحتها` حتى تُعرض في اللوحة روابط حقيقية لا متوقّعة. */
function buildLandingPathMapSafely(): Record<string, string> {
  const map: Record<string, string> = {};
  try {
    for (const match of getGatewayDatabase().matches) {
      const entry = findServedCatalogEntryForMatch(match);
      if (entry) map[match.id] = buildMatchLandingPath(entry.id);
    }
  } catch {
    // غياب الكتالوج لا يمنع اللوحة من العمل: الروابط تظهر فارغة فقط.
  }
  return map;
}

export interface DuplicateCheckResult {
  duplicateOf: { id: string; cairoDate: string; homeNameAr: string; awayNameAr: string; landingPath: string | null } | null;
  reasonAr: string | null;
}

/**
 * فحص التكرار قبل الإنشاء — الطلب الصريح: «تعديل مباراة موجودة دون إنشاء نسخة مكررة».
 * الفحص بثلاث طبقات: المعرّف نفسه، ثم مفتاح التمييز الموحّد، ثم (البطولة + الفريقان + التاريخ).
 */
export function detectDuplicateMatch(input: {
  id: string;
  competitionCode: string;
  cairoDate: string;
  homeNameAr: string;
  awayNameAr: string;
}): DuplicateCheckResult {
  const db = getGatewayDatabase();
  const map = buildLandingPathMapSafely();
  const wantedId = input.id.trim().toLowerCase();
  const home = normalizeKey(input.homeNameAr);
  const away = normalizeKey(input.awayNameAr);

  const byId = db.matches.find((match) => match.id.toLowerCase() === wantedId);
  if (byId) {
    return {
      duplicateOf: {
        id: byId.id,
        cairoDate: byId.cairoDate,
        homeNameAr: byId.homeTeam.nameAr,
        awayNameAr: byId.awayTeam.nameAr,
        landingPath: map[byId.id] ?? null,
      },
      reasonAr: 'يوجد سجل بالمعرّف نفسه — عدّل السجل القائم بدل إنشاء نسخة ثانية.',
    };
  }

  const sameTeams = db.matches.find((match) => {
    const h = normalizeKey(match.homeTeam.nameAr);
    const a = normalizeKey(match.awayTeam.nameAr);
    const samePair = (h === home && a === away) || (h === away && a === home);
    return (
      samePair &&
      match.competitionCode === input.competitionCode &&
      Math.abs(Date.parse(match.cairoDate) - Date.parse(input.cairoDate)) <= 86_400_000
    );
  });
  if (sameTeams) {
    return {
      duplicateOf: {
        id: sameTeams.id,
        cairoDate: sameTeams.cairoDate,
        homeNameAr: sameTeams.homeTeam.nameAr,
        awayNameAr: sameTeams.awayTeam.nameAr,
        landingPath: map[sameTeams.id] ?? null,
      },
      reasonAr: `الفريقان نفسهما في البطولة نفسها وفي تاريخ قريب — السجل القائم هو «${sameTeams.homeTeam.nameAr} × ${sameTeams.awayTeam.nameAr}» (${sameTeams.cairoDate}).`,
    };
  }

  const dedupKey = buildMatchDedupKey({
    competitionCode: input.competitionCode,
    cairoDate: input.cairoDate,
    homeTeam: { nameAr: input.homeNameAr },
    awayTeam: { nameAr: input.awayNameAr },
  } as MatchRecord);
  const byKey = db.matches.find((match) => buildMatchDedupKey(match) === dedupKey);
  if (byKey) {
    return {
      duplicateOf: {
        id: byKey.id,
        cairoDate: byKey.cairoDate,
        homeNameAr: byKey.homeTeam.nameAr,
        awayNameAr: byKey.awayTeam.nameAr,
        landingPath: map[byKey.id] ?? null,
      },
      reasonAr: 'نفس البطولة ونفس الفريقين ونفس التاريخ موجودة بالفعل في المخزن.',
    };
  }

  return { duplicateOf: null, reasonAr: null };
}

export interface MatchFormInput {
  id?: string;
  status?: ManualMatchStatus;
  kickoffUtc?: string;
  timezone?: string;
  kickoffConfirmed?: boolean;
  homeNameAr?: string;
  homeNameEn?: string;
  homeLogoUrl?: string | null;
  homeTeamId?: string | null;
  awayNameAr?: string;
  awayNameEn?: string;
  awayLogoUrl?: string | null;
  awayTeamId?: string | null;
  competitionCode?: string;
  competitionNameAr?: string;
  competitionNameEn?: string;
  competitionCountryAr?: string;
  region?: ManualMatchRecord['region'];
  seasonLabel?: string;
  roundLabelAr?: string | null;
  venue?: string | null;
  cityAr?: string | null;
  scoreHome?: string | number | null;
  scoreAway?: string | number | null;
  halfTimeHome?: string | number | null;
  halfTimeAway?: string | number | null;
  statusNoteAr?: string | null;
  /** دقيقة اللعب الحالية للمباريات المباشرة (رقم صحيح 1–130). */
  liveMinute?: string | number | null;
  channelAr?: string | null;
  broadcastStatus?: ManualMatchRecord['broadcast']['status'];
  broadcastUrl?: string | null;
  broadcastNotesAr?: string | null;
  keywords?: string;
  indexable?: boolean;
  incidentsJson?: string;
}

function parseIncidents(raw: string | undefined): MatchRecord['incidents'] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as MatchRecord['incidents'];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.minute === 'number' && typeof item.player === 'string')
      .map((item) => ({
        minute: Math.max(0, Math.min(200, Number(item.minute))),
        type: item.type,
        side: item.side === 'away' ? 'away' : 'home',
        player: String(item.player).slice(0, 80),
        detail: item.detail ? String(item.detail).slice(0, 120) : undefined,
      }));
  } catch {
    return [];
  }
}

/**
 * بيانات البطولة المعتمدة (الاسم الإنجليزي/الموسم/البلد) بحسب الكود — تُقرأ من كتالوج
 * المستودع `lib/catalog.ts` ومن بطولات المخزن، بلا أي قيمة مُفترضة من عندنا.
 */
/** مفتاح مقارنة: بلا مسافات/شرطات ولا فرق في الهمزات والتاء المربوطة. */
function competitionKey(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/**
 * يجد كود البطولة المعتمد من مدخلات المدير — بالكود أو بالاسم (عربي/إنجليزي) أو بمعرّف
 * المستودع. السبب: النموذج يعرض اسم البطولة العربية، ولا يجوز أن يفشل الحفظ لأن المدير
 * كتب «الدوري المصري الممتاز» بدل أن يحفظ الكود `EGY` عن ظهر قلب.
 */
export function resolveCompetitionCode(input: {
  code?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
}): string | null {
  const candidates = [...CANONICAL_COMPETITIONS, ...getGatewayDatabase().competitions];
  const code = (input.code || '').trim();
  if (code) {
    const upper = code.toUpperCase();
    const exact = candidates.find((item) => item.code.toUpperCase() === upper);
    if (exact) return exact.code;
    const key = competitionKey(code);
    const byName = candidates.find(
      (item) =>
        competitionKey(item.nameAr) === key ||
        competitionKey(item.nameEn) === key ||
        competitionKey(item.id) === key ||
        competitionKey(item.nemoCompetitionSlug) === key
    );
    if (byName) return byName.code;
  }
  for (const name of [input.nameAr, input.nameEn]) {
    const key = competitionKey(name);
    if (!key) continue;
    const hit = candidates.find(
      (item) => competitionKey(item.nameAr) === key || competitionKey(item.nameEn) === key
    );
    if (hit) return hit.code;
  }
  return null;
}

/**
 * بيانات البطولة المعتمدة (الاسم الإنجليزي/الموسم/البلد) بحسب الكود — تُقرأ من كتالوج
 * المستودع `lib/catalog.ts` ومن بطولات المخزن، بلا أي قيمة مُفترضة من عندنا.
 */
function competitionDefaults(code: string): {
  code: string;
  nameAr: string;
  nameEn: string;
  countryAr: string;
  region: ManualMatchRecord['region'];
  currentSeason: string;
} | null {
  if (!code) return null;
  const resolved = resolveCompetitionCode({ code }) ?? code;
  const canonical = CANONICAL_COMPETITIONS.find((item) => item.code.toUpperCase() === resolved.toUpperCase());
  if (canonical) {
    return {
      code: canonical.code,
      nameAr: canonical.nameAr,
      nameEn: canonical.nameEn,
      countryAr: canonical.countryAr,
      region: canonical.region,
      currentSeason: canonical.currentSeason,
    };
  }
  const stored = getGatewayDatabase().competitions.find((item) => item.code.toUpperCase() === resolved.toUpperCase());
  if (stored) {
    return {
      code: stored.code,
      nameAr: stored.nameAr,
      nameEn: stored.nameEn,
      countryAr: stored.countryAr,
      region: stored.region,
      currentSeason: stored.currentSeason,
    };
  }
  return null;
}

/**
 * دقيقة اللعب: تُقبل فقط كرقم صحيح معقول، وأي قيمة أخرى تُهمَل (null) بدل تخزين رقم مشوّه
 * يظهر للزائر في صفحة المباراة.
 */
export function normalizeLiveMinute(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 && rounded <= 130 ? rounded : null;
}

/** يبني كائن المباراة اليدوية من مدخلات النموذج مع التحقق الكامل. */
export function buildManualMatchFromForm(
  form: MatchFormInput,
  actor: string,
  existing?: ManualMatchRecord | null
): { record: ManualMatchRecord | null; issues: ReturnType<typeof validateManualMatchInput> } {
  const now = new Date().toISOString();
  const kickoffUtc = form.kickoffUtc ? new Date(form.kickoffUtc).toISOString() : '';
  const { cairoDate } = cairoFieldsFor(kickoffUtc);
  const status = (form.status || 'scheduled') as ManualMatchStatus;
  // استكمال بيانات البطولة من الكتالوج المعتمد: المدير يختار البطولة فقط، واسمها الإنجليزي
  // وموسمها يُملآن من المصدر الموثّق نفسه — فلا يُطلب منه كتابة بيانات موجودة أصلًا.
  const competition = competitionDefaults(
    resolveCompetitionCode({
      code: form.competitionCode,
      nameAr: form.competitionNameAr,
      nameEn: form.competitionNameEn,
    }) ?? (form.competitionCode || '').trim().toUpperCase()
  );
  const rawId =
    form.id?.trim() ||
    `${slugifyMatchId(form.homeNameEn || form.homeNameAr || 'home')}-vs-${slugifyMatchId(
      form.awayNameEn || form.awayNameAr || 'away'
    )}-${cairoDate || 'date'}`;

  const record: ManualMatchRecord = {
    id: slugifyMatchId(rawId),
    status,
    kickoffUtc,
    kickoffConfirmed: form.kickoffConfirmed !== false,
    timezone: (form.timezone || 'Africa/Cairo').trim(),
    cairoDate,
    homeTeam: {
      id: form.homeTeamId?.trim() || (existing?.homeTeam.id ?? null),
      nameAr: (form.homeNameAr || '').trim(),
      nameEn: (form.homeNameEn || '').trim(),
      logoUrl: form.homeLogoUrl?.trim() || null,
      countryAr: (form.competitionCountryAr || '').trim() || null,
    },
    awayTeam: {
      id: form.awayTeamId?.trim() || (existing?.awayTeam.id ?? null),
      nameAr: (form.awayNameAr || '').trim(),
      nameEn: (form.awayNameEn || '').trim(),
      logoUrl: form.awayLogoUrl?.trim() || null,
      countryAr: (form.competitionCountryAr || '').trim() || null,
    },
    competitionCode: competition?.code || (form.competitionCode || '').trim().toUpperCase(),
    competitionNameAr: (form.competitionNameAr || '').trim() || competition?.nameAr || '',
    competitionNameEn: (form.competitionNameEn || '').trim() || competition?.nameEn || '',
    competitionCountryAr: (form.competitionCountryAr || '').trim() || competition?.countryAr || 'مصر',
    region: form.region || competition?.region || 'egypt',
    seasonLabel: (form.seasonLabel || '').trim() || competition?.currentSeason || '',
    roundLabelAr: form.roundLabelAr?.trim() || null,
    venue: form.venue?.trim() || null,
    cityAr: form.cityAr?.trim() || null,
    score: buildScore({
      home: form.scoreHome,
      away: form.scoreAway,
      halfTimeHome: form.halfTimeHome,
      halfTimeAway: form.halfTimeAway,
    }),
    incidents: parseIncidents(form.incidentsJson) ?? [],
    statusNoteAr: form.statusNoteAr?.trim() || null,
    liveMinute: normalizeLiveMinute(form.liveMinute),
    channelAr: form.channelAr?.trim() || null,
    broadcast: {
      status: form.broadcastStatus || 'unverified',
      url: form.broadcastUrl?.trim() || null,
      labelAr: 'مشاهدة التغطية المباشرة',
      notesAr: form.broadcastNotesAr?.trim() || null,
    },
    keywords: (form.keywords || '')
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .slice(0, 12),
    indexable: form.indexable !== false,
    sourceLabelAr: 'إدخال يدوي من لوحة التحكم',
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || actor,
    updatedAt: now,
    updatedBy: actor,
  };

  const issues = validateManualMatchInput(record);
  return { record: issues.length === 0 ? record : null, issues };
}

export interface AdminMutationOutcome<T> {
  ok: boolean;
  status: number;
  messageAr: string;
  data: T | null;
  warningsAr: string[];
  /** عند رفض الإنشاء لتكرار: السجل القائم الذي يجب تعديله بدلًا من إنشاء نسخة ثانية. */
  duplicateOf?: DuplicateCheckResult['duplicateOf'];
}

/**
 * إنشاء مباراة يدوية. يرفض التكرار ويُعيد السجل القائم ليعدّله المدير،
 * وينشر التغيير فورًا في نفس النسخة.
 */
export async function createManualMatch(
  form: MatchFormInput,
  actor: { username: string; role: AdminRole }
): Promise<AdminMutationOutcome<ManualMatchRecord>> {
  await loadManualDocument();
  const draftPreview = buildManualMatchFromForm(form, actor.username);
  if (!draftPreview.record) {
    return {
      ok: false,
      status: 422,
      messageAr: `لم يُحفظ شيء — ${draftPreview.issues.map((issue) => issue.messageAr).join(' ')}`,
      data: null,
      warningsAr: [],
    };
  }
  const record = draftPreview.record;
  const duplicate = detectDuplicateMatch({
    id: record.id,
    competitionCode: record.competitionCode,
    cairoDate: record.cairoDate,
    homeNameAr: record.homeTeam.nameAr,
    awayNameAr: record.awayTeam.nameAr,
  });
  if (duplicate.duplicateOf) {
    const existing = duplicate.duplicateOf;
    return {
      ok: false,
      status: 409,
      messageAr: `لم يُنشأ سجل جديد لمنع التكرار: ${duplicate.reasonAr}`,
      data: null,
      duplicateOf: existing,
      warningsAr: [
        `السجل القائم: ${existing.homeNameAr} × ${existing.awayNameAr} (${existing.cairoDate}) — معرّفه ${existing.id}.`,
        `عدّله مباشرة من: /admin/matches/${encodeURIComponent(existing.id)}`,
      ],
    };
  }

  const result = await mutateManualDocument(
    {
      actor: actor.username,
      role: actor.role,
      action: 'match.create',
      target: record.id,
      summaryAr: `إضافة مباراة يدوية: ${record.homeTeam.nameAr} × ${record.awayTeam.nameAr} (${record.cairoDate})`,
      details: { competitionCode: record.competitionCode, status: record.status },
    },
    (draft) => {
      draft.matches = [...draft.matches, record];
      return { data: record, changed: true, messageAr: 'أُضيفت المباراة إلى مستند الإدارة.' };
    }
  );

  if (!result.ok) {
    return { ok: false, status: 502, messageAr: result.messageAr, data: null, warningsAr: [] };
  }

  applyManualLayerToStore();
  return {
    ok: true,
    status: 201,
    messageAr: `أُضيفت المباراة ونُشرت على الموقع: ${record.homeTeam.nameAr} × ${record.awayTeam.nameAr} — ${MANUAL_STATUS_LABEL_AR[record.status]}.`,
    data: record,
    warningsAr: result.write?.visibility === 'after_redeploy'
      ? ['الحفظ دائم في المستودع، ويظهر لكل الزوار بعد إعادة النشر التلقائي (دقيقة أو دقيقتان).']
      : [],
  };
}

/** تعديل مباراة يدوية قائمة (بلا إنشاء نسخة ثانية — نفس المعرّف). */
export async function updateManualMatch(
  id: string,
  form: MatchFormInput,
  actor: { username: string; role: AdminRole }
): Promise<AdminMutationOutcome<ManualMatchRecord>> {
  await loadManualDocument();
  const document = getManualDocument();
  const existing = document.matches.find((match) => match.id === slugifyMatchId(id));
  if (!existing) {
    return {
      ok: false,
      status: 404,
      messageAr: 'المباراة اليدوية غير موجودة بهذا المعرّف.',
      data: null,
      warningsAr: [],
    };
  }
  // تعديل جزئي حقيقي: أي حقل غير مُرسَل يبقى كما هو في السجل القائم — فلا يُطلب من
  // الواجهة إرسال النموذج كاملًا، ولا يُفقد حقل لأنه لم يُذكر (وهو ما كان يفشل التحقق بسببه).
  // القيمة `null` المُرسَلة صراحة تبقى «تفريغًا» للحقل، و`undefined` تعني «اتركه كما هو».
  const pick = <T>(incoming: T | undefined, fallback: T): T => (incoming === undefined ? fallback : incoming);
  const merged: MatchFormInput = {
    ...form,
    id: existing.id,
    status: pick(form.status, existing.status),
    kickoffUtc: pick(form.kickoffUtc, existing.kickoffUtc),
    timezone: pick(form.timezone, existing.timezone),
    kickoffConfirmed: pick(form.kickoffConfirmed, existing.kickoffConfirmed),
    homeNameAr: pick(form.homeNameAr, existing.homeTeam.nameAr),
    homeNameEn: pick(form.homeNameEn, existing.homeTeam.nameEn),
    homeLogoUrl: pick(form.homeLogoUrl, existing.homeTeam.logoUrl),
    homeTeamId: pick(form.homeTeamId, existing.homeTeam.id),
    awayNameAr: pick(form.awayNameAr, existing.awayTeam.nameAr),
    awayNameEn: pick(form.awayNameEn, existing.awayTeam.nameEn),
    awayLogoUrl: pick(form.awayLogoUrl, existing.awayTeam.logoUrl),
    awayTeamId: pick(form.awayTeamId, existing.awayTeam.id),
    competitionCode: pick(form.competitionCode, existing.competitionCode),
    competitionNameAr: pick(form.competitionNameAr, existing.competitionNameAr),
    competitionNameEn: pick(form.competitionNameEn, existing.competitionNameEn),
    competitionCountryAr: pick(form.competitionCountryAr, existing.competitionCountryAr),
    region: pick(form.region, existing.region),
    seasonLabel: pick(form.seasonLabel, existing.seasonLabel),
    roundLabelAr: pick(form.roundLabelAr, existing.roundLabelAr),
    venue: pick(form.venue, existing.venue),
    cityAr: pick(form.cityAr, existing.cityAr),
    scoreHome: pick(form.scoreHome, existing.score.home),
    scoreAway: pick(form.scoreAway, existing.score.away),
    halfTimeHome: pick(form.halfTimeHome, existing.score.halfTimeHome),
    halfTimeAway: pick(form.halfTimeAway, existing.score.halfTimeAway),
    statusNoteAr: pick(form.statusNoteAr, existing.statusNoteAr),
    liveMinute: pick(form.liveMinute, existing.liveMinute),
    channelAr: pick(form.channelAr, existing.channelAr),
    broadcastStatus: pick(form.broadcastStatus, existing.broadcast.status),
    broadcastUrl: pick(form.broadcastUrl, existing.broadcast.url),
    broadcastNotesAr: pick(form.broadcastNotesAr, existing.broadcast.notesAr),
    keywords: pick(form.keywords, existing.keywords.join(', ')),
    indexable: pick(form.indexable, existing.indexable),
    incidentsJson: pick(form.incidentsJson, JSON.stringify(existing.incidents)),
  };
  const preview = buildManualMatchFromForm(merged, actor.username, existing);
  if (!preview.record) {
    return {
      ok: false,
      status: 422,
      messageAr: `لم يُحفظ شيء — ${preview.issues.map((issue) => issue.messageAr).join(' ')}`,
      data: null,
      warningsAr: [],
    };
  }
  const record = preview.record;
  const result = await mutateManualDocument(
    {
      actor: actor.username,
      role: actor.role,
      action: 'match.update',
      target: record.id,
      summaryAr: `تعديل مباراة يدوية: ${record.homeTeam.nameAr} × ${record.awayTeam.nameAr} — ${MANUAL_STATUS_LABEL_AR[record.status]}`,
      details: { competitionCode: record.competitionCode },
    },
    (draft) => {
      draft.matches = draft.matches.map((match) => (match.id === record.id ? record : match));
      return { data: record, changed: true, messageAr: 'حُدِّثت المباراة.' };
    }
  );
  if (!result.ok) return { ok: false, status: 502, messageAr: result.messageAr, data: null, warningsAr: [] };
  applyManualLayerToStore();
  return {
    ok: true,
    status: 200,
    messageAr: `حُدِّثت المباراة ونُشر التعديل على صفحتها: ${record.homeTeam.nameAr} × ${record.awayTeam.nameAr}.`,
    data: record,
    warningsAr: [],
  };
}

/** حذف مباراة يدوية — يتطلب تأكيدًا نصيًا صريحًا بالمعرّف. */
export async function deleteManualMatch(
  id: string,
  confirmation: string,
  actor: { username: string; role: AdminRole }
): Promise<AdminMutationOutcome<{ id: string }>> {
  await loadManualDocument();
  const normalized = slugifyMatchId(id);
  const existing = getManualDocument().matches.find((match) => match.id === normalized);
  if (!existing) {
    return { ok: false, status: 404, messageAr: 'المباراة اليدوية غير موجودة.', data: null, warningsAr: [] };
  }
  if (confirmation.trim() !== normalized) {
    return {
      ok: false,
      status: 400,
      messageAr: `تأكيد الحذف مطلوب: اكتب معرّف المباراة «${normalized}» حرفًا بحرف. لم يُحذف شيء.`,
      data: null,
      warningsAr: [],
    };
  }
  const result = await mutateManualDocument(
    {
      actor: actor.username,
      role: actor.role,
      action: 'match.delete',
      target: normalized,
      summaryAr: `حذف مباراة يدوية: ${existing.homeTeam.nameAr} × ${existing.awayTeam.nameAr} (${existing.cairoDate})`,
    },
    (draft) => {
      draft.matches = draft.matches.filter((match) => match.id !== normalized);
      draft.overrides = draft.overrides.filter((override) => override.matchId !== normalized);
      return { data: { id: normalized }, changed: true, messageAr: 'حُذفت المباراة اليدوية.' };
    }
  );
  if (!result.ok) return { ok: false, status: 502, messageAr: result.messageAr, data: null, warningsAr: [] };
  applyManualLayerToStore();
  return {
    ok: true,
    status: 200,
    messageAr: `حُذفت المباراة «${existing.homeTeam.nameAr} × ${existing.awayTeam.nameAr}» وصفحتها، ولم يُمسّ أي سجل مصدر آخر.`,
    data: { id: normalized },
    warningsAr: [],
  };
}

export interface OverrideFormInput {
  lockAll?: boolean;
  locked?: string[];
  suppressedSources?: string[];
  noteAr?: string | null;
  kickoffUtc?: string;
  status?: ManualMatchStatus;
  statusNoteAr?: string | null;
  liveMinute?: string | number | null;
  scoreHome?: string | number | null;
  scoreAway?: string | number | null;
  halfTimeHome?: string | number | null;
  halfTimeAway?: string | number | null;
  venue?: string | null;
  roundLabelAr?: string | null;
  channelAr?: string | null;
}

/**
 * ضبط أولوية سجل مصدر: تثبيت حقول بعينها، أو تجميد السجل كاملًا، أو استبعاد
 * مصدر معيّن عن هذه المباراة فقط. القيم المثبَّتة تُقرأ من النموذج نفسه.
 */
export async function saveMatchOverride(
  matchId: string,
  form: OverrideFormInput,
  actor: { username: string; role: AdminRole }
): Promise<AdminMutationOutcome<ManualOverride>> {
  await loadManualDocument();
  const db = getGatewayDatabase();
  const match = db.matches.find((item) => item.id === matchId);
  if (!match) {
    return { ok: false, status: 404, messageAr: 'لا توجد مباراة بهذا المعرّف في المخزن.', data: null, warningsAr: [] };
  }
  const locked = (form.locked || []).filter((field): field is LockableField =>
    (LOCKABLE_FIELDS as readonly string[]).includes(field)
  );
  const suppressedSources = (form.suppressedSources || []).filter((source): source is SourceId =>
    (ALL_SOURCE_IDS as string[]).includes(source)
  );
  const lockAll = form.lockAll === true;

  if (!lockAll && locked.length === 0 && suppressedSources.length === 0) {
    // لا شيء مثبَّت ⇒ نحذف التجاوز تمامًا بدل الاحتفاظ بسجل فارغ مضلِّل.
    const result = await mutateManualDocument(
      {
        actor: actor.username,
        role: actor.role,
        action: 'override.clear',
        target: matchId,
        summaryAr: `إلغاء التثبيت اليدوي عن ${match.homeTeam.nameAr} × ${match.awayTeam.nameAr}`,
      },
      (draft) => {
        draft.overrides = draft.overrides.filter((override) => override.matchId !== matchId);
        return { data: null, changed: true, messageAr: 'أُلغي التثبيت اليدوي — السجل يعود للتحديث التلقائي.' };
      }
    );
    if (!result.ok) return { ok: false, status: 502, messageAr: result.messageAr, data: null, warningsAr: [] };
    applyManualLayerToStore();
    return {
      ok: true,
      status: 200,
      messageAr: 'أُلغي التثبيت اليدوي، والمباراة تعود للتحديث من المصادر.',
      data: null,
      warningsAr: [],
    };
  }

  const kickoffUtc = form.kickoffUtc ? new Date(form.kickoffUtc) : null;
  const { cairoDate, cairoTime } = cairoFieldsFor(kickoffUtc && Number.isFinite(kickoffUtc.getTime()) ? kickoffUtc.toISOString() : '');
  const manualStatus = (form.status || 'scheduled') as ManualMatchStatus;
  const liveMinuteRaw = form.liveMinute === null || form.liveMinute === undefined || form.liveMinute === ''
    ? null
    : Number(form.liveMinute);

  const override: ManualOverride = {
    matchId,
    lockAll,
    locked,
    values: {
      kickoff: locked.includes('kickoff') && kickoffUtc && Number.isFinite(kickoffUtc.getTime())
        ? { utcKickoff: kickoffUtc.toISOString(), cairoDate, cairoTime, timezone: 'Africa/Cairo' }
        : locked.includes('kickoff')
          ? { utcKickoff: match.utcKickoff, cairoDate: match.cairoDate, cairoTime: match.cairoTime, timezone: 'Africa/Cairo' }
          : null,
      status: locked.includes('status')
        ? {
            status: MANUAL_STATUS_TO_SOURCE_STATUS[manualStatus],
            statusLabelAr: MANUAL_STATUS_LABEL_AR[manualStatus],
            liveMinute: Number.isFinite(liveMinuteRaw as number) ? (liveMinuteRaw as number) : null,
            statusNoteAr: form.statusNoteAr?.trim() || null,
          }
        : null,
      score: locked.includes('score')
        ? buildScore({
            home: form.scoreHome,
            away: form.scoreAway,
            halfTimeHome: form.halfTimeHome,
            halfTimeAway: form.halfTimeAway,
          })
        : null,
      venue: locked.includes('venue') ? form.venue?.trim() || null : null,
      roundLabelAr: locked.includes('round') ? form.roundLabelAr?.trim() || null : null,
      teams: null,
      competition: null,
      incidents: null,
    },
    suppressedSources,
    noteAr: form.noteAr?.trim() || null,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.username,
  };

  const result = await mutateManualDocument(
    {
      actor: actor.username,
      role: actor.role,
      action: 'override.save',
      target: matchId,
      summaryAr: `تثبيت يدوي على ${match.homeTeam.nameAr} × ${match.awayTeam.nameAr}: ${
        lockAll ? 'تجميد كامل' : locked.length ? locked.join('، ') : 'بلا حقول'
      }${suppressedSources.length ? ` • استبعاد: ${suppressedSources.join('، ')}` : ''}`,
      details: { lockAll, locked: locked.join(','), suppressed: suppressedSources.join(',') },
    },
    (draft) => {
      draft.overrides = [...draft.overrides.filter((item) => item.matchId !== matchId), override];
      return { data: override, changed: true, messageAr: 'حُفظت أولوية السجل.' };
    }
  );
  if (!result.ok) return { ok: false, status: 502, messageAr: result.messageAr, data: null, warningsAr: [] };
  applyManualLayerToStore();
  return {
    ok: true,
    status: 200,
    messageAr: lockAll
      ? 'جُمِّد السجل بالكامل: لن يكتب فيه أي مصدر حتى تفكّ التجميد.'
      : `ثُبِّتت الحقول المحددة (${locked.length}) ولن تمحوها أي مزامنة قادمة.`,
    data: override,
    warningsAr: suppressedSources.length
      ? [`المصادر المستبعَدة (${suppressedSources.join('، ')}) لن تُحدّث هذه المباراة، وتظل تعمل على بقية المباريات.`]
      : [],
  };
}

// ── الأخبار ─────────────────────────────────────────────────────────────────

export interface AdminNewsRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  origin: 'source' | 'manual';
  publisherName: string;
  publishedAt: string | null;
  categoryAr: string;
  imageUrl: string | null;
  indexable: boolean;
  relatedMatchIds: string[];
  reasonAr: string | null;
}

export function queryAdminNews(query: { search?: string; status?: string; origin?: 'source' | 'manual' | 'all'; limit?: number } = {}): {
  rows: AdminNewsRow[];
  total: number;
} {
  const db = getGatewayDatabase();
  const document = getManualDocument();
  const manualIds = new Set(document.news.map((item) => item.id));
  const indexableManualIds = new Set(document.news.filter((item) => item.indexable).map((item) => item.id));

  let rows: AdminNewsRow[] = db.news.map((item) => {
    const manual = manualIds.has(item.id);
    return {
      id: item.id,
      title: item.title,
      slug: item.slug,
      status: item.publishStatus,
      origin: manual ? 'manual' : 'source',
      publisherName: item.publisherName,
      publishedAt: item.publishedAt,
      categoryAr: item.categoryAr,
      imageUrl: item.imageUrl,
      indexable: manual ? indexableManualIds.has(item.id) : item.publishStatus === 'published',
      relatedMatchIds: item.relatedMatchIds,
      reasonAr: item.rejectionReasonAr,
    };
  });

  if (query.origin && query.origin !== 'all') rows = rows.filter((row) => row.origin === query.origin);
  if (query.status) rows = rows.filter((row) => row.status === query.status);
  if (query.search) {
    const needle = normalizeKey(query.search);
    rows = rows.filter((row) => normalizeKey(row.title).includes(needle) || row.slug.includes(query.search!.trim()));
  }
  rows.sort((a, b) => Date.parse(b.publishedAt || '0') - Date.parse(a.publishedAt || '0'));
  const total = rows.length;
  return { rows: rows.slice(0, query.limit ?? 60), total };
}

export interface NewsFormInput {
  title?: string;
  slug?: string;
  excerpt?: string;
  bodyAr?: string;
  imageUrl?: string | null;
  canonicalUrl?: string | null;
  publisherName?: string;
  categoryAr?: string;
  publishedAt?: string;
  status?: ManualNewsRecord['status'];
  indexable?: boolean;
  relatedMatchIds?: string;
}

function buildManualNewsFromForm(
  form: NewsFormInput,
  actor: string,
  existing?: ManualNewsRecord | null
): { record: ManualNewsRecord | null; issues: string[] } {
  const now = new Date().toISOString();
  const title = (form.title || '').trim();
  const issues: string[] = [];
  if (title.length < 10) issues.push('العنوان مطلوب ولا يقلّ عن 10 أحرف.');
  const excerpt = (form.excerpt || '').trim();
  if (excerpt.length < 20) issues.push('الوصف/المقدمة مطلوبة (20 حرفًا على الأقل) — تُستخدم في البطاقة وفي البيانات الوصفية.');
  const body = (form.bodyAr || '').trim();
  if (body.length < 40) issues.push('نص الخبر مطلوب (40 حرفًا على الأقل) حتى لا تُنشر صفحة فارغة.');
  const slugInput = (form.slug || '').trim();
  /**
   * عند التعديل يبقى رابط الخبر كما هو ما لم يكتب المدير رابطًا جديدًا صراحةً —
   * تغيير الرابط تلقائيًا كان يكسر صفحات مفهرسة في محرّكات البحث (والمطلوب صراحةً: لا تغيير للروابط بلا داعٍ).
   */
  const slug = slugifyMatchId(slugInput || existing?.slug || title) || createId('news');
  if (slug.length < 4) issues.push('الرابط المختصر (slug) قصير جدًا.');
  const publishedAt = (form.publishedAt || now).trim();
  if (!Number.isFinite(Date.parse(publishedAt))) issues.push('تاريخ النشر غير صالح.');
  const canonicalUrl = (form.canonicalUrl || '').trim() || null;
  if (canonicalUrl) {
    try {
      const url = new URL(canonicalUrl);
      if (!['https:', 'http:'].includes(url.protocol)) issues.push('الرابط الأساسي يجب أن يكون http/https.');
    } catch {
      issues.push('الرابط الأساسي غير صالح.');
    }
  }
  if (issues.length > 0) return { record: null, issues };

  const record: ManualNewsRecord = {
    id: existing?.id || `manual-news-${slug}`,
    title,
    slug,
    excerpt,
    bodyAr: body,
    imageUrl: (form.imageUrl || '').trim() || null,
    canonicalUrl,
    publisherName: (form.publisherName || 'بوابة NEMO Sports').trim(),
    categoryAr: (form.categoryAr || 'الكرة المصرية').trim(),
    publishedAt: new Date(publishedAt).toISOString(),
    cairoDate: cairoFieldsFor(new Date(publishedAt).toISOString()).cairoDate || getTodayCairoDate(),
    status: form.status || 'published',
    tags: [],
    relatedMatchIds: (form.relatedMatchIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    indexable: form.indexable !== false && (form.status || 'published') === 'published',
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || actor,
    updatedAt: now,
    updatedBy: actor,
  };
  return { record, issues: [] };
}

export async function saveManualNews(
  form: NewsFormInput,
  actor: { username: string; role: AdminRole },
  existingId?: string
): Promise<AdminMutationOutcome<ManualNewsRecord>> {
  await loadManualDocument();
  const existing = existingId
    ? getManualDocument().news.find((item) => item.id === existingId) ?? null
    : null;
  if (existingId && !existing) {
    return { ok: false, status: 404, messageAr: 'الخبر غير موجود.', data: null, warningsAr: [] };
  }
  const preview = buildManualNewsFromForm(form, actor.username, existing);
  if (!preview.record) {
    return { ok: false, status: 422, messageAr: `لم يُحفظ شيء — ${preview.issues.join(' ')}`, data: null, warningsAr: [] };
  }
  const record = preview.record;
  // منع التكرار من الأصل: الرابط نفسه **أو** المعرّف نفسه (المعرّف مُشتق من الرابط) يعني
  // أنّ هذا الخبر موجود. كان الحفظ مرّتين يُلحق نسخة ثانية بنفس المعرّف فتتضخّم اللوحة،
  // بدل أن يُوجَّه المدير إلى تعديل الخبر القائم.
  const slugConflict = getManualDocument().news.find(
    (item) => (item.slug === record.slug || item.id === record.id) && item.id !== existing?.id
  );
  if (slugConflict) {
    return {
      ok: false,
      status: 409,
      messageAr:
        existingId
          ? `الرابط «${record.slug}» مستخدم بخبر آخر. اختر رابطًا مختلفًا حتى لا تتعارض الروابط المفهرسة.`
          : `لم يُنشأ خبر جديد لمنع التكرار: يوجد خبر بالرابط «${record.slug}» (${slugConflict.title.slice(0, 60)}). عدّل الخبر القائم بدل إنشاء نسخة ثانية.`,
      data: null,
      warningsAr: [
        `السجل القائم: ${slugConflict.title.slice(0, 70)} — معرّفه ${slugConflict.id}.`,
        `عدّله مباشرة من: /admin/news/manage/${slugConflict.id}`,
      ],
    };
  }

  const result = await mutateManualDocument(
    {
      actor: actor.username,
      role: actor.role,
      action: existing ? 'news.update' : 'news.create',
      target: record.id,
      summaryAr: `${existing ? 'تعديل' : 'إضافة'} خبر: ${record.title.slice(0, 80)} (${record.status})`,
      details: { slug: record.slug, indexable: record.indexable },
    },
    (draft) => {
      draft.news = existing
        ? draft.news.map((item) => (item.id === record.id ? record : item))
        : [...draft.news, record];
      return { data: record, changed: true, messageAr: existing ? 'حُدِّث الخبر.' : 'أُضيف الخبر.' };
    }
  );
  if (!result.ok) return { ok: false, status: 502, messageAr: result.messageAr, data: null, warningsAr: [] };
  applyManualLayerToStore();

  // تنبيه صادق قبل النشر: صفحة رقيقة تعمل لكنها لا تُدرج في خريطة الموقع ولا تُعلَّم للفهرسة.
  // نحسبها بنفس القاعدة التي يقرأها `app/sitemap.ts` حتى لا ينفصل ما يقوله التنبيه عن الواقع.
  const warningsAr =
    record.status !== 'published'
      ? ['الخبر بحالة غير منشورة: لن يظهر للزوار حتى تغيّر الحالة إلى «منشور».']
      : [];
  if (record.status === 'published') {
    const served = buildNewsRecordFromManual(record);
    if (!isIndexableNewsArticle(served)) {
      const size =
        (served.excerpt || '').replace(/<[^>]*>/g, '').trim().length +
        (served.bodyText || '').replace(/<[^>]*>/g, '').trim().length;
      warningsAr.push(
        `الخبر منشور وسيظهر للزوار، لكن نصّه قصير (${size} حرفًا من ${NEWS_INDEX_MIN_FIRST_PARTY}): ` +
          'لن يُدرج في خريطة الموقع ولن يُطلب من محرّكات البحث فهرسته حتى يُطوَّل المقتطف أو النصّ.'
      );
    }
  }

  return {
    ok: true,
    status: existing ? 200 : 201,
    messageAr: `حُفظ الخبر «${record.title}» وسيظهر على الموقع في /news/${record.slug}.`,
    data: record,
    warningsAr,
  };
}

export async function deleteManualNews(
  id: string,
  actor: { username: string; role: AdminRole }
): Promise<AdminMutationOutcome<{ id: string }>> {
  await loadManualDocument();
  const existing = getManualDocument().news.find((item) => item.id === id);
  if (!existing) {
    return { ok: false, status: 404, messageAr: 'الخبر اليدوي غير موجود.', data: null, warningsAr: [] };
  }
  const result = await mutateManualDocument(
    {
      actor: actor.username,
      role: actor.role,
      action: 'news.delete',
      target: id,
      summaryAr: `حذف خبر يدوي: ${existing.title.slice(0, 80)}`,
    },
    (draft) => {
      draft.news = draft.news.filter((item) => item.id !== id);
      return { data: { id }, changed: true, messageAr: 'حُذف الخبر.' };
    }
  );
  if (!result.ok) return { ok: false, status: 502, messageAr: result.messageAr, data: null, warningsAr: [] };
  applyManualLayerToStore();
  return { ok: true, status: 200, messageAr: `حُذف الخبر «${existing.title}» من الموقع.`, data: { id }, warningsAr: [] };
}

// ── البطولات والفرق ──────────────────────────────────────────────────────────

export interface AdminCompetitionRow {
  code: string;
  nameAr: string;
  nameEn: string;
  countryAr: string;
  region: string;
  priority: number;
  defaultPriority: number;
  seasonLabel: string;
  matchesInStore: number;
  manualMatches: number;
  hasOverride: boolean;
  noteAr: string | null;
  nemoCompetitionSlug: string | null;
  logoUrl: string | null;
}

export function getCompetitionRows(): AdminCompetitionRow[] {
  const db = getGatewayDatabase();
  const document = getManualDocument();
  const codes = new Map<string, AdminCompetitionRow>();

  for (const competition of CANONICAL_COMPETITIONS) {
    codes.set(competition.code, {
      code: competition.code,
      nameAr: competition.nameAr,
      nameEn: competition.nameEn,
      countryAr: competition.countryAr,
      region: competition.region,
      priority: competition.priority,
      defaultPriority: competition.priority,
      seasonLabel: competition.currentSeason,
      matchesInStore: 0,
      manualMatches: 0,
      hasOverride: false,
      noteAr: null,
      nemoCompetitionSlug: competition.nemoCompetitionSlug,
      logoUrl: competition.logoUrl,
    });
  }

  for (const match of db.matches) {
    const row = codes.get(match.competitionCode);
    if (row) {
      row.matchesInStore += 1;
    } else {
      codes.set(match.competitionCode, {
        code: match.competitionCode,
        nameAr: match.competitionNameAr,
        nameEn: match.competitionNameEn,
        countryAr: match.countryAr,
        region: match.region,
        priority: match.priority,
        defaultPriority: match.priority,
        seasonLabel: match.seasonLabel,
        matchesInStore: 1,
        manualMatches: 0,
        hasOverride: false,
        noteAr: null,
        nemoCompetitionSlug: null,
        logoUrl: match.competitionLogo,
      });
    }
  }

  const manualCompetitionCounts = new Map<string, number>();
  for (const match of document.matches) {
    manualCompetitionCounts.set(match.competitionCode, (manualCompetitionCounts.get(match.competitionCode) ?? 0) + 1);
    if (!codes.has(match.competitionCode)) {
      codes.set(match.competitionCode, {
        code: match.competitionCode,
        nameAr: match.competitionNameAr,
        nameEn: match.competitionNameEn,
        countryAr: match.competitionCountryAr,
        region: match.region,
        priority: 50,
        defaultPriority: 50,
        seasonLabel: match.seasonLabel,
        matchesInStore: 0,
        manualMatches: 0,
        hasOverride: false,
        noteAr: null,
        nemoCompetitionSlug: null,
        logoUrl: null,
      });
    }
  }

  for (const row of codes.values()) {
    row.manualMatches = manualCompetitionCounts.get(row.code) ?? 0;
    const override = document.competitionOverrides[row.code];
    if (override) {
      row.hasOverride = true;
      row.priority = override.priority ?? row.priority;
      row.seasonLabel = override.currentSeason ?? row.seasonLabel;
      row.nameAr = override.nameAr ?? row.nameAr;
      row.nameEn = override.nameEn ?? row.nameEn;
      row.logoUrl = override.logoUrl ?? row.logoUrl;
      row.nemoCompetitionSlug = override.nemoCompetitionSlug ?? row.nemoCompetitionSlug;
      row.noteAr = override.noteAr ?? null;
    }
  }

  return Array.from(codes.values()).sort((a, b) => a.priority - b.priority || a.nameAr.localeCompare(b.nameAr, 'ar'));
}

export async function saveCompetitionOverride(
  code: string,
  form: {
    priority?: string | number | null;
    currentSeason?: string | null;
    nameAr?: string | null;
    nameEn?: string | null;
    logoUrl?: string | null;
    nemoCompetitionSlug?: string | null;
    noteAr?: string | null;
  },
  actor: { username: string; role: AdminRole }
): Promise<AdminMutationOutcome<ManualCompetitionOverride>> {
  await loadManualDocument();
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    return { ok: false, status: 422, messageAr: 'كود البطولة مطلوب.', data: null, warningsAr: [] };
  }
  const priorityRaw = form.priority === null || form.priority === undefined || form.priority === ''
    ? null
    : Number(form.priority);
  if (priorityRaw !== null && (!Number.isFinite(priorityRaw) || priorityRaw < 1 || priorityRaw > 999)) {
    return {
      ok: false,
      status: 422,
      messageAr: 'الأولوية يجب أن تكون رقمًا بين 1 و999 (الأصغر يظهر أولًا في الصفحة الرئيسية).',
      data: null,
      warningsAr: [],
    };
  }
  const season = (form.currentSeason || '').trim() || null;
  if (season && !/^\d{4}(-\d{4})?$/.test(season)) {
    return {
      ok: false,
      status: 422,
      messageAr: 'صيغة الموسم يجب أن تكون مثل 2026-2027.',
      data: null,
      warningsAr: [],
    };
  }

  const override: ManualCompetitionOverride = {
    code: normalizedCode,
    priority: priorityRaw,
    currentSeason: season,
    nameAr: (form.nameAr || '').trim() || null,
    nameEn: (form.nameEn || '').trim() || null,
    logoUrl: (form.logoUrl || '').trim() || null,
    nemoCompetitionSlug: (form.nemoCompetitionSlug || '').trim() || null,
    noteAr: (form.noteAr || '').trim() || null,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.username,
  };

  const result = await mutateManualDocument(
    {
      actor: actor.username,
      role: actor.role,
      action: 'competition.override',
      target: normalizedCode,
      summaryAr: `تحديث بيانات البطولة ${normalizedCode}: أولوية ${override.priority ?? '—'} • موسم ${override.currentSeason ?? '—'}`,
    },
    (draft) => {
      draft.competitionOverrides = { ...draft.competitionOverrides, [normalizedCode]: override };
      return { data: override, changed: true, messageAr: 'حُفظت بيانات البطولة.' };
    }
  );
  if (!result.ok) return { ok: false, status: 502, messageAr: result.messageAr, data: null, warningsAr: [] };
  applyManualLayerToStore();
  return {
    ok: true,
    status: 200,
    messageAr: `حُدِّثت البطولة ${normalizedCode}، وسينعكس ذلك على ترتيب مبارياتها في الموقع.`,
    data: override,
    warningsAr: [],
  };
}

export async function saveManualTeam(
  form: Partial<ManualTeamRecord> & { nameAr?: string; nameEn?: string },
  actor: { username: string; role: AdminRole }
): Promise<AdminMutationOutcome<ManualTeamRecord>> {
  await loadManualDocument();
  const nameAr = (form.nameAr || '').trim();
  const nameEn = (form.nameEn || '').trim();
  if (!nameAr || !nameEn) {
    return { ok: false, status: 422, messageAr: 'اسم الفريق بالعربية والإنجليزية مطلوبان.', data: null, warningsAr: [] };
  }
  const id = form.id?.trim() || `team-manual-${slugifyMatchId(nameEn)}`;
  const existing = getManualDocument().teams.find((team) => team.id === id) ?? null;
  const record: ManualTeamRecord = {
    id,
    nameAr,
    nameEn,
    shortNameAr: form.shortNameAr?.trim() || null,
    countryAr: form.countryAr?.trim() || 'مصر',
    logoUrl: form.logoUrl?.trim() || null,
    stadium: form.stadium?.trim() || null,
    isEgyptian: (form.countryAr || 'مصر').trim() === 'مصر',
    createdAt: existing?.createdAt || new Date().toISOString(),
    createdBy: existing?.createdBy || actor.username,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.username,
  };
  const result = await mutateManualDocument(
    {
      actor: actor.username,
      role: actor.role,
      action: existing ? 'team.update' : 'team.create',
      target: id,
      summaryAr: `${existing ? 'تعديل' : 'إضافة'} فريق: ${nameAr}`,
    },
    (draft) => {
      draft.teams = existing
        ? draft.teams.map((team) => (team.id === id ? record : team))
        : [...draft.teams, record];
      return { data: record, changed: true, messageAr: 'حُفظ الفريق.' };
    }
  );
  if (!result.ok) return { ok: false, status: 502, messageAr: result.messageAr, data: null, warningsAr: [] };
  return { ok: true, status: existing ? 200 : 201, messageAr: `حُفظ الفريق «${nameAr}» وأصبح متاحًا في نماذج المباريات.`, data: record, warningsAr: [] };
}

export async function deleteManualTeam(
  id: string,
  actor: { username: string; role: AdminRole }
): Promise<AdminMutationOutcome<{ id: string }>> {
  await loadManualDocument();
  const result = await mutateManualDocument(
    { actor: actor.username, role: actor.role, action: 'team.delete', target: id, summaryAr: `حذف فريق يدوي: ${id}` },
    (draft) => {
      const before = draft.teams.length;
      draft.teams = draft.teams.filter((team) => team.id !== id);
      return { data: { id }, changed: draft.teams.length !== before, messageAr: 'حُذف الفريق.' };
    }
  );
  if (!result.ok) return { ok: false, status: 502, messageAr: result.messageAr, data: null, warningsAr: [] };
  return { ok: true, status: 200, messageAr: 'حُذف الفريق من قائمة الفرق اليدوية.', data: { id }, warningsAr: [] };
}

/** الفرق المتاحة في النموذج: من الكتالوج المصري + فرق المستودع + الفرق اليدوية. */
export function getTeamOptions(): Array<{ id: string; nameAr: string; nameEn: string; logoUrl: string | null; origin: string }> {
  const db = getGatewayDatabase();
  const document = getManualDocument();
  const map = new Map<string, { id: string; nameAr: string; nameEn: string; logoUrl: string | null; origin: string }>();

  for (const match of db.matches) {
    for (const team of [match.homeTeam, match.awayTeam]) {
      if (!map.has(team.id)) {
        map.set(team.id, { id: team.id, nameAr: team.nameAr, nameEn: team.nameEn, logoUrl: team.logoUrl, origin: 'source' });
      }
    }
  }
  for (const team of db.teams || []) {
    if (!map.has(team.id)) {
      map.set(team.id, { id: team.id, nameAr: team.nameAr, nameEn: team.nameEn, logoUrl: team.logoUrl, origin: 'catalog' });
    }
  }
  for (const team of document.teams) {
    map.set(team.id, { id: team.id, nameAr: team.nameAr, nameEn: team.nameEn, logoUrl: team.logoUrl, origin: 'manual' });
  }
  return Array.from(map.values()).sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar'));
}

// ── المصادر ──────────────────────────────────────────────────────────────────

export async function saveSourceControl(
  sourceId: string,
  form: { enabled?: boolean; priority?: string | number | null; noteAr?: string | null },
  actor: { username: string; role: AdminRole }
): Promise<AdminMutationOutcome<{ sourceId: string; enabled: boolean; priority: number }>> {
  await loadManualDocument();
  if (!(ALL_SOURCE_IDS as string[]).includes(sourceId)) {
    return { ok: false, status: 404, messageAr: 'مصدر غير معروف.', data: null, warningsAr: [] };
  }
  const priorityRaw = form.priority === null || form.priority === undefined || form.priority === ''
    ? null
    : Number(form.priority);
  if (priorityRaw !== null && (!Number.isFinite(priorityRaw) || priorityRaw < 1 || priorityRaw > 99)) {
    return { ok: false, status: 422, messageAr: 'ترتيب المصدر يجب أن يكون رقمًا من 1 إلى 99.', data: null, warningsAr: [] };
  }
  const enabled = form.enabled !== false;
  const existing = getManualDocument().sourceControls[sourceId as SourceId];
  const priority = priorityRaw ?? existing?.priority ?? 0;

  const result = await mutateManualDocument(
    {
      actor: actor.username,
      role: actor.role,
      action: 'source.control',
      target: sourceId,
      summaryAr: `${enabled ? 'تفعيل' : 'تعطيل'} المصدر ${sourceId} • الترتيب ${priority}`,
      details: { enabled, priority, note: form.noteAr ?? null },
    },
    (draft) => {
      draft.sourceControls = {
        ...draft.sourceControls,
        [sourceId]: {
          enabled,
          priority,
          noteAr: form.noteAr?.trim() || null,
          updatedAt: new Date().toISOString(),
          updatedBy: actor.username,
        },
      };
      return { data: { sourceId, enabled, priority }, changed: true, messageAr: 'حُفظ تحكّم المصدر.' };
    }
  );
  if (!result.ok) return { ok: false, status: 502, messageAr: result.messageAr, data: null, warningsAr: [] };
  return {
    ok: true,
    status: 200,
    messageAr: enabled
      ? `المصدر ${sourceId} مفعّل من جديد — سيدخل في المزامنة القادمة بترتيب ${priority}.`
      : `المصدر ${sourceId} معطّل — لن تُجلب منه بيانات جديدة، وإعداداته وبياناته السابقة محفوظة.`,
    data: { sourceId, enabled, priority },
    warningsAr: enabled ? [] : ['تعطيل آخر مصدر يوفّر المباريات يوقف التحديث التلقائي للجدول.'],
  };
}

// ── الإعدادات ────────────────────────────────────────────────────────────────

export interface SettingsUpdateOutcome extends AdminMutationOutcome<ManualSiteSettings> {
  /** تغييرات تؤثر على الفهرسة/المشاركة تحتاج تأكيدًا إضافيًا. */
  seoImpactAr: string[];
}

export async function saveSiteSettings(
  form: Partial<ManualSiteSettings>,
  actor: { username: string; role: AdminRole },
  options: { confirmSeo?: boolean } = {}
): Promise<SettingsUpdateOutcome> {
  await loadManualDocument();
  const current = getManualDocument().settings;
  const next: ManualSiteSettings = {
    ...current,
    ...form,
    banner: { ...current.banner, ...(form.banner || {}) },
  };

  const issues: string[] = [];
  if (!Number.isFinite(next.matchesFreshnessMinutes) || next.matchesFreshnessMinutes < 1 || next.matchesFreshnessMinutes > 720) {
    issues.push('نافذة تحديث المباريات يجب أن تكون بين دقيقة و720 دقيقة.');
  }
  if (!Number.isFinite(next.newsFreshnessMinutes) || next.newsFreshnessMinutes < 1 || next.newsFreshnessMinutes > 1440) {
    issues.push('نافذة تحديث الأخبار يجب أن تكون بين دقيقة و1440 دقيقة.');
  }
  if (!Number.isFinite(next.staleSourceWarningHours) || next.staleSourceWarningHours < 1 || next.staleSourceWarningHours > 720) {
    issues.push('حدّ التنبيه من التقادم يجب أن يكون بين ساعة و720 ساعة.');
  }
  if (!next.siteDescriptionAr || next.siteDescriptionAr.trim().length < 20 || next.siteDescriptionAr.length > 300) {
    issues.push('الوصف التعريفي مطلوب بين 20 و300 حرف (يظهر في نتائج البحث).');
  }
  if (next.ogImagePath && !/^https?:\/\//.test(next.ogImagePath) && !next.ogImagePath.startsWith('/')) {
    issues.push('صورة المشاركة يجب أن تكون رابط https أو مسارًا داخليًا يبدأ بـ /.');
  }
  if (next.banner.enabled && !next.banner.textAr.trim()) {
    issues.push('شريط التنبيه مفعّل بلا نص — اكتب النص أو أوقف الشريط.');
  }
  if (issues.length > 0) {
    return { ok: false, status: 422, messageAr: `لم يُحفظ شيء — ${issues.join(' ')}`, data: null, warningsAr: [], seoImpactAr: [] };
  }

  const seoImpactAr: string[] = [];
  if (next.ogImagePath !== current.ogImagePath) seoImpactAr.push('تغيّر رابط صورة المشاركة (OG/Twitter) في كل الصفحات.');
  if (next.siteDescriptionAr !== current.siteDescriptionAr) seoImpactAr.push('تغيّر الوصف الوصفي الافتراضي — قد تُعيد محرّكات البحث كتابة المقتطف.');
  if (next.sitemapIncludeNews !== current.sitemapIncludeNews) {
    seoImpactAr.push(
      next.sitemapIncludeNews
        ? 'ستُضاف صفحات الأخبار إلى خريطة الموقع من جديد.'
        : 'ستُزال صفحات الأخبار من خريطة الموقع (الصفحات تبقى تعمل ومتاحة، لكن قد تتأخّر إعادة الزحف).'
    );
  }
  if (next.banner.enabled !== current.banner.enabled) seoImpactAr.push('ظهور/إخفاء شريط التنبيه في كل صفحات الموقع.');

  if (seoImpactAr.length > 0 && options.confirmSeo !== true) {
    return {
      ok: false,
      status: 409,
      messageAr: `هذه التغييرات تؤثر على الفهرسة أو المشاركة: ${seoImpactAr.join(' ')} أعد الإرسال مع تأكيد الأثر (confirmSeo) لإتمامها.`,
      data: null,
      warningsAr: [],
      seoImpactAr,
    };
  }

  const result = await mutateManualDocument({
    actor: actor.username,
    role: actor.role,
    action: 'settings.save',
    target: 'site-settings',
    summaryAr: 'تحديث إعدادات الموقع',
    details: { seoImpact: seoImpactAr.join(' | ') || 'none' },
  }, (draft) => {
    draft.settings = next;
    return { data: next, changed: true, messageAr: 'حُفظت الإعدادات.' };
  });
  if (!result.ok) return { ok: false, status: 502, messageAr: result.messageAr, data: null, warningsAr: [], seoImpactAr };
  applyManualLayerToStore();
  return {
    ok: true,
    status: 200,
    messageAr: 'حُفظت الإعدادات وطُبّقت في نفس اللحظة.',
    data: next,
    warningsAr: [],
    seoImpactAr,
  };
}

// ── السجلات ──────────────────────────────────────────────────────────────────

export interface AdminLogs {
  audit: AuditEntry[];
  sourceErrors: GatewayDatabase['sourceErrors'];
  syncLogs: GatewayDatabase['syncLogs'];
  newsImportErrors: GatewayDatabase['newsImportErrors'];
  syncResult: GatewayDatabase['meta']['lastMatchesSyncResult'] | null;
}

export function getAdminLogs(limit = 50): AdminLogs {
  const db = getGatewayDatabase();
  const document = getManualDocument();
  return {
    audit: document.audit.slice(0, limit),
    sourceErrors: (db.sourceErrors || []).slice(0, limit),
    syncLogs: (db.syncLogs || []).slice(0, Math.min(limit, 20)),
    newsImportErrors: (db.newsImportErrors || []).slice(0, limit),
    syncResult: db.meta.lastMatchesSyncResult ?? null,
  };
}

/** إحصاء سريع لسجل التدقيق يُعرض في اللوحة. */
export function getAuditStats(): { total: number; failures: number; lastAt: string | null } {
  const log: AuditEntry[] = getManualDocument().audit;
  return {
    total: log.length,
    failures: log.filter((entry) => !entry.ok).length,
    lastAt: log[0]?.at ?? null,
  };
}

export { emptyManualDocument, serializeManualDocument, replaceManualDocument, loadManualDocument, getManualStatus };
export type { ManualMutationResult };
export { MANUAL_STATUS_ORDER, LOCKABLE_FIELDS };
