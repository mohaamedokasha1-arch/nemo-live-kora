import { CANONICAL_COMPETITIONS } from '../catalog';
import { isValidDateParam, toCairoDateString, toCairoTime24, toCairoTimeArabic } from '../cairo-time';
import type {
  CompetitionRegion,
  MatchIncidentSummary,
  MatchRecord,
  MatchScore,
  MatchStatusCode,
  NewsPublishStatus,
  SourceId,
} from '../types';
import type {
  BroadcastStatus,
  MatchCatalogEntry,
  MatchCatalogStatus,
} from '../matches/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  طبقة الإدارة اليدوية (Admin Manual Layer) — الأنواع والقواعد النقية
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  المشكلة التي تحلّها هذه الطبقة:
 *  كل ما يجلب الموقع يعتمد على مصادر خارجية مجانية، وأي منها يمكن أن يتوقف أو
 *  يتأخّر أو يُرجع بيانات ناقصة. هذا الملف يصف «القرار الإداري» الذي لا يجوز أن
 *  يمحوه أي جلب تلقائي: مباريات أدخلها المدير بنفسه، وحقول ثبّتها يدويًا على
 *  سجلات المصادر.
 *
 *  مبادئ صارمة:
 *   1. لا بيانات وهمية: كل حقل هنا كتبه إنسان، وتاريخ كتابته وكاتبه مسجّلان.
 *   2. الأولوية معرّفة لكل حقل: حقل مثبَّت (`locked`) لا يستطيع أي مصدر كتابته.
 *   3. الاستبعاد لكل سجل: يمكن إيقاف مصدر معيّن عن الكتابة في مباراة بعينها
 *      (`suppressedSources`) دون تعطيله عن بقية المباريات.
 *   4. النقاء: هذا الملف لا يقرأ ملفات ولا شبكة — دوال تحويل وتحقق فقط، ليسهل
 *      اختبار القواعد وحدها بلا أي وقت تشغيل.
 */

/** رقم صيغة المستند — يرفع عند تغيير بنية لا يمكن ترحيلها تلقائيًا. */
export const MANUAL_DOCUMENT_SCHEMA = '1.0.0';

/** حالات المباراة التي يديرها المدير (تشمل «استراحة» وهي غير موجودة في حالات المصادر). */
export type ManualMatchStatus =
  | 'scheduled'
  | 'live'
  | 'break'
  | 'finished'
  | 'postponed'
  | 'cancelled'
  | 'suspended';

/** ترجمة حالة الإدخال اليدوي إلى حالة المصدر الموحّدة (نفس مفردات الموقع كلّه). */
export const MANUAL_STATUS_TO_SOURCE_STATUS: Record<ManualMatchStatus, MatchStatusCode> = {
  scheduled: 'not_started',
  live: 'live',
  // «استراحة بين الشوطين» مباراة جارية لا مباراة منتهية أو موقوفة — نفس حالة المباشر
  // مع نص حالة يشرح الشوط، فلا يظهر للمحرّكات تناقض في البيانات المنظمة.
  break: 'live',
  finished: 'finished',
  postponed: 'postponed',
  cancelled: 'cancelled',
  suspended: 'suspended',
};

/** ترجمة حالة الإدخال اليدوي إلى حالة كتالوج الصفحات (تُستخدم في sitemap وJSON-LD). */
export const MANUAL_STATUS_TO_CATALOG_STATUS: Record<ManualMatchStatus, MatchCatalogStatus> = {
  scheduled: 'scheduled',
  live: 'live',
  break: 'live',
  finished: 'finished',
  postponed: 'postponed',
  cancelled: 'cancelled',
  suspended: 'suspended',
};

/** التسمية العربية لكل حالة كما تظهر في اللوحة وفي الصفحات. */
export const MANUAL_STATUS_LABEL_AR: Record<ManualMatchStatus, string> = {
  scheduled: 'لم تبدأ بعد',
  live: 'جارية الآن',
  break: 'استراحة بين الشوطين',
  finished: 'انتهت المباراة',
  postponed: 'مؤجلة',
  cancelled: 'أُلغيت',
  suspended: 'متوقفة مؤقتًا',
};

