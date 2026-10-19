import {
  addMinutesToIso,
  formatArabicFullDate,
  isValidDateParam,
  toCairoDateString,
  toCairoTimeArabic,
} from '../cairo-time';
import { CANONICAL_COMPETITIONS } from '../catalog';
import { getActiveMatches, getGatewayDatabase } from '../db/store';
import { applyManualLayerToMatch, manualMatchAsRecord } from '../admin/overrides';
import { GATEWAY_SITE_URL } from '../site-url';
import type { MatchRecord, MatchScore, MatchStatusCode } from '../types';
import { buildMatchLandingPath, buildMatchLivePath } from './match-links';
import {
  findServedCatalogEntryForMatch,
  getServedCatalogEntries,
  getServedFeaturedCatalogEntry,
} from '../admin/served-catalog';
import type {
  MatchCatalogEntry,
  MatchCatalogStatus,
  ResolvedMatchView,
} from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Automated Match Engine — نواة التوليد (Server / Node)
 * ═══════════════════════════════════════════════════════════════════════════
 *  مسؤوليات هذه الطبقة:
 *   • دمج سجل الكتالوج التحريري مع بيانات المصادر الحيّة (الحالة/النتيجة/الملعب).
 *   • التحقق الصارم من كل سجل قبل النشر (يمنع أخطاء البيانات المنظمة في Search Console).
 *   • تجهيز مدخلات خريطة الموقع والصفحة الرئيسية.
 */

const CATALOG_STATUS_MAP: Record<MatchCatalogStatus, MatchStatusCode> = {
  scheduled: 'not_started',
  live: 'live',
  finished: 'finished',
  postponed: 'postponed',
  cancelled: 'cancelled',
  suspended: 'suspended',
};

const STATUS_LABEL_AR: Record<MatchStatusCode, string> = {
  not_started: 'لم تبدأ بعد',
  live: 'جارية الآن',
  finished: 'انتهت المباراة',
  postponed: 'مؤجلة',
  cancelled: 'أُلغيت',
  suspended: 'متوقفة مؤقتًا',
  unconfirmed: 'قيد التحديث',
};

/** أقصى مدة معقولة لمباراة كرة قدم مع الوقت الإضافي والبدل (بالدقائق). */
const MAX_PLAUSIBLE_MATCH_MINUTES = 180;

/**
 * سجل المباراة كما تعرضه الصفحات: من مخزن المصادر إن وُجد، وإلا من مباريات
 * لوحة الإدارة، ثم تُطبَّق الحقول المثبَّتة يدويًا فوق النتيجة.
 *
 * الطبقتان معًا تضمنان أن أي تعديل للمدير يظهر في صفحة الهبوط وصفحة البث
 * والبيانات المنظمة — حتى لو لم تُحدَّث لقطة المخزن بعد.
 */
export function resolveSourceMatchRecord(entry: MatchCatalogEntry): MatchRecord | null {
  const db = getGatewayDatabase();
  // سجلات التكرار المُثبتة لا تُغذّي صفحة الهبوط: السجل الأساسي وحده هو مصدر الحالة والنتيجة.
  const fromStore =
    getActiveMatches(db).find((match) => findServedCatalogEntryForMatch(match)?.id === entry.id) ?? null;
  const record = fromStore ?? manualMatchAsRecord(entry.id);
  return record ? applyManualLayerToMatch(record) : null;
}

/**
 * حالة احتياطية عند عدم وجود سجل مصدر لهذه المباراة:
 * لا ندّعي «جارية الآن» أبدًا بدون مصدر؛ نعرض «لم تبدأ» أو «قيد التحديث» مع ملاحظة واضحة،
 * ونص الملاحظة نفسه يبقى واثقًا ومهنيًا لا يشكّك الزائر في الموقع.
 */
