export type SourceId =
  | 'sportscore'
  | 'football-data'
  | 'thesportsdb'
  | 'api-football'
  | 'google-news-rss'
  | 'publisher-rss';

export type SourceHealthStatus =
  | 'active'
  | 'partial_keyless'
  | 'requires_api_key'
  | 'degraded'
  | 'error';

export type CompetitionRegion =
  | 'egypt'
  | 'africa'
  | 'arab'
  | 'europe'
  | 'world'
  | 'americas'
  | 'asia';

export type MatchStatusCode =
  | 'not_started'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled'
  | 'suspended'
  | 'unconfirmed';

/** A match link exists only when the exact NEMO Sports match page is verified. */
export type NemoLinkType = 'direct_match' | 'unavailable';

export type NemoMatchCriterion =
  | 'provider_match_id'
  | 'competition_id'
  | 'team_ids'
  | 'match_date'
  | 'mapping_table';

export interface SourceDefinition {
  lastSuccessfulDataAt?: string | null;
  lastFailedDataAt?: string | null;
  id: SourceId;
  name: string;
  nameAr: string;
  type: 'REST JSON API' | 'RSS 2.0 XML Feed';
  baseUrl: string;
  requiresKey: boolean;
  keyEnvVar: string | null;
  isKeyConfigured: boolean;
  status: SourceHealthStatus;
  statusLabelAr: string;
  dataTypesProvided: string[];
  rateLimitPolicy: string;
  testedEndpoints: string[];
  lastSyncAt: string | null;
  lastHttpStatus: number | null;
  lastLatencyMs: number | null;
  recordsImported: number;
  errorCount: number;
  notesAr: string;
  providesMatches: boolean;
  providesStandings: boolean;
  providesNews: boolean;
  lastSuccessfulNewsSyncAt: string | null;
  newsImportedCount: number;
  newsPublishedCount: number;
  /** Masked result of the last API-key probe round (TheSportsDB), for the sources dashboard. */
  apiKeyProbes?: Array<{ key: string; ok: boolean; httpStatus: number | null; error?: string }>;
  /** Structured storage backend in use, written by the sync endpoints. */
  storageKind?: string;
  storageDurable?: boolean;
}

export interface CompetitionRecord {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  countryAr: string;
  countryEn: string;
  region: CompetitionRegion;
  priority: number;
  isEgyptianPriority: boolean;
  logoUrl: string | null;
  nemoCompetitionSlug: string | null;
  currentSeason: string;
  sourceIds: {
    sportscoreSlug?: string;
    thesportsdbId?: string;
    footballDataCode?: string;
    apiFootballId?: number;
  };
}

export interface SeasonRecord {
  id: string;
  competitionId: string;
  competitionCode: string;
  label: string;
  startDate: string | null;
  endDate: string | null;
  currentMatchday: number | null;
  sourceId: SourceId;
}

export interface TeamRecord {
  id: string;
  nameAr: string;
  nameEn: string;
  shortNameAr: string;
  countryAr: string;
  countryEn: string;
  logoUrl: string | null;
  isEgyptian: boolean;
  isNationalTeam: boolean;
  stadium: string | null;
  nemoTeamUrl: string | null;
  externalIds: {
    sportscoreSlug?: string;
    thesportsdbId?: string;
    footballDataId?: number;
    apiFootballId?: number;
  };
}

export interface NemoLinkResolution {
  url: string | null;
  linkType: NemoLinkType;
  labelAr: string;
  subLabelAr: string;
  verified: boolean;
  matchedBy: NemoMatchCriterion[];
  competitionUrl: string | null;
  scheduleUrl: string | null;
}

/**
 * حالة اسم الفريق كما وصل من المصدر:
 *  • `verified`   — اسم موثّق في كتالوج الأندية (عربي/إنجليزي معروفان).
 *  • `translated` — الاسم الإنجليزي من المصدر مع ترجمة عربية معتمدة في `TEAM_ARABIC_NAMES`.
 *  • `source`     — لم تتوفر ترجمة موثّقة، فيُعرض اسم المصدر نفسه كما هو (بلا تخمين).
 *  • `placeholder`— اسم تقني/مؤقت من المصدر (`Team dj2ryoh2w90q1zp`) لا يمثّل ناديًا معلومًا،
 *                   فلا نعرضه كاسم فريق أبدًا ونُظهر عبارة واضحة بدلًا منه.
 */
export type MatchTeamNameStatus = 'verified' | 'translated' | 'source' | 'placeholder';

