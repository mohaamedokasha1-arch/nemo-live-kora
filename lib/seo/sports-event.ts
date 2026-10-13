import { buildMatchLandingPath } from '../matches/match-links';
import type { ResolvedMatchView } from '../matches/types';
import type { MatchStatusCode } from '../types';
import { GATEWAY_SITE_URL } from '../site-url';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SportsEvent JSON-LD — المُولّد الرسمي الكامل الحقول
 * ═══════════════════════════════════════════════════════════════════════════════
 *  المخرجات مُصمَّمة لإغلاق أخطاء Google Search Console الخاصة بالمباريات:
 *   location         → Place باسم الاستاد + PostalAddress، و/أو VirtualLocation للبث أونلاين
 *   description      → وصف ديناميكي فريد مبني على بيانات المباراة نفسها
 *   performer        → الفريق المستضيف والفريق الضيف (SportsTeam) + competitor بنفس الكيانين
 *   organizer        → البطولة/الرابطة (SportsOrganization) مع رابطها الرسمي
 *   startDate/endDate→ ISO 8601 مع إزاحة توقيت القاهرة الفعلية (+02:00 / +03:00)
 *   offers           → كائن Offer برابط المشاهدة وسعر "0" و InStock و validFrom
 *   eventStatus      → حالة المباراة مترجمة إلى قيم Schema.org المعتمدة
 *
 *  ⚠️ ملاحظة فنية مهمة: `EventLive` **ليست** قيمة معتمدة في Schema.org. القيم المعتمدة هي:
 *  EventScheduled، EventCancelled، EventMovedOnline، EventPostponed، EventRescheduled.
 *  استخدام EventLive يُنتج خطأ «Invalid enum value» في Search Console، لذلك تُترجم
 *  المباراة الجارية إلى EventScheduled (التمثيل الصحيح: المباراة تُقام كما هو مخطط)
 *  مع إظهار «جارية الآن» في النص الظاهر، وفي خريطة الموقع، وفي بطاقة المباراة.
 *  وللتحكم اليدوي الكامل استخدم `schema.eventStatusOverride` في `data/matches.ts`.
 *
 *  كما أن الحقول تُقتصر على ما يقبله Google لحدث من نوع SportsEvent
 *  (لا keywords ولا dateModified ولا result — فهي ليست خصائص صالحة لكائن Event).
 */

export const SCHEMA_SITE_NAME = 'نيمو كورة لايف — NEMO Sports';
export const SCHEMA_SITE_URL = GATEWAY_SITE_URL;
/** العملة الافتراضية لكائن العرض عندما تكون المباراة مجانية. */
export const DEFAULT_OFFER_CURRENCY = 'EGP';

/** القيم المعتمدة في Schema.org لخاصية eventStatus. */
export const VALID_EVENT_STATUSES = [
  'EventScheduled',
  'EventCancelled',
  'EventMovedOnline',
  'EventPostponed',
  'EventRescheduled',
] as const;

/**
 * ترجمة حالة المباراة إلى `eventStatus` صالح في Schema.org.
 * ملاحظة Google الصريحة: لا تُحذف startDate أو location أبدًا عند تغيّر الحالة.
 */
export function toSchemaEventStatus(status: MatchStatusCode, override?: string | null): string {
  if (override) {
    const normalized = override.replace('https://schema.org/', '').trim();
    if ((VALID_EVENT_STATUSES as readonly string[]).includes(normalized)) {
      return `https://schema.org/${normalized}`;
    }
  }

  switch (status) {
    case 'postponed':
      return 'https://schema.org/EventPostponed';
    case 'cancelled':
      return 'https://schema.org/EventCancelled';
    case 'not_started':
    case 'live':
    case 'finished':
    case 'suspended':
    case 'unconfirmed':
    default:
      return 'https://schema.org/EventScheduled';
  }
}

function buildEventName(view: ResolvedMatchView): string {
  const { homeTeam, awayTeam, competition } = view.entry;
  return `${homeTeam.nameAr} ضد ${awayTeam.nameAr} — ${competition.nameAr}`;
}

function buildAlternateName(view: ResolvedMatchView): string {
  const { homeTeam, awayTeam } = view.entry;
  return `${homeTeam.nameEn} vs ${awayTeam.nameEn}`;
}

/**
 * وصف ديناميكي فريد لكل مباراة (يُستخدم في البيانات المنظمة وفي وصف الصفحة).
 * Google ترفض الأوصاف المكررة أو المقتضبة، لذلك يتغيّر الوصف بتغيّر الفرق والموعد والملعب والحالة.
 */