function resolveCatalogOnlyStatus(
  entry: MatchCatalogEntry,
  now: Date
): { status: MatchStatusCode; labelAr: string; noteAr: string | null } {
  const baseStatus = CATALOG_STATUS_MAP[entry.status];
  const kickoffMs = new Date(entry.kickoffUtc).getTime();
  if (entry.status !== 'scheduled' || Number.isNaN(kickoffMs)) {
    return { status: baseStatus, labelAr: STATUS_LABEL_AR[baseStatus], noteAr: null };
  }

  const elapsedMinutes = (now.getTime() - kickoffMs) / 60_000;
  if (elapsedMinutes > MAX_PLAUSIBLE_MATCH_MINUTES) {
    return {
      status: 'unconfirmed',
      labelAr: STATUS_LABEL_AR.unconfirmed,
      noteAr:
        'انتهى الموعد المعلن للمباراة، والنتيجة النهائية قيد التحديث من المصدر تلقائيًا.',
    };
  }
  if (elapsedMinutes > 0) {
    return {
      status: 'not_started',
      labelAr: 'الموعد المعلن بدأ — بانتظار تحديث المصدر',
      noteAr: 'تُحدَّث حالة المباراة تلقائيًا من المصدر.',
    };
  }
  return { status: baseStatus, labelAr: STATUS_LABEL_AR[baseStatus], noteAr: null };
}

/**
 * يدمج سجل الكتالوج مع بيانات المصادر الحيّة وينتج رؤية واحدة موحّدة
 * تستخدمها صفحة الهبوط وصفحة البث والبيانات المنظمة وخريطة الموقع.
 */
export function resolveMatchView(entry: MatchCatalogEntry, now: Date = new Date()): ResolvedMatchView {
  const sourceMatch = resolveSourceMatchRecord(entry);
  const catalogOnly = resolveCatalogOnlyStatus(entry, now);

  const status: MatchStatusCode = sourceMatch ? sourceMatch.status : catalogOnly.status;
  const statusLabelAr = sourceMatch ? sourceMatch.statusLabelAr : catalogOnly.labelAr;
  const statusNoteAr = sourceMatch ? sourceMatch.statusNoteAr : catalogOnly.noteAr;

  const kickoffUtc =
    sourceMatch && sourceMatch.kickoffConfirmed === true ? sourceMatch.utcKickoff : entry.kickoffUtc;
  const endDateUtc =
    entry.endDateUtc && !Number.isNaN(new Date(entry.endDateUtc).getTime())
      ? entry.endDateUtc
      : addMinutesToIso(kickoffUtc, entry.durationMinutes) ?? kickoffUtc;

  const score: MatchScore | null = sourceMatch ? sourceMatch.score : null;
  const canonicalPath = buildMatchLandingPath(entry.id);
  const siteUrl = GATEWAY_SITE_URL;

  return {
    entry,
    hasLiveSourceRecord: sourceMatch !== null,
    sourceMatch,
    status,
    statusLabelAr,
    statusNoteAr,
    liveMinute: sourceMatch?.liveMinute ?? null,
    score,
    kickoffUtc,
    endDateUtc,
    kickoffConfirmed:
      sourceMatch?.kickoffConfirmed === true || (!sourceMatch && Number.isFinite(new Date(entry.kickoffUtc).getTime())),
    kickoffTimeAr: toCairoTimeArabic(kickoffUtc),
    cairoDateLabelAr: formatArabicFullDate(entry.cairoDate),
    venueName: sourceMatch?.venue?.trim() || entry.venue.name,
    canonicalPath,
    canonicalUrl: `${siteUrl}${canonicalPath}`,
    livePath: buildMatchLivePath(entry.id),
    liveUrl: `${siteUrl}${buildMatchLivePath(entry.id)}`,
    isLive: status === 'live',
    isFinished: status === 'finished',
    updatedAt: mostRecentIso([sourceMatch?.lastUpdatedAt ?? null, entry.updatedAt]) ?? entry.updatedAt,
    verifiedBroadcastUrl:
      entry.broadcast.status.startsWith('verified') && entry.broadcast.url
        ? entry.broadcast.url
        : null,
    verifiedNemoMatchUrl:
      sourceMatch?.nemoLink.verified && sourceMatch.nemoLink.url ? sourceMatch.nemoLink.url : null,
  };
}