export interface MatchTeamSummary {
  id: string;
  nameAr: string;
  nameEn: string;
  logoUrl: string | null;
  isEgyptian: boolean;
  nemoTeamUrl?: string | null;
  /**
   * اختياري: يُضاف عند بناء السجل من المصدر. غيابه في السجلات القديمة لا يعني شيئًا؛
   * طبقة العرض تحسب الحالة بنفسها من الاسم المخزَّن (انظر `resolveTeamDisplayIdentityAr`).
   */
  nameStatus?: MatchTeamNameStatus;
}

export interface MatchScore {
  home: number | null;
  away: number | null;
  halfTimeHome?: number | null;
  halfTimeAway?: number | null;
}

export interface MatchIncidentSummary {
  minute: number;
  type: 'goal' | 'penalty_goal' | 'yellow_card' | 'red_card' | 'substitution';
  side: 'home' | 'away';
  player: string;
  detail?: string;
}

export interface MatchRecord {
  fieldProvenance?: Record<string, { source: SourceId; observedAt: string }>;
  /**
   * من أين جاء السجل: مصدر خارجي، أو إدخال إداري يدوي.
   * الوسم صريح حتى لا تعتمد إزالة مباريات الإدارة على ذاكرة العملية (وهي وسيلة فقدت
   * البيانات فعلًا: سجل يُحذف من اللوحة يبقى في اللقطة المخزَّنة بعد إعادة التشغيل).
   */
  origin?: 'source' | 'manual';
  id: string;
  competitionId: string;
  competitionCode: string;
  competitionNameAr: string;
  competitionNameEn: string;
  competitionLogo: string | null;
  countryAr: string;
  region: CompetitionRegion;
  priority: number;
  isEgyptianInterest: boolean;
  seasonLabel: string;
  roundLabelAr: string | null;
  utcKickoff: string;
  /**
   * True only when a source supplied a trustworthy kick-off timestamp. False or missing means
   * the stored timestamp may only be a date anchor and must not be displayed as a match time.
   */
  kickoffConfirmed?: boolean;
  cairoDate: string;
  cairoTime: string;
  homeTeam: MatchTeamSummary;
  awayTeam: MatchTeamSummary;
  status: MatchStatusCode;
  statusLabelAr: string;
  statusNoteAr: string | null;
  liveMinute: number | null;
  score: MatchScore;
  incidents?: MatchIncidentSummary[];
  venue: string | null;
  primarySource: SourceId;
  contributingSources: SourceId[];
  externalIds: {
    sportscoreSlug?: string;
    sportscoreTrackerId?: string;
    thesportsdbEventId?: string;
    apiFootballFixtureId?: string;
    footballDataMatchId?: string;
  };
  nemoLink: NemoLinkResolution;
  lastUpdatedAt: string;
  /**
   * عندما يُثبت أن هذا السجل هو نفس المباراة التي يصفها سجل آخر من مصدر مختلف، يُعلَّم هذا
   * السجل تكرارًا (`duplicateOfId` = معرّف السجل الأساسي) ويُستبعد من كل مسارات العرض
   * والعدّ وخريطة الموقع — **دون حذف أي بيانات مصدر**. أما صفحاته القديمة فتبقى تعمل
   * وتُحوَّل قراءتها إلى السجل الأساسي (Canonical) فلا ينكسر أي رابط موجود.
   */
  duplicateOfId?: string | null;
  /** دليل الدمج: على أي أساس قيل إن السجلين مباراة واحدة، ومتى. */
  duplicateEvidence?: MatchDuplicateEvidence | null;
}

export interface MatchDuplicateEvidence {
  /** مصدر السجل الأساسي الذي استُوعب فيه هذا السجل. */
  survivorId: string;
  survivorSource: SourceId;
  /** السبب المختصر (تطابق الفريقين + البطولة/النافذة الزمنية). */
  reason: string;
  /** المعايير التي تحققت فعلًا: `teams` · `competition` · `kickoff_window` · `cairo_date`. */
  matchedOn: string[];
  /** فرق وقت الانطلاق بين المصدرين بالدقائق (null إن كان أحد الموعدين غير مؤكد). */
  kickoffDeltaMinutes: number | null;
  /** هل التُقط هذا السجل من نافذة زمنية غير مطابقة للبطولة (يحتاج مراجعة بشرية). */
  requiresReview: boolean;
  resolvedAt: string;
}

export interface StandingRowRecord {
  position: number;
  teamId: string;
  teamNameAr: string;
  teamNameEn: string;
  teamLogo: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  noteAr?: string | null;
  nemoTeamUrl?: string | null;
}

