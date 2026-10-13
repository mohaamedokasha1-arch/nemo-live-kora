import type {
  CompetitionRegion,
  MatchRecord,
  MatchScore,
  MatchStatusCode,
  SourceId,
} from '../types';

/**
 * ============================================================================
 *  Automated Match Engine — طبقة الأنواع
 * ============================================================================
 *  كل مباراة في `data/matches.ts` تُوصف بهذا النوع، ومنه يُبنى أوتوماتيكيًا:
 *   1. صفحة الهبوط   → /matches/[id]
 *   2. صفحة البث     → /live/[id]
 *   3. البيانات المنظمة → SportsEvent JSON-LD (كامل الحقول)
 *   4. خريطة الموقع  → app/sitemap.ts
 *  لذلك كل حقل إلزامي هنا يجب أن يكون صحيحًا وإلا فشل التحقق (`validateMatchCatalogEntry`).
 */

/** حالة المصادر في كتالوج المباريات (تُترجم تلقائيًا لحالة Schema.org). */
export type MatchCatalogStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled'
  | 'suspended';

/** مدى توفّر البث: لا نُعلن بثًا قبل التحقق منه فعليًا. */
export type BroadcastStatus =
  | 'verified_free'
  | 'verified_paid'
  | 'unverified'
  | 'not_available';

/** نوع الموقع: ملعب (Place) أو بث عبر الإنترنت (VirtualLocation) أو الاثنان. */
export type MatchLocationKind = 'stadium' | 'online' | 'hybrid';

export interface MatchCatalogTeam {
  /** المعرّف الموحّد للفريق (مثل team-zamalek) — يُستخدم للربط مع قاعدة المباريات الحيّة. */
  id: string;
  nameAr: string;
  nameEn: string;
  shortNameAr?: string | null;
  /** صورة الشعار (تُستخدم في الواجهة وفي `image` بالبيانات المنظمة). */
  logoUrl?: string | null;
  countryAr?: string | null;
  /** كود الدولة بصيغة ISO 3166-1 alpha-2 (مطلوب داخل `addressCountry`). */
  countryCode?: string | null;
  /** رابط صفحة الفريق على منصة NEMO Sports — يُضاف فقط عند التحقق من مطابقته. */
  teamPageUrl?: string | null;
}

export interface MatchCatalogCompetition {
  /** كود البطولة الموحّد داخل `lib/catalog.ts` (EGY, CAFC, CAF, PD, ...). */
  code: string;
  nameAr: string;
  nameEn: string;
  countryAr?: string | null;
  region?: CompetitionRegion;
  seasonLabel?: string | null;
  roundLabelAr?: string | null;
  /** رابط صفحة البطولة (يستخدمها `organizer.url`). */
  competitionPageUrl?: string | null;
}

export interface MatchCatalogVenue {
  kind?: MatchLocationKind;
  name: string;
  cityAr?: string | null;
  cityEn?: string | null;
  countryAr?: string | null;
  countryCode?: string | null;
  /** عنوان افتراضي احتياطي عند غياب المدينة (لا يُخترع عنوان وهمي). */
  streetAddress?: string | null;
  /** نص الموقع الافتراضي عند البث عبر الإنترنت. */
  onlineLabelAr?: string | null;
}

export interface MatchCatalogBroadcast {
  status: BroadcastStatus;
  /** رابط البث الخارجي — لا يُضاف إلا بعد التحقق، وإلا فيبقى null. */
  url?: string | null;
  /** رابط تشغيل مضمّن (iframe) — اختياري بالكامل. */
  embedUrl?: string | null;
  labelAr: string;
  providerNameAr?: string | null;
  isFree?: boolean;
  /** السعر داخل كائن Offer (النص وليس الرقم، كما تطلب Google). */
  price?: string;
  priceCurrency?: 'EGP' | 'USD' | 'SAR' | 'AED' | 'EUR';
  availableFromUtc?: string | null;
  notesAr?: string | null;
}