function mostRecentIso(values: Array<string | null | undefined>): string | null {
  let latest: number | null = null;
  let latestIso: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) continue;
    if (latest === null || ms > latest) {
      latest = ms;
      latestIso = value;
    }
  }
  return latestIso;
}

/**
 * كل سجلات الكتالوج التي تُقام في تاريخ قاهري معيّن (YYYY-MM-DD).
 * تُستخدم في بطاقة المشاركة الخاصة بجدول اليوم (opengraph-image).
 */
export function findCatalogEntriesByCairoDate(cairoDate: string): MatchCatalogEntry[] {
  return getServedCatalogEntries().filter((entry) => entry.cairoDate === cairoDate);
}

/** كل المباريات المدمجة، مرتبة زمنيًا من الأحدث إلى الأقدم. */
export function resolveAllMatchViews(now: Date = new Date()): ResolvedMatchView[] {
  return getServedCatalogEntries()
    .map((entry) => resolveMatchView(entry, now))
    .sort((a, b) => new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime());
}

/** مباراة الأسبوع المعروضة في بوابة الصفحة الرئيسية. */
export function resolveFeaturedMatchView(now: Date = new Date()): ResolvedMatchView | null {
  const entry = getServedFeaturedCatalogEntry();
  return entry ? resolveMatchView(entry, now) : null;
}

/** المباريات القادمة (الموعد لم يمضِ بعد)، الأقرب أولًا. */
export function resolveUpcomingMatchViews(limit = 6, now: Date = new Date()): ResolvedMatchView[] {
  return resolveAllMatchViews(now)
    .filter((view) => new Date(view.kickoffUtc).getTime() >= now.getTime() - 60 * 60 * 1000)
    .filter((view) => view.status !== 'finished' && view.status !== 'cancelled')
    .slice(0, limit);
}

export interface CatalogSitemapItem {
  path: string;
  lastModified: Date;
  changeFrequency: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
}

/**
 * مدخلات خريطة الموقع لكل مباراة مُفعّلة (مع توقيت آخر تحديث حقيقي).
 * الرابط يُضاف تلقائيًا بمجرد إضافة المباراة إلى `data/matches.ts` أو لوحة الإدارة.
 *
 * الفلتر هنا **نفس بوابة** `robots.index` في `buildMatchLandingMetadata` حرفيًا
 * (`isIndexableCatalogEntry`): ما لا يُراد فهرسته أو تعجز صفحته عن إنتاج محتوى صحيح
 * لا يُعلن في الخريطة — فلا تعارض أبدًا بين إشارة الخريطة وإشارة الصفحة.
 */
export function getCatalogSitemapItems(now: Date = new Date()): CatalogSitemapItem[] {
  return resolveAllMatchViews(now)
    .filter((view) => view.entry.seo?.excludeFromSitemap !== true)
    .filter((view) => isIndexableCatalogEntry(view.entry))
    .map((view) => {
      const kickoffMs = new Date(view.kickoffUtc).getTime();
      const hoursToKickoff = (kickoffMs - now.getTime()) / 3_600_000;
      const priority = view.isLive
        ? 0.95
        : view.isFinished
        ? 0.7
        : hoursToKickoff <= 48
        ? 0.9
        : 0.8;
      const changeFrequency: CatalogSitemapItem['changeFrequency'] = view.isLive
        ? 'hourly'
        : view.isFinished
        ? 'weekly'
        : 'daily';
      return {
        path: view.canonicalPath,
        lastModified: new Date(view.updatedAt),
        changeFrequency,
        priority,
      };
    });
}