export interface CompetitionStandingTable {
  competitionCode: string;
  competitionNameAr: string;
  competitionNameEn: string;
  competitionLogo: string | null;
  seasonLabel: string;
  sourceId: SourceId;
  updatedAt: string;
  nemoCompetitionUrl: string | null;
  rows: StandingRowRecord[];
}

export type NewsPublishStatus =
  | 'pending'
  | 'published'
  | 'duplicate'
  | 'rejected'
  | 'stale'
  | 'source_error';

export interface RawNewsCandidate {
  sourceId: SourceId;
  sourceItemId: string | null;
  title: string;
  link: string;
  originalUrl: string | null;
  publishedAt: string | null;
  publishedAtKnown: boolean;
  updatedAt: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  publisherName: string;
  publisherUrl: string | null;
  language: 'ar' | 'en';
  categoryAr: string;
  fetchedAt: string;
}

export interface NewsItemRecord {
  /** من أين جاء الخبر: مصدر خارجي أو كتابة إدارية يدوية (يُستثنى من اللقطة المخزَّنة). */
  origin?: 'source' | 'manual';
  /**
   * نصّ الخبر المكتوب في لوحة الإدارة (يوجد على سجلات الإدارة وحدها).
   * أخبار المصادر لا تحمل نصًّا كاملًا — المقتطف هو كل ما نُشر لنا، ولا نولّد نصًّا ليس لدينا.
   */
  bodyText?: string | null;
  id: string;
  sourceItemId: string | null;
  sourceId: SourceId;
  title: string;
  slug: string;
  link: string;
  originalUrl: string | null;
  publishedAt: string | null;
  publishedAtKnown: boolean;
  updatedAt: string | null;
  fetchedAt: string;
  lastSyncedAt: string;
  cairoDate: string | null;
  cairoTimeLabel: string;
  excerpt: string | null;
  imageUrl: string | null;
  publisherName: string;
  publisherUrl: string | null;
  language: 'ar' | 'en';
  categoryAr: string;
  publishStatus: NewsPublishStatus;
  rejectionReason: string | null;
  rejectionReasonAr: string | null;
  duplicateOfId: string | null;
  relatedMatchIds: string[];
  relatedTeamIds: string[];
  relatedCompetitionCodes: string[];
  nemoRelatedUrl: string | null;
  nemoRelatedLabelAr: string | null;
}

export interface NewsSourceSyncRecord {
  id: string;
  sourceId: SourceId;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  fetchedCount: number;
  importedCount: number;
  publishedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  updatedCount: number;
  errorCount: number;
  messageAr: string;
  /**
   * هل استجاب المصدر فعليًا (HTTP 2xx + XML صالح)؟ يُفصل عن `ok` عن قصد:
   * `feedOk: true, ok: false` تعني «المصدر يعمل لكن لم يجتز أي عنوان شروط النشر» — وهي
   * حالة مختلفة تمامًا عن انقطاع الاتصال، ولا يجوز وصفها بأنها فشل في الجلب.
   */
  feedOk?: boolean;
  /**
   * عدّاد أسباب الرفض لهذه المحاولة (`invalid_url` … إلخ). بلا هذا العدّاد كان المشغّل يرى
   * «٠ منشور» فقط ولا يعرف إن كان السبب رابطًا وسيطًا لم يُحلّ أو نتيجة مباراة رُفضت.
   */
  rejectionBreakdown?: Record<string, number>;
  /** How Google News relay links were resolved during this run (absent on older records). */
  resolutionReport?: {
    attempted: number;
    resolved: number;
    unresolved: number;
    strategies: Record<string, number>;
    errors: Record<string, number>;
  };
}

export interface NewsImportErrorRecord {
  id: string;
  sourceId: SourceId;
  timestamp: string;
  errorCode: string;
  message: string;
  messageAr: string;
  title?: string;
  url?: string;
}

export interface NewsDedupRecord {
  id: string;
  newsId: string;
  duplicateOfId: string;
  matchedBy: string[];
  timestamp: string;
  title: string;
}

export interface NemoMappingEntry {
  canonicalMatchId: string;
  sportscoreSlug: string | null;
  /** Provider-generated fixture id, distinct from the reusable descriptive slug. */
  sportscoreTrackerId?: string | null;
  thesportsdbEventId: string | null;
  apiFootballFixtureId: string | null;
  competitionCode: string;
  homeTeamId: string;
  awayTeamId: string;
  cairoDate: string;
  verifiedNemoMatchSlug: string | null;
  verifiedNemoCompetitionSlug: string | null;
  verifiedAt: string;
  verificationNoteAr: string;
}