export function buildMatchDescription(view: ResolvedMatchView): string {
  const { homeTeam, awayTeam, competition } = view.entry;
  const roundText = competition.roundLabelAr ? ` (${competition.roundLabelAr})` : '';
  const venueText = view.venueName ? `، على ${view.venueName}` : '';
  const statusText = view.isLive
    ? `المباراة جارية الآن${view.liveMinute ? ` في الدقيقة ${view.liveMinute}` : ''}`
    : view.isFinished
    ? 'المباراة منتهية وتُعرض النتيجة النهائية'
    : `حالة المباراة: ${view.statusLabelAr}`;

  return (
    `مباراة ${homeTeam.nameAr} ضد ${awayTeam.nameAr} في ${competition.nameAr}${roundText}، ` +
    `موعد الانطلاق ${view.cairoDateLabelAr} الساعة ${view.kickoffTimeAr} بتوقيت القاهرة${venueText}. ` +
    `${statusText}. تفاصيل كاملة عن الفريقين والملعب والقناة ورابط مشاهدة التغطية المباشرة على نيمو كورة لايف.`
  );
}

/** عقدة SportsTeam (تُستخدم في performer و competitor). */
function buildTeamNode(view: ResolvedMatchView, side: 'home' | 'away'): Record<string, unknown> {
  const team = side === 'home' ? view.entry.homeTeam : view.entry.awayTeam;
  const node: Record<string, unknown> = {
    '@type': 'SportsTeam',
    '@id': `${view.canonicalUrl}#${side}-team`,
    name: team.nameAr,
    alternateName: team.nameEn,
    sport: 'Association football',
    url: team.teamPageUrl || view.canonicalUrl,
  };
  if (team.logoUrl) node.logo = team.logoUrl;
  if (team.countryAr) node.location = { '@type': 'Country', name: team.countryAr };
  return node;
}

/**
 * location: كائن Place باسم الاستاد (للمباريات الحضورية)،
 * أو VirtualLocation (للبث عبر الإنترنت)، أو مصفوفة الاثنين (حضوري + أونلاين).
 */
function buildLocation(
  view: ResolvedMatchView
): Record<string, unknown> | Array<Record<string, unknown>> {
  const { venue, broadcast } = view.entry;
  const kind = venue.kind ?? 'stadium';
  const onlineUrl = view.verifiedBroadcastUrl || view.liveUrl;

  const place: Record<string, unknown> = {
    '@type': 'Place',
    '@id': `${view.canonicalUrl}#venue`,
    name: view.venueName,
  };
  const address: Record<string, unknown> = { '@type': 'PostalAddress' };
  if (venue.streetAddress) address.streetAddress = venue.streetAddress;
  if (venue.cityAr || venue.cityEn) address.addressLocality = venue.cityAr || venue.cityEn;
  if (venue.countryCode) address.addressCountry = venue.countryCode;
  if (Object.keys(address).length > 1) place.address = address;

  const virtual: Record<string, unknown> = {
    '@type': 'VirtualLocation',
    '@id': `${view.canonicalUrl}#online-coverage`,
    name: venue.onlineLabelAr || broadcast.labelAr || 'بث وتغطية مباشرة عبر الإنترنت',
    url: onlineUrl,
  };

  if (kind === 'online') return virtual;
  if (kind === 'hybrid') return [place, virtual];
  return place;
}

function buildAttendanceMode(view: ResolvedMatchView): string {
  const kind = view.entry.venue.kind ?? 'stadium';
  if (kind === 'online') return 'https://schema.org/OnlineEventAttendanceMode';
  if (kind === 'hybrid') return 'https://schema.org/MixedEventAttendanceMode';
  return 'https://schema.org/OfflineEventAttendanceMode';
}

/** offers: رابط المشاهدة + سعر "0" + عملة + توفّر InStock + validFrom. */
function buildOffersNode(view: ResolvedMatchView, startIso: string): Record<string, unknown> {
  const { broadcast } = view.entry;
  const isFree = broadcast.isFree !== false;
  const numericPrice =
    broadcast.price && /^\d+(\.\d+)?$/.test(broadcast.price)
      ? broadcast.price
      : isFree
      ? '0'
      : '0';

  const validFrom =
    broadcast.availableFromUtc && Number.isFinite(new Date(broadcast.availableFromUtc).getTime())
      ? broadcast.availableFromUtc
      : startIso;

  return {
    '@type': 'Offer',
    '@id': `${view.canonicalUrl}#offer`,
    url: view.verifiedBroadcastUrl || view.liveUrl,
    name: broadcast.labelAr || 'مشاهدة المباراة',
    price: numericPrice,
    priceCurrency: broadcast.priceCurrency ?? DEFAULT_OFFER_CURRENCY,
    availability: 'https://schema.org/InStock',
    validFrom,
    seller: {
      '@type': 'Organization',
      name: broadcast.providerNameAr || SCHEMA_SITE_NAME,
      url: SCHEMA_SITE_URL,
    },
  };
}