/* ══════════════════════════════════════════════════════════════════════════
 *  التحقق الصارم (يمنع أخطاء Search Console قبل النشر)
 * ══════════════════════════════════════════════════════════════════════════ */

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VALID_CURRENCIES = new Set(['EGP', 'USD', 'SAR', 'AED', 'EUR']);
const COMPETITION_CODES = new Set(CANONICAL_COMPETITIONS.map((competition) => competition.code));

function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isValidIso(value: string | null | undefined): boolean {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

/**
 * يعيد قائمة بأخطاء السجل (فارغة = السجل سليم ومؤهل للنشر التلقائي).
 * الشرط الأخطر: منع أي رابط بث غير مُتحقَّق منه، ومنع أي تاريخ غير متسق مع UTC.
 */
export function validateMatchCatalogEntry(entry: MatchCatalogEntry): string[] {
  const errors: string[] = [];
  const push = (message: string) => errors.push(`[${entry.id || 'بلا معرّف'}] ${message}`);

  if (!entry.id || !ID_PATTERN.test(entry.id)) {
    push('المعرّف يجب أن يكون سلَغ لاتيني صغير (a-z, 0-9, -) بدون مسافات.');
  }
  if (entry.id.length > 120) {
    push('المعرّف أطول من 120 حرفًا، وهو غير مناسب لروابط SEO.');
  }

  if (!isValidIso(entry.kickoffUtc)) {
    push('kickoffUtc يجب أن يكون تاريخًا صحيحًا بصيغة ISO 8601 (مثال: 2026-10-20T17:00:00.000Z).');
  } else {
    const expectedCairoDate = toCairoDateString(entry.kickoffUtc);
    if (!isValidDateParam(entry.cairoDate)) {
      push('cairoDate يجب أن يكون بصيغة YYYY-MM-DD.');
    } else if (expectedCairoDate !== entry.cairoDate) {
      push(
        `cairoDate (${entry.cairoDate}) لا يطابق توقيت القاهرة المحسوب من kickoffUtc (${expectedCairoDate}).`
      );
    }
  }

  if (!Number.isFinite(entry.durationMinutes) || entry.durationMinutes < 30 || entry.durationMinutes > 300) {
    push('durationMinutes يجب أن تكون رقمًا بين 30 و300 دقيقة.');
  }
  if (entry.endDateUtc && !isValidIso(entry.endDateUtc)) {
    push('endDateUtc ليس تاريخًا صحيحًا بصيغة ISO 8601.');
  }
  const endMs = new Date(entry.endDateUtc ?? addMinutesToIso(entry.kickoffUtc, entry.durationMinutes) ?? '').getTime();
  const startMs = new Date(entry.kickoffUtc).getTime();
  if (Number.isFinite(endMs) && Number.isFinite(startMs) && endMs <= startMs) {
    push('endDate يجب أن يكون بعد startDate.');
  }

  for (const [side, team] of [
    ['homeTeam', entry.homeTeam],
    ['awayTeam', entry.awayTeam],
  ] as const) {
    if (!team?.id || !ID_PATTERN.test(team.id)) push(`${side}.id مفقود أو غير صالح.`);
    if (!team?.nameAr?.trim()) push(`${side}.nameAr مطلوب (يظهر في اسم الحدث والبيانات المنظمة).`);
    if (!team?.nameEn?.trim()) push(`${side}.nameEn مطلوب.`);
    if (team?.logoUrl && !isHttpUrl(team.logoUrl)) push(`${side}.logoUrl ليس رابطًا صحيحًا.`);
    if (team?.teamPageUrl && !isHttpUrl(team.teamPageUrl)) push(`${side}.teamPageUrl ليس رابطًا صحيحًا.`);
  }
  if (entry.homeTeam?.id && entry.homeTeam.id === entry.awayTeam?.id) {
    push('لا يمكن أن يكون الفريقان نفس الفريق.');
  }

  if (!entry.competition?.code || !COMPETITION_CODES.has(entry.competition.code)) {
    push('competition.code يجب أن يطابق كود بطولة معروفًا في lib/catalog.ts (مثل EGY أو CAFC).');
  }
  if (!entry.competition?.nameAr?.trim()) push('competition.nameAr مطلوب (يُستخدم في organizer).');
  if (entry.competition?.competitionPageUrl && !isHttpUrl(entry.competition.competitionPageUrl)) {
    push('competition.competitionPageUrl ليس رابطًا صحيحًا.');
  }

  if (!entry.venue?.name?.trim()) push('venue.name مطلوب (يُستخدم في location).');
  if (entry.venue?.kind !== 'online' && !entry.venue?.countryCode?.trim()) {
    push('venue.countryCode مطلوب للمباريات في الملعب (addressCountry في location).');
  }

  if (!entry.broadcast?.status) {
    push('broadcast.status مطلوب.');
  } else if (entry.broadcast.status.startsWith('verified')) {
    if (!isHttpUrl(entry.broadcast.url)) {
      push('رابط البث مُعلن كمُتحقَّق منه (verified) لكن broadcast.url غير صالح.');
    }
  } else if (entry.broadcast.url) {
    push('لا يجوز وضع broadcast.url لحالة غير مُتحقَّق منها؛ اضبط status أو أزل الرابط.');
  }
  if (entry.broadcast?.embedUrl && !isHttpUrl(entry.broadcast.embedUrl)) {
    push('broadcast.embedUrl ليس رابطًا صحيحًا.');
  }
  if (entry.broadcast?.priceCurrency && !VALID_CURRENCIES.has(entry.broadcast.priceCurrency)) {
    push('broadcast.priceCurrency يجب أن يكون أحد: EGP, USD, SAR, AED, EUR.');
  }
  if (entry.broadcast?.price && !/^\d+(\.\d+)?$/.test(entry.broadcast.price)) {
    push('broadcast.price يجب أن يكون نصًا رقميًا (مثل "0") كما تطلب Google في offers.price.');
  }
  if (entry.broadcast?.isFree === false && (!entry.broadcast.price || entry.broadcast.price === '0')) {
    push('البث غير المجاني يحتاج سعرًا حقيقيًا في broadcast.price.');
  }

  if (!Array.isArray(entry.keywords) || entry.keywords.length < 3) {
    push('keywords تحتاج 3 كلمات مفتاحية على الأقل لصفحة الهبوط.');
  }

  if (!entry.source?.competitionCode || !entry.source?.homeTeamId || !entry.source?.awayTeamId) {
    push('source يحتاج competitionCode و homeTeamId و awayTeamId للربط مع قاعدة المصادر.');
  }
  if (entry.source?.cairoDate && entry.source.cairoDate !== entry.cairoDate) {
    push('source.cairoDate يجب أن يطابق cairoDate.');
  }
  if (!isValidIso(entry.updatedAt)) {
    push('updatedAt يجب أن يكون تاريخًا صحيحًا بصيغة ISO 8601.');
  }

  return errors;
}

/** يتحقق من كل الكتالوج + يمنع تكرار المعرّفات. يعيد [] عندما يكون كل شيء سليمًا. */
export function validateMatchCatalog(entries: MatchCatalogEntry[] = getServedCatalogEntries()): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    errors.push(...validateMatchCatalogEntry(entry));
    const key = entry.id?.toLowerCase();
    if (key && seen.has(key)) errors.push(`[${entry.id}] معرّف مكرر في data/matches.ts.`);
    if (key) seen.add(key);
  }
  return errors;
}