export interface MatchCatalogSeo {
  title?: string | null;
  description?: string | null;
  /** صورة 1200×675 مُستضافة على النطاق (تسبق شعارات الفرق في البيانات المنظمة). */
  imageUrl?: string | null;
  keywords?: string[];
  excludeFromSitemap?: boolean;
}

/** روابط التحقق مع قاعدة المباريات (كل سجل مُسنَد إلى مصدره). */
export interface MatchCatalogSourceRef {
  /** معرّف السجل في `data/gateway-store.json` مثل match-api-football-1612263. */
  matchId?: string | null;
  provider?: SourceId | null;
  providerMatchId?: string | null;
  sportscoreSlug?: string | null;
  thesportsdbEventId?: string | null;
  apiFootballFixtureId?: string | null;
  competitionCode: string;
  homeTeamId: string;
  awayTeamId: string;
  cairoDate: string;
}

export interface MatchCatalogEntry {
  /** المعرّف/السلَغ الفريد للمباراة داخل مسار الموقع: /matches/<id>. */
  id: string;
  status: MatchCatalogStatus;
  /** موعد الانطلاق بتوقيت UTC بصيغة ISO 8601 (مثال: 2026-10-20T17:00:00.000Z). */
  kickoffUtc: string;
  /** المدة المتوقعة بالدقائق — منها يُحسب endDate أوتوماتيكيًا. */
  durationMinutes: number;
  /** تجاوز صريح لوقت النهاية (اختياري) بصيغة ISO 8601 UTC. */
  endDateUtc?: string | null;
  /** تاريخ المباراة بتوقيت القاهرة بصيغة YYYY-MM-DD. */
  cairoDate: string;
  homeTeam: MatchCatalogTeam;
  awayTeam: MatchCatalogTeam;
  competition: MatchCatalogCompetition;
  venue: MatchCatalogVenue;
  broadcast: MatchCatalogBroadcast;
  /** كلمات مفتاحية تُستخدم في محتوى الصفحة وفي `keywords` بالبيانات المنظمة. */
  keywords: string[];
  seo?: MatchCatalogSeo;
  source: MatchCatalogSourceRef;
  /** آخر تحديث تحريري للسجل (يُستخدم في sitemap lastModified). */
  updatedAt: string;
  /** حقول إضافية اختيارية للبيانات المنظمة. */
  schema?: {
    /** نتيجة المباراة المعلنة داخل البيانات المنظمة (لا تُخترع؛ تُترك فارغة إن لم تتأكد). */
    homeScore?: number | null;
    awayScore?: number | null;
    /** يُستخدم مع EventRescheduled فقط (كما تطلب Google). */
    previousStartDateUtc?: string | null;
    /** تجاوز يدوي لحالة الحدث إن احتاجت المباراة ذلك. */
    eventStatusOverride?: string | null;
  };
}

/** رؤية موحّدة لمباراة بعد دمج الكتالوج مع بيانات المصادر الحيّة. */
export interface ResolvedMatchView {
  entry: MatchCatalogEntry;
  /** هل جاءت الحالة/النتيجة من سجل مصدر حقيقي في قاعدة البيانات؟ */
  hasLiveSourceRecord: boolean;
  sourceMatch: MatchRecord | null;
  status: MatchStatusCode;
  statusLabelAr: string;
  statusNoteAr: string | null;
  liveMinute: number | null;
  score: MatchScore | null;
  kickoffUtc: string;
  endDateUtc: string;
  kickoffConfirmed: boolean;
  kickoffTimeAr: string;
  cairoDateLabelAr: string;
  venueName: string;
  /** رابط صفحة الهبوط الرسمية. */
  canonicalPath: string;
  canonicalUrl: string;
  /** رابط صفحة البث الداخلي. */
  livePath: string;
  liveUrl: string;
  isLive: boolean;
  isFinished: boolean;
  /** آخر تحديث للبيانات المعروضة. */
  updatedAt: string;
  /** رابط خارجي موثّق للبث إن وُجد. */
  verifiedBroadcastUrl: string | null;
  /** رابط صفحة المباراة المطابقة على NEMO Sports إن تم التحقق منها. */
  verifiedNemoMatchUrl: string | null;
}