/** قائمة الحالات بالترتيب الذي تظهر به في اللوحة. */
export const MANUAL_STATUS_ORDER: ManualMatchStatus[] = [
  'scheduled',
  'live',
  'break',
  'finished',
  'postponed',
  'cancelled',
  'suspended',
];

/**
 * الحقول التي يمكن للمدير تثبيتها على سجل مصدر — الوحدة هي ما يقرأه المشغّل:
 * «ثبّتت النتيجة فقط» أو «ثبّتت الموعد والحالة» وهكذا.
 */
export const LOCKABLE_FIELDS = [
  'kickoff',
  'status',
  'score',
  'venue',
  'teams',
  'competition',
  'round',
  'incidents',
] as const;

export type LockableField = (typeof LOCKABLE_FIELDS)[number];

export const LOCKABLE_FIELD_LABEL_AR: Record<LockableField, string> = {
  kickoff: 'الموعد والتوقيت',
  status: 'الحالة (مباشر/انتهت/مؤجلة…)',
  score: 'النتيجة',
  venue: 'الملعب',
  teams: 'الفريقان',
  competition: 'البطولة',
  round: 'الجولة/الدور',
  incidents: 'الأحداث (أهداف/بطاقات/تبديلات)',
};

export interface ManualTeam {
  id: string | null;
  nameAr: string;
  nameEn: string;
  logoUrl: string | null;
  countryAr: string | null;
}

export interface ManualMatchValues {
  kickoff?: {
    utcKickoff: string;
    cairoDate: string;
    cairoTime: string;
    timezone: string;
  } | null;
  status?: {
    status: MatchStatusCode;
    statusLabelAr: string;
    liveMinute: number | null;
    statusNoteAr: string | null;
  } | null;
  score?: MatchScore | null;
  venue?: string | null;
  teams?: { home: ManualTeam; away: ManualTeam } | null;
  competition?: { code: string; nameAr: string; nameEn: string; countryAr: string; region: CompetitionRegion } | null;
  roundLabelAr?: string | null;
  incidents?: MatchIncidentSummary[] | null;
}

/** تجاوز يدوي على سجل مصدر: قيم مثبَّتة + مصادر مُبعَدة عن هذا السجل تحديدًا. */
export interface ManualOverride {
  matchId: string;
  /** تجميد كامل: لا يكتب أي مصدر في هذا السجل، ويُحتفظ بالنسخة اليدوية كما هي. */
  lockAll: boolean;
  /** الحقول المثبَّتة من `values` — ما عداها يظل يتحدّث من المصادر. */
  locked: LockableField[];
  values: ManualMatchValues;
  /** مصادر مسموح لها بتحديث هذا السجل. القائمة الفارغة = لا استبعاد. */
  suppressedSources: SourceId[];
  noteAr: string | null;
  updatedAt: string;
  updatedBy: string;
}