function buildOrganizerNode(view: ResolvedMatchView): Record<string, unknown> {
  const { competition } = view.entry;
  const node: Record<string, unknown> = {
    '@type': 'SportsOrganization',
    '@id': `${view.canonicalUrl}#organizer`,
    name: competition.nameAr,
    alternateName: competition.nameEn,
  };
  if (competition.competitionPageUrl) node.url = competition.competitionPageUrl;
  if (competition.countryAr) node.location = { '@type': 'Country', name: competition.countryAr };
  return node;
}

/** قائمة الصور: صورة المباراة الخاصة أولًا ثم شعارا الفريقين. */
function buildImageList(view: ResolvedMatchView): string[] {
  const images: string[] = [];
  if (view.entry.seo?.imageUrl) images.push(view.entry.seo.imageUrl);
  for (const team of [view.entry.homeTeam, view.entry.awayTeam]) {
    if (team.logoUrl && !images.includes(team.logoUrl)) images.push(team.logoUrl);
  }
  return images;
}

/** بناء عقدة SportsEvent كاملة الحقول لمباراة واحدة. */
export function buildSportsEventNode(
  view: ResolvedMatchView,
  options: { startIso: string; endIso: string }
): Record<string, unknown> {
  const { entry } = view;
  const homeNode = buildTeamNode(view, 'home');
  const awayNode = buildTeamNode(view, 'away');

  const node: Record<string, unknown> = {
    '@type': 'SportsEvent',
    '@id': `${view.canonicalUrl}#event`,
    name: buildEventName(view),
    alternateName: buildAlternateName(view),
    description: entry.seo?.description?.trim() || buildMatchDescription(view),
    url: view.canonicalUrl,
    sport: 'Association football',
    inLanguage: 'ar',
    startDate: options.startIso,
    endDate: options.endIso,
    eventStatus: toSchemaEventStatus(view.status, entry.schema?.eventStatusOverride),
    eventAttendanceMode: buildAttendanceMode(view),
    location: buildLocation(view),
    performer: [homeNode, awayNode],
    competitor: [homeNode, awayNode],
    organizer: buildOrganizerNode(view),
    offers: buildOffersNode(view, options.startIso),
    isAccessibleForFree: entry.broadcast.isFree !== false,
    about: [
      homeNode,
      awayNode,
      { '@type': 'SportsOrganization', name: entry.competition.nameAr },
    ],
  };

  if (entry.competition.seasonLabel) {
    node.superEvent = {
      '@type': 'SportsEvent',
      '@id': `${view.canonicalUrl}#competition-season`,
      name: `${entry.competition.nameAr} ${entry.competition.seasonLabel}`,
      url: entry.competition.competitionPageUrl || view.canonicalUrl,
    };
  }

  const images = buildImageList(view);
  if (images.length > 0) node.image = images;

  if (
    entry.schema?.previousStartDateUtc &&
    Number.isFinite(new Date(entry.schema.previousStartDateUtc).getTime())
  ) {
    node.previousStartDate = entry.schema.previousStartDateUtc;
  }

  return node;
}

/** BreadcrumbList لمباراة (يساعد Google على فهم موضع الصفحة داخل الهيكل). */
export function buildMatchBreadcrumbNode(view: ResolvedMatchView): Record<string, unknown> {
  const items: Array<Record<string, unknown>> = [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'الرئيسية — جدول مباريات اليوم',
      item: `${SCHEMA_SITE_URL}/`,
    },
  ];

  const datePath = buildMatchLandingPath(view.entry.cairoDate);
  if (datePath !== view.canonicalPath) {
    items.push({
      '@type': 'ListItem',
      position: items.length + 1,
      name: `مباريات ${view.cairoDateLabelAr}`,
      item: `${SCHEMA_SITE_URL}${datePath}`,
    });
  }

  items.push({
    '@type': 'ListItem',
    position: items.length + 1,
    name: `${view.entry.homeTeam.nameAr} ضد ${view.entry.awayTeam.nameAr}`,
    item: view.canonicalUrl,
  });

  return {
    '@type': 'BreadcrumbList',
    '@id': `${view.canonicalUrl}#breadcrumb`,
    itemListElement: items,
  };
}

/** الرسم الكامل لصفحة الهبوط: SportsEvent + BreadcrumbList داخل كائن @graph واحد. */
export function buildMatchLandingJsonLd(
  view: ResolvedMatchView,
  options: { startIso: string; endIso: string }
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': [buildSportsEventNode(view, options), buildMatchBreadcrumbNode(view)],
  };
}