/**
 * هل صفحة هذه المباراة مؤهلة فعليًا للفهرسة؟
 *
 * ⚠️ هذه البوابة **ليست** التدقيق الصارم `validateMatchCatalogEntry` الذي يفرض أعلى
 * معايير الجودة على كتالوج `data/matches.ts` (ويظل مطلوبًا في اختبارات المشروع).
 * هنا سؤال واحد فقط: هل تُنتج هذه الصفحة عند فتحها محتوى صحيحًا وبيانات منظمة سليمة،
 * أم أن إعلانها للفهرسة خطأ؟
 *
 * أسباب رفض الفهرسة — وهذه وحدها:
 *  ① طلب صريح بعدم الفهرسة (`seo.noindex` = حقل «قابل للفهرسة» في لوحة الإدارة).
 *  ② معرّف غير صالح = لا رابط ثابت وفريد للمباراة.
 *  ③ تواريخ غير صالحة أو متناقضة: `kickoffUtc`/`cairoDate`/المدة (startDate وendDate
 *     في البيانات المنظمة) و`updatedAt` (lastmod في خريطة الموقع — تاريخ غير صالح
 *     هنا يُفسد XML كله).
 *  ④ البيانات الأساسية للمحتوى والحقول الإلزامية في SportsEvent ناقصة: اسمًا الفريقين،
 *     اسم البطولة، اسم الملعب، حالة البث.
 *
 * الحقول المحسّنة (keywords، `venue.countryCode`، روابط الفرق ومصادر الربط...) يبقى
 * اكتمالها مطلوبًا في التدقيق الصارم، لكن نقصها **لا يمنع فهرسة صفحة مباراة حقيقية**:
 * بناء البيانات المنظمة (`lib/seo/sports-event.ts`) يعاملها أصلًا كحقول اختيارية،
 * وإلا حوّل هذا البوابة — كما كان قبل 2026-10-19 — كل مباراة يدخلها المدير من
 * اللوحة إلى `noindex` غير مقصود رغم إعلانها في خريطة الموقع.
 */