/** مباراة أدخلها المدير بالكامل — تُنشر كصفحة كاملة مثل أي مباراة أخرى. */
export interface ManualMatchRecord {
  id: string;
  status: ManualMatchStatus;
  /** دقيقة اللعب الحالية عند حالة «مباشر الآن» — تُدار يدويًا كما تُدار النتيجة. */
  liveMinute?: number | null;
  kickoffUtc: string;
  /** هل الموعد مؤكَّد من مصدر/إدارة؟ false تعني أن التاريخ مرساة يوم فقط. */
  kickoffConfirmed: boolean;
  timezone: string;
  cairoDate: string;
  homeTeam: ManualTeam;
  awayTeam: ManualTeam;
  competitionCode: string;
  competitionNameAr: string;
  competitionNameEn: string;
  competitionCountryAr: string;
  region: CompetitionRegion;
  seasonLabel: string;
  roundLabelAr: string | null;
  venue: string | null;
  cityAr: string | null;
  score: MatchScore;
  incidents: MatchIncidentSummary[];
  statusNoteAr: string | null;
  /** القناة الناقلة ومعلومات المشاهدة (اختياري — تُضاف فقط عند معرفتها فعلًا). */
  channelAr: string | null;
  broadcast: {
    status: BroadcastStatus;
    url: string | null;
    labelAr: string;
    notesAr: string | null;
  };
  keywords: string[];
  /** هل تُفهرس صفحتها وتدخل خريطة الموقع؟ (افتراضيًا نعم، كبقية المباريات). */
  indexable: boolean;
  sourceLabelAr: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/** خبر يكتبه المدير بنفسه (لا يعتمد على أي مصدر خارجي). */
export interface ManualNewsRecord {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  bodyAr: string;
  imageUrl: string | null;
  canonicalUrl: string | null;
  publisherName: string;
  categoryAr: string;
  publishedAt: string;
  cairoDate: string;
  status: Extract<NewsPublishStatus, 'published' | 'pending' | 'stale'>;
  tags: string[];
  relatedMatchIds: string[];
  indexable: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/** إعدادات الموقع القابلة للتغيير فعلًا في وقت التشغيل (كل بند له أثر حقيقي). */
export interface ManualSiteSettings {
  /** نافذة تحديث المباريات عند الطلب (بالدقائق) — يقرأها محرّك المزامنة. */
  matchesFreshnessMinutes: number;
  /** نافذة تحديث الأخبار عند الطلب (بالدقائق). */
  newsFreshnessMinutes: number;
  /** بعد هذه المدة بلا جلب ناجح يُعتبر المصدر متقادمًا ويظهر تنبيه في اللوحة. */
  staleSourceWarningHours: number;
  /** صورة المشاركة الافتراضية (مسار داخلي أو رابط https). */
  ogImagePath: string;
  /** الوصف التعريفي الافتراضي في البيانات الوصفية (يظهر في نتائج البحث). */
  siteDescriptionAr: string;
  /** هل تُضاف صفحات الأخبار إلى خريطة الموقع؟ */
  sitemapIncludeNews: boolean;
  /** شريط تنبيه عام أعلى الموقع — يُستخدم عند تعذّر التحديث التلقائي مثلًا. */
  banner: { enabled: boolean; textAr: string; tone: 'info' | 'warning' };
  /** بريد التواصل المعروض في صفحة «اتصل بنا» (إن ضُبط يتقدّم على متغيّر البيئة). */
  contactEmail: string | null;
}

/** تحكّم كل مصدر: التفعيل والترتيب — لا يُحذف إعداد المصدر عند تعطيله. */
export interface SourceControl {
  enabled: boolean;
  /** الأصغر أولًا. يُستخدم لإعادة الترتيب في اللوحة وفي مرشّح المزامنة. */
  priority: number;
  /** ملاحظة المشغّل عن سبب التعطيل (تُعرض في اللوحة وفي نتيجة المزامنة). */
  noteAr: string | null;
  updatedAt: string;
  updatedBy: string;
}

/** سطر في سجل التدقيق: من فعل ماذا ومتى وبنتيجة أي عملية. */
export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  role: AdminRole;
  action: string;
  target: string;
  summaryAr: string;
  ok: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export type AdminRole = 'owner' | 'editor' | 'viewer';

/**
 * تجاوز إداري على بطولة موجودة. الأثر حقيقي ومرئي: الأولوية تُعيد ترتيب البطولة في
 * الصفحة الرئيسية، والموسم يظهر في كل مباراة جديدة تُنشأ من اللوحة، والاسم والشعار
 * يظهران في بطاقات المباريات وفي البيانات المنظمة.
 */
export interface ManualCompetitionOverride {
  code: string;
  priority: number | null;
  currentSeason: string | null;
  nameAr: string | null;
  nameEn: string | null;
  logoUrl: string | null;
  nemoCompetitionSlug: string | null;
  noteAr: string | null;
  updatedAt: string;
  updatedBy: string;
}

/** فريق يضيفه المدير ليستخدمه في المباريات التي يُدخلها بلا مصدر خارجي. */
export interface ManualTeamRecord {
  id: string;
  nameAr: string;
  nameEn: string;
  shortNameAr: string | null;
  countryAr: string;
  logoUrl: string | null;
  stadium: string | null;
  isEgyptian: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ManualDocument {
  schemaVersion: string;
  /** يزداد مع كل كتابة — يُستخدم لكشف التعارض عند الكتابة من نسختين. */
  revision: number;
  updatedAt: string;
  updatedBy: string;
  matches: ManualMatchRecord[];
  overrides: ManualOverride[];
  news: ManualNewsRecord[];
  /** تجاوزات البطولات (الأولوية والموسم والاسم والشعار). */
  competitionOverrides: Record<string, ManualCompetitionOverride>;
  /** فرق أضافها المدير. */
  teams: ManualTeamRecord[];
  settings: ManualSiteSettings;
  sourceControls: Partial<Record<SourceId, SourceControl>>;
  audit: AuditEntry[];
}

/** كل مصادر المباريات المعتمدة في المشروع (المصدر الأخبار لا يوفّر مباريات). */
export const MATCH_SOURCE_IDS: SourceId[] = [
  'sportscore',
  'thesportsdb',
  'football-data',
  'api-football',
];

export const ALL_SOURCE_IDS: SourceId[] = [...MATCH_SOURCE_IDS, 'google-news-rss'];

/** أقصى عدد سطور محفوظة في سجل التدقيق (يُقصّ من الأقدم). */
export const AUDIT_LOG_LIMIT = 400;

export const DEFAULT_SITE_SETTINGS: ManualSiteSettings = {
  matchesFreshnessMinutes: 10,
  newsFreshnessMinutes: 15,
  staleSourceWarningHours: 36,
  ogImagePath: '/og-cover.jpg',
  siteDescriptionAr:
    'بوابة مباريات NEMO Sports: مواعيد ونتائج المباريات بتوقيت القاهرة، مع صفحة تفصيلية لكل مباراة ومشاهدة مباشرة.',
  sitemapIncludeNews: true,
  banner: { enabled: false, textAr: '', tone: 'info' },
  contactEmail: null,
};

/** مستند فارغ صالح — الأساس الذي يُبنى عليه أول تشغيل. */
export function emptyManualDocument(now = new Date().toISOString()): ManualDocument {
  return {
    schemaVersion: MANUAL_DOCUMENT_SCHEMA,
    revision: 0,
    updatedAt: now,
    updatedBy: 'system',
    matches: [],
    overrides: [],
    news: [],
    competitionOverrides: {},
    teams: [],
    settings: { ...DEFAULT_SITE_SETTINGS },
    sourceControls: {},
    audit: [],
  };
}

/** معرّف عربي/لاتيني صالح لمسار الموقع: حروف وأرقام وشرطات فقط. */
export function slugifyMatchId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u0600-\u06FF-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/** معرّف قصير فريد للسجلات الداخلية (تدقيق، أخبار…). */
export function createId(prefix: string, now = Date.now()): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${now.toString(36)}-${random}`;
}

function isPlainNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asScoreValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return isPlainNumber(n) ? n : null;
}

/** يبني النتيجة الموحّدة من مدخلات اللوحة (نصوص أو أرقام) بلا اختراع قيم. */
export function buildScore(input: {
  home?: unknown;
  away?: unknown;
  halfTimeHome?: unknown;
  halfTimeAway?: unknown;
}): MatchScore {
  return {
    home: asScoreValue(input.home),
    away: asScoreValue(input.away),
    halfTimeHome: asScoreValue(input.halfTimeHome),
    halfTimeAway: asScoreValue(input.halfTimeAway),
  };
}

/**
 * ترحيل أي مستند قادم من القرص/الشبكة إلى الشكل الحالي.
 * لا يفشل على ملف قديم: يستكمل الحقول الناقصة من الافتراضي ويستبعد السجلات غير الصالحة.
 */
/**
 * يُعيد سجلات مصفوفة إلى نسخة واحدة لكل معرّف (النسخة الأخيرة هي الأحدث حفظًا).
 *
 * السبب حقيقي ومُشاهد: معرّف مباراة/خبر الإدارة مُشتق من المعرّف/الرابط، فحفظ الخبر
 * نفسه مرّتين كان يُلحق نسخة ثانية بنفس المعرّف في المستند — فيتضخّم العدّاد وتظهر
 * نسخ مكرّرة في اللوحة. القراءة تُطبّع المستند دائمًا فلا تبقى نسخ مكرّرة في المخزون،
 * و`saveManualNews` يمنع تكرارها من الأصل.
 */
function dedupeRecordsById<T extends { id: string }>(records: T[]): T[] {
  const byId = new Map<string, T>();
  for (const record of records) byId.set(record.id, record);
  return Array.from(byId.values());
}

export function normalizeManualDocument(raw: unknown): ManualDocument {
  const base = emptyManualDocument();
  if (!raw || typeof raw !== 'object') return base;
  const candidate = raw as Partial<ManualDocument>;

  const settings: ManualSiteSettings = { ...DEFAULT_SITE_SETTINGS, ...(candidate.settings || {}) };
  settings.banner = { ...DEFAULT_SITE_SETTINGS.banner, ...(candidate.settings?.banner || {}) };

  return {
    schemaVersion: MANUAL_DOCUMENT_SCHEMA,
    revision: isPlainNumber(candidate.revision) ? candidate.revision : 0,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : base.updatedAt,
    updatedBy: typeof candidate.updatedBy === 'string' ? candidate.updatedBy : 'system',
    matches: Array.isArray(candidate.matches)
      ? dedupeRecordsById(
          candidate.matches.filter((item): item is ManualMatchRecord => Boolean(item?.id && item?.kickoffUtc))
        )
      : [],
    overrides: Array.isArray(candidate.overrides)
      ? candidate.overrides.filter((item): item is ManualOverride => Boolean(item?.matchId))
      : [],
    news: Array.isArray(candidate.news)
      ? dedupeRecordsById(
          candidate.news.filter((item): item is ManualNewsRecord => Boolean(item?.id && item?.title))
        )
      : [],
    competitionOverrides:
      candidate.competitionOverrides && typeof candidate.competitionOverrides === 'object'
        ? candidate.competitionOverrides
        : {},
    teams: Array.isArray(candidate.teams)
      ? dedupeRecordsById(
          candidate.teams.filter((item): item is ManualTeamRecord => Boolean(item?.id && item?.nameAr))
        )
      : [],
    settings,
    sourceControls:
      candidate.sourceControls && typeof candidate.sourceControls === 'object'
        ? candidate.sourceControls
        : {},
    audit: Array.isArray(candidate.audit)
      ? candidate.audit.filter((item): item is AuditEntry => Boolean(item?.id && item?.action))
      : [],
  };
}

export interface ValidationIssue {
  field: string;
  messageAr: string;
}

/**
 * تحقق كامل من مسودة مباراة قبل الحفظ — الرسائل عربية وتشير للحقل بالضبط.
 * لا يسمح بتمرير سجل ناقص يُنتج لاحقًا صفحة مكسورة أو بيانات منظمة خاطئة.
 */
export function validateManualMatchInput(input: Partial<ManualMatchRecord>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const require = (value: unknown, field: string, messageAr: string) => {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
      issues.push({ field, messageAr });
      return false;
    }
    return true;
  };

  require(input.homeTeam?.nameAr, 'homeTeam.nameAr', 'اسم الفريق الأول (بالعربية) مطلوب.');
  require(input.homeTeam?.nameEn, 'homeTeam.nameEn', 'اسم الفريق الأول (بالإنجليزية) مطلوب.');
  require(input.awayTeam?.nameAr, 'awayTeam.nameAr', 'اسم الفريق الثاني (بالعربية) مطلوب.');
  require(input.awayTeam?.nameEn, 'awayTeam.nameEn', 'اسم الفريق الثاني (بالإنجليزية) مطلوب.');
  require(input.competitionCode, 'competitionCode', 'كود البطولة مطلوب.');
  require(input.competitionNameAr, 'competitionNameAr', 'اسم البطولة بالعربية مطلوب.');
  require(input.competitionNameEn, 'competitionNameEn', 'اسم البطولة بالإنجليزية مطلوب.');
  require(input.seasonLabel, 'seasonLabel', 'الموسم مطلوب (مثال: 2026-2027).');

  const kickoffMs = input.kickoffUtc ? Date.parse(input.kickoffUtc) : Number.NaN;
  if (!Number.isFinite(kickoffMs)) {
    issues.push({ field: 'kickoffUtc', messageAr: 'موعد الانطلاق غير صالح — استخدم تاريخًا ووقتًا صحيحين.' });
  }
  if (input.cairoDate && !isValidDateParam(input.cairoDate)) {
    issues.push({ field: 'cairoDate', messageAr: 'تاريخ القاهرة يجب أن يكون بصيغة YYYY-MM-DD.' });
  }

  if (input.homeTeam?.nameAr && input.awayTeam?.nameAr &&
      input.homeTeam.nameAr.trim() === input.awayTeam.nameAr.trim()) {
    issues.push({ field: 'awayTeam', messageAr: 'لا يمكن أن يكون الفريقان نفس الفريق.' });
  }

  const status = input.status;
  if (status && !MANUAL_STATUS_ORDER.includes(status)) {
    issues.push({ field: 'status', messageAr: 'حالة المباراة غير معروفة.' });
  }

  // تناسق النتيجة مع الحالة: لا نتيجة لفريقين لم يلعبا، ولا انتهاء بلا نتيجة موثّقة.
  const score = input.score;
  const hasFullScore = score ? score.home !== null && score.away !== null : false;
  if (status === 'scheduled' && hasFullScore) {
    issues.push({
      field: 'score',
      messageAr: 'المباراة لم تبدأ بعد — لا يمكن إدخال نتيجة نهائية.',
    });
  }
  if (status === 'finished' && !hasFullScore) {
    issues.push({
      field: 'score',
      messageAr: 'المباراة منتهية — أدخل النتيجة النهائية للفريقين (أو غيّر الحالة).',
    });
  }
  if (hasFullScore && score && ((score.home as number) < 0 || (score.away as number) < 0)) {
    issues.push({ field: 'score', messageAr: 'النتيجة لا يمكن أن تكون سالبة.' });
  }

  if (input.broadcast?.url) {
    try {
      const url = new URL(input.broadcast.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        issues.push({ field: 'broadcast.url', messageAr: 'رابط البث يجب أن يكون http/https.' });
      }
    } catch {
      issues.push({ field: 'broadcast.url', messageAr: 'رابط البث غير صالح.' });
    }
  }
  if (input.broadcast?.status?.startsWith('verified') && !input.broadcast.url) {
    issues.push({
      field: 'broadcast.url',
      messageAr: 'حالة البث «موثَّق» تتطلب إدخال الرابط الذي جرى التحقق منه.',
    });
  }

  return issues;
}

/** يعيد بناء تاريخ/وقت القاهرة من موعد UTC — مصدر واحد للحقيقة في العرض. */
export function cairoFieldsFor(utcKickoff: string): { cairoDate: string; cairoTime: string } {
  const date = new Date(utcKickoff);
  if (!Number.isFinite(date.getTime())) return { cairoDate: '', cairoTime: '' };
  const cairoDate = toCairoDateString(date) || '';
  const cairoTime = toCairoTime24(utcKickoff);
  return { cairoDate, cairoTime };
}

/** الوقت بالعربية كما يظهر في الصفحات (مثال: ٧:٠٠ م). */
export function cairoTimeLabelFor(utcKickoff: string): string {
  return toCairoTimeArabic(utcKickoff);
}

/**
 * يحوّل مباراة الإدخال اليدوي إلى `MatchRecord` بنفس مفردات الطلب التي تنتجها
 * المصادر — فيمرّ السجل في كل مسارات الموقع (البطاقات، الصفحات، JSON-LD، الخريطة)
 * بلا أي كود خاص بالإدارة.
 */
export function buildMatchRecordFromManual(record: ManualMatchRecord): MatchRecord {
  const competition =
    CANONICAL_COMPETITIONS.find((comp) => comp.code === record.competitionCode) ?? null;
  const { cairoDate, cairoTime } = cairoFieldsFor(record.kickoffUtc);
  const status = MANUAL_STATUS_TO_SOURCE_STATUS[record.status];

  return {
    origin: 'manual',
    id: record.id,
    competitionId: competition?.id ?? `manual-${record.competitionCode.toLowerCase()}`,
    competitionCode: record.competitionCode,
    competitionNameAr: record.competitionNameAr,
    competitionNameEn: record.competitionNameEn,
    competitionLogo: competition?.logoUrl ?? null,
    countryAr: record.competitionCountryAr,
    region: record.region,
    priority: competition?.priority ?? 50,
    isEgyptianInterest: record.region === 'egypt',
    seasonLabel: record.seasonLabel,
    roundLabelAr: record.roundLabelAr,
    utcKickoff: record.kickoffUtc,
    kickoffConfirmed: record.kickoffConfirmed,
    cairoDate,
    cairoTime,
    homeTeam: {
      id: record.homeTeam.id || `manual-team-${slugifyMatchId(record.homeTeam.nameEn)}`,
      nameAr: record.homeTeam.nameAr,
      nameEn: record.homeTeam.nameEn,
      logoUrl: record.homeTeam.logoUrl,
      isEgyptian: (record.homeTeam.countryAr || '') === 'مصر' || record.region === 'egypt',
    },
    awayTeam: {
      id: record.awayTeam.id || `manual-team-${slugifyMatchId(record.awayTeam.nameEn)}`,
      nameAr: record.awayTeam.nameAr,
      nameEn: record.awayTeam.nameEn,
      logoUrl: record.awayTeam.logoUrl,
      isEgyptian: (record.awayTeam.countryAr || '') === 'مصر' || record.region === 'egypt',
    },
    status,
    statusLabelAr:
      status === 'live' && record.status === 'break'
        ? MANUAL_STATUS_LABEL_AR.break
        : MANUAL_STATUS_LABEL_AR[record.status],
    statusNoteAr: record.statusNoteAr,
    liveMinute: record.liveMinute ?? null,
    score: record.score,
    incidents: record.incidents.length > 0 ? record.incidents : undefined,
    venue: record.venue,
    // مصدر السجل هو الإدارة نفسها — لا ننسبه لأي مزوّد خارجي لم يشارك فيه.
    primarySource: 'sportscore',
    contributingSources: [],
    externalIds: {},
    nemoLink: {
      url: null,
      linkType: 'unavailable',
      labelAr: 'مشاهدة داخل البوابة',
      subLabelAr: 'صفحة المشاهدة الموحّدة',
      verified: false,
      matchedBy: [],
      competitionUrl: null,
      scheduleUrl: null,
    },
    lastUpdatedAt: record.updatedAt,
    fieldProvenance: {
      status: { source: 'sportscore', observedAt: record.updatedAt },
      score: { source: 'sportscore', observedAt: record.updatedAt },
    },
  };
}

/**
 * يحوّل مباراة الإدخال اليدوي إلى سجل كتالوج، فتحصل تلقائيًا على صفحة هبوط
 * وصفحة بث وبيانات SportsEvent منظمة ومدخل في خريطة الموقع.
 */
export function buildCatalogEntryFromManual(record: ManualMatchRecord): MatchCatalogEntry {
  const { cairoDate } = cairoFieldsFor(record.kickoffUtc);
  const competition =
    CANONICAL_COMPETITIONS.find((comp) => comp.code === record.competitionCode) ?? null;
  const score = record.score;
  return {
    id: record.id,
    status: MANUAL_STATUS_TO_CATALOG_STATUS[record.status],
    kickoffUtc: record.kickoffUtc,
    durationMinutes: 120,
    endDateUtc: null,
    cairoDate,
    homeTeam: {
      id: record.homeTeam.id || `manual-team-${slugifyMatchId(record.homeTeam.nameEn)}`,
      nameAr: record.homeTeam.nameAr,
      nameEn: record.homeTeam.nameEn,
      shortNameAr: null,
      logoUrl: record.homeTeam.logoUrl,
      countryAr: record.homeTeam.countryAr,
      countryCode: null,
      teamPageUrl: null,
    },
    awayTeam: {
      id: record.awayTeam.id || `manual-team-${slugifyMatchId(record.awayTeam.nameEn)}`,
      nameAr: record.awayTeam.nameAr,
      nameEn: record.awayTeam.nameEn,
      shortNameAr: null,
      logoUrl: record.awayTeam.logoUrl,
      countryAr: record.awayTeam.countryAr,
      countryCode: null,
      teamPageUrl: null,
    },
    competition: {
      code: record.competitionCode,
      nameAr: record.competitionNameAr,
      nameEn: record.competitionNameEn,
      countryAr: record.competitionCountryAr,
      region: record.region,
      seasonLabel: record.seasonLabel,
      roundLabelAr: record.roundLabelAr,
      competitionPageUrl: competition?.nemoCompetitionSlug
        ? `https://nemo-sports.vercel.app/competitions/${competition.nemoCompetitionSlug}`
        : null,
    },
    venue: {
      kind: 'stadium',
      name: record.venue || 'يُعلن لاحقًا',
      cityAr: record.cityAr,
      cityEn: null,
      countryAr: record.competitionCountryAr,
      countryCode: null,
      streetAddress: null,
      onlineLabelAr: null,
    },
    broadcast: {
      status: record.broadcast.status,
      url: record.broadcast.url,
      embedUrl: null,
      labelAr: record.broadcast.labelAr,
      providerNameAr: 'نيمو كورة لايف',
      isFree: true,
      price: '0',
      priceCurrency: 'EGP',
      availableFromUtc: null,
      notesAr: record.broadcast.notesAr,
    },
    keywords: record.keywords.length > 0 ? record.keywords : [
      `مباراة ${record.homeTeam.nameAr} و${record.awayTeam.nameAr}`,
      `موعد مباراة ${record.awayTeam.nameAr} اليوم`,
      `${record.homeTeam.nameEn} vs ${record.awayTeam.nameEn}`,
    ],
    schema: {
      homeScore: score.home,
      awayScore: score.away,
      previousStartDateUtc: null,
      eventStatusOverride: null,
    },
    source: {
      // الربط الصريح بالمعرّف نفسه هو ما يجعل رؤية الصفحة تقرأ هذا السجل بالضبط.
      matchId: record.id,
      provider: 'manual',
      providerMatchId: null,
      thesportsdbEventId: null,
      apiFootballFixtureId: null,
      competitionCode: record.competitionCode,
      homeTeamId: record.homeTeam.id || `manual-team-${slugifyMatchId(record.homeTeam.nameEn)}`,
      awayTeamId: record.awayTeam.id || `manual-team-${slugifyMatchId(record.awayTeam.nameEn)}`,
      cairoDate,
    },
    updatedAt: record.updatedAt,
  };
}

/**
 * ملخّص مقروء لسياسة فضّ التعارض — يُعرض في اللوحة وفي التقرير حتى يعرف المشغّل
 * بالضبط لماذا لن تُمحى تعديلاته.
 */
export const CONFLICT_POLICY_SUMMARY_AR = [
  'الأولوية من الأعلى إلى الأدنى: (1) حقل ثبّته المدير، (2) مباراة أدخلها المدير بالكامل، (3) قيمة أحدث من مصدر غير مستبعَد، (4) بيانات الكتالوج الاحتياطية.',
  'الحقل المثبَّت لا يستطيع أي مصدر كتابته — لا في المزامنة التالية ولا في أي مزامنة بعدها، حتى يفكّ المدير التثبيت صراحةً.',
  'استبعاد مصدر على مباراة بعينها يمنع كتابته في تلك المباراة فقط، ويظل المصدر يعمل على بقية المباريات.',
  'كل تعديل يدوي مسجَّل باسم من قام به ووقته، ويظهر في سجل التدقيق.',
] as const;