export interface SourceSyncResult {
  matchesInserted?: number;
  matchesUpdated?: number;
  matchesUnchanged?: number;
  sourceId: SourceId;
  status: SourceHealthStatus;
  httpStatus: number | null;
  latencyMs: number;
  matchesFetched: number;
  standingsFetched: number;
  newsFetched: number;
  newsPublished?: number;
  newsDuplicates?: number;
  newsRejected?: number;
  usedCachedSnapshot: boolean;
  messageAr: string;
  /** تفاصيل كل نقطة نهاية داخل المصدر (عند توفرها) */
  endpoints?: Array<{
    endpoint: string;
    labelAr: string;
    ok: boolean;
    httpStatus: number | null;
    latencyMs: number;
    fromCache: boolean;
    eventsCount: number;
    error?: string;
  }>;
}

export interface SyncLogEntry {
  id: string;
  startedAt: string;
  finishedAt: string;
  mode: 'live' | 'daily' | 'standings' | 'manual';
  trigger: string;
  sourceResults: SourceSyncResult[];
  totalMatchesInStore: number;
  totalStandingsInStore: number;
  totalNewsInStore: number;
  /**
   * التواريخ التي طُلبت في هذه المزامنة (بتوقيت القاهرة) وما تُخطّي منها بسبب الميزانية الزمنية
   * أو حد طلبات المصدر. يُسجَّل حتى يظهر في اللوحة أي يوم لم يُغطَّ فعلًا.
   */
  dateWindow?: {
    profile: 'wide' | 'quick';
    todayCairo: string;
    from: string;
    to: string;
    dates: string[];
    daysBack: number;
    daysAhead: number;
    skipped: {
      sportscoreDays: string[];
      thesportsdbDayCalls: number;
      apiFootballDays: string[];
    };
  };
}

export interface SourceErrorEntry {
  id: string;
  sourceId: SourceId;
  timestamp: string;
  endpoint: string;
  httpStatus: number | null;
  errorCode: string;
  message: string;
  messageAr: string;
}

export interface GatewayDatabase {
  meta: {
    schemaVersion: string;
    gatewayName: string;
    mainSiteUrl: string;
    timezone: string;
    lastFullSyncAt: string;
    lastLiveSyncAt: string;
    lastNewsSyncAt: string | null;
    lastSuccessfulNewsSyncAt: string | null;
    /** آخر محاولة جلب للمباريات (ناجحة أو فاشلة) */
    lastMatchesSyncAttemptAt?: string | null;
    /** آخر جلب ناجح للمباريات من مصدر واحد على الأقل */
    lastSuccessfulMatchesSyncAt?: string | null;
    /** نتيجة آخر محاولة جلب للمباريات */
    lastMatchesSyncResult?: {
      ok: boolean;
      trigger: string;
      messageAr: string;
      matchesFetched: number;
      sourcesOk: SourceId[];
      sourcesFailed: SourceId[];
      /** Counters for the attempt (absent on records written before they were tracked). */
      matchesInserted?: number;
      matchesUpdated?: number;
      recordsSkipped?: number;
      /** Per-source HTTP status and error summary for the attempt. */
      sourceStatus?: Partial<Record<SourceId, { httpStatus: number | null; ok: boolean; error?: string }>>;
    } | null;
    /**
     * حصيلة آخر عملية توحيد للمباريات المكررة عبر المصادر (بلا حذف أي سجل).
     * تُقرأ في اللوحة وفي `/api/sources` كدليل على أن التكرار عولج فعلًا.
     */
    lastFixtureConsolidation?: {
      at: string;
      groups: number;
      markedDuplicates: number;
      repointedDuplicates: number;
      requiresReview: number;
    } | null;
  };
  sources: Record<SourceId, SourceDefinition>;
  competitions: CompetitionRecord[];
  seasons: SeasonRecord[];
  teams: TeamRecord[];
  matches: MatchRecord[];
  standings: Record<string, CompetitionStandingTable>;
  news: NewsItemRecord[];
  newsSourceSyncs: NewsSourceSyncRecord[];
  newsImportErrors: NewsImportErrorRecord[];
  newsDedupRecords: NewsDedupRecord[];
  nemoMappingTable: NemoMappingEntry[];
  syncLogs: SyncLogEntry[];
  sourceErrors: SourceErrorEntry[];
}