export function isIndexableCatalogEntry(entry: MatchCatalogEntry): boolean {
  return indexabilityBlockers(entry).length === 0;
}

/** أسباب رفض الفهرسة فقط (فراغ = الصفحة مؤهلة). تُستخدم لتوثيق السبب عند الحاجة. */
function indexabilityBlockers(entry: MatchCatalogEntry): string[] {
  const blockers: string[] = [];
  if (entry.seo?.noindex === true) blockers.push('noindex مطلوب صراحة لهذه الصفحة.');
  if (!entry.id || !ID_PATTERN.test(entry.id) || entry.id.length > 120) {
    blockers.push('المعرّف غير صالح = لا رابط ثابت.');
  }
  if (!isValidIso(entry.kickoffUtc)) {
    blockers.push('kickoffUtc غير صالح (startDate في البيانات المنظمة).');
  } else if (!isValidDateParam(entry.cairoDate) || toCairoDateString(entry.kickoffUtc) !== entry.cairoDate) {
    blockers.push('cairoDate غير صالح أو لا يطابق kickoffUtc.');
  }
  if (!Number.isFinite(entry.durationMinutes) || entry.durationMinutes <= 0) {
    blockers.push('durationMinutes غير صالحة (endDate في البيانات المنظمة).');
  }
  for (const [side, team] of [
    ['homeTeam', entry.homeTeam],
    ['awayTeam', entry.awayTeam],
  ] as const) {
    if (!team?.nameAr?.trim() || !team?.nameEn?.trim()) blockers.push(`${side} بلا اسم عربي/إنجليزي.`);
  }
  if (!entry.competition?.nameAr?.trim()) blockers.push('competition.nameAr مفقود (organizer).');
  if (!entry.venue?.name?.trim()) blockers.push('venue.name مفقود (location).');
  if (!entry.broadcast?.status) blockers.push('broadcast.status مفقود.');
  if (!isValidIso(entry.updatedAt)) blockers.push('updatedAt غير صالح (lastmod في خريطة الموقع).');
  return blockers;
}
