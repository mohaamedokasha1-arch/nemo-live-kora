import { SOURCE_CAPABILITIES } from './capabilities';
import {
  isValidDateParam,
  normalizeMatchStatus,
  toCairoDateString,
  toCairoTimeArabic,
} from '../cairo-time';
import { mergeMatchRecords, VERIFIED_THESPORTSDB_EVENTS } from '../db/seed-data';
import { resolveTheSportsDBKickoff } from '../sources/thesportsdb';
import { buildMatchDedupKey, getStableMatchId } from '../match-identity';
import { resolveNemoSportsLink, VERIFIED_NEMO_MAPPING_TABLE } from '../nemo-resolver';
import { formatNewsTimestampLabel, toCairoDateStringOrNull } from './age-policy';
import { buildNewsSlug, collapseWhitespace, stableNewsHash } from './normalize';
import { validateNewsCandidate } from './validate';
import {
  GatewayDatabase,
  MatchRecord,
  NemoMappingEntry,
  NewsItemRecord,
  NewsPublishStatus,
  SourceDefinition,
  SourceId,
} from '../types';

const PUBLISH_STATUSES: NewsPublishStatus[] = [
  'pending',
  'published',
  'duplicate',
  'rejected',
  'stale',
  'source_error',
];

function asPublishStatus(value: unknown): NewsPublishStatus | null {
  return PUBLISH_STATUSES.includes(value as NewsPublishStatus)
    ? (value as NewsPublishStatus)
    : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function migrateNewsItem(raw: Partial<NewsItemRecord> | Record<string, unknown>): NewsItemRecord {
  const rawTitle = collapseWhitespace(asString(raw.title));
  const title = rawTitle || 'بدون عنوان';
  const link = asString(raw.link);
  const sourceId = (raw.sourceId as SourceId) || 'google-news-rss';
  const fetchedAt = asString(raw.fetchedAt, asString(raw.publishedAt) || new Date(0).toISOString());
  const rawPublishedAt = asNullableString(raw.publishedAt);
  const publishedAtIsValid = Boolean(
    rawPublishedAt && Number.isFinite(Date.parse(rawPublishedAt))
  );
  const publishedAtKnown =
    raw.publishedAtKnown === false ? false : publishedAtIsValid;
  const publishedAt = publishedAtKnown && publishedAtIsValid ? rawPublishedAt : null;
  const updatedAt = asNullableString(raw.updatedAt);
  const originalUrl = asNullableString(raw.originalUrl) || (link || null);
  const publisherName = collapseWhitespace(asString(raw.publisherName));
  const publisherUrl = asNullableString(raw.publisherUrl);
  const language = raw.language === 'en' ? 'en' : 'ar';
  const categoryAr = asString(raw.categoryAr, 'أخبار رياضية');
  const excerpt = asNullableString(raw.excerpt);
  const imageUrl = asNullableString(raw.imageUrl);
  const sourceItemId = asNullableString(raw.sourceItemId);
  const validation = validateNewsCandidate({
    sourceId,
    sourceItemId,
    title: rawTitle,
    link,
    originalUrl,
    publishedAt,
    publishedAtKnown,
    updatedAt,
    excerpt,
    imageUrl,
    publisherName,
    publisherUrl,
    language,
    categoryAr,
    fetchedAt,
  });
  const id =
    asString(raw.id) ||
    `news-${sourceId}-${stableNewsHash(`${sourceId}:${link || title}`)}`;
  let publishStatus: NewsPublishStatus = asPublishStatus(raw.publishStatus) || 'published';
  let rejectionReason = asNullableString(raw.rejectionReason);
  let rejectionReasonAr = asNullableString(raw.rejectionReasonAr);

  if (!validation.ok && (publishStatus === 'published' || publishStatus === 'pending')) {
    publishStatus = 'rejected';
    rejectionReason = rejectionReason || validation.code || 'invalid_content';
    rejectionReasonAr =
      rejectionReasonAr ||
      validation.messageAr ||
      'رفض: تعذّر التحقق من عنوان الخبر أو رابطه أو مصدره الأصلي.';
  }

  return {
    id,
    sourceItemId,
    sourceId,
    title,
    slug: asString(raw.slug) || buildNewsSlug(title, id.slice(-8)),
    link,
    originalUrl,
    publishedAt,
    publishedAtKnown: Boolean(publishedAt),
    updatedAt,
    fetchedAt,
    lastSyncedAt: asString(raw.lastSyncedAt, fetchedAt),
    cairoDate: toCairoDateStringOrNull(publishedAt),
    cairoTimeLabel: formatNewsTimestampLabel(publishedAt, Boolean(publishedAt)),
    excerpt,
    imageUrl,
    publisherName: publisherName || 'مصدر غير معروف',
    publisherUrl,
    language,
    categoryAr,
    publishStatus,
    rejectionReason,
    rejectionReasonAr,
    duplicateOfId: asNullableString(raw.duplicateOfId),
    relatedMatchIds: Array.isArray(raw.relatedMatchIds) ? raw.relatedMatchIds : [],
    relatedTeamIds: Array.isArray(raw.relatedTeamIds) ? raw.relatedTeamIds : [],
    relatedCompetitionCodes: Array.isArray(raw.relatedCompetitionCodes)
      ? raw.relatedCompetitionCodes
      : [],
    nemoRelatedUrl: asNullableString(raw.nemoRelatedUrl),
    nemoRelatedLabelAr: asNullableString(raw.nemoRelatedLabelAr),
  };
}

function migrateSourceDefinition(
  sourceId: SourceId,
  raw: Partial<SourceDefinition> | undefined
): Partial<SourceDefinition> {
  const caps = SOURCE_CAPABILITIES[sourceId];
  return {
    providesMatches: raw?.providesMatches ?? caps.providesMatches,
    providesStandings: raw?.providesStandings ?? caps.providesStandings,
    providesNews: raw?.providesNews ?? caps.providesNews,
    lastSuccessfulNewsSyncAt: raw?.lastSuccessfulNewsSyncAt ?? null,
    newsImportedCount: raw?.newsImportedCount ?? 0,
    newsPublishedCount: raw?.newsPublishedCount ?? 0,
  };
}

function hasSameTrustedSourceIdentity(
  left: Pick<NemoMappingEntry, 'competitionCode' | 'homeTeamId' | 'awayTeamId' | 'sportscoreTrackerId' | 'thesportsdbEventId' | 'apiFootballFixtureId'>,
  right: Pick<NemoMappingEntry, 'competitionCode' | 'homeTeamId' | 'awayTeamId' | 'sportscoreTrackerId' | 'thesportsdbEventId' | 'apiFootballFixtureId'>
): boolean {
  const contextMatches =
    left.competitionCode === right.competitionCode &&
    left.homeTeamId === right.homeTeamId &&
    left.awayTeamId === right.awayTeamId;
  if (!contextMatches) return false;

  return Boolean(
    (left.sportscoreTrackerId && left.sportscoreTrackerId === right.sportscoreTrackerId) ||
      (left.thesportsdbEventId && left.thesportsdbEventId === right.thesportsdbEventId) ||
      (left.apiFootballFixtureId && left.apiFootballFixtureId === right.apiFootballFixtureId)
  );
}

/**
 * Old snapshots predate `kickoffConfirmed`. Recover certainty only when the legacy source is
 * known to have supplied an explicit time and that time still matches its captured record;
 * otherwise the stored UTC timestamp may be only a fallback/day anchor.
 */
function inferLegacyKickoffConfirmation(match: MatchRecord): boolean {
  if (typeof match.kickoffConfirmed === 'boolean') return match.kickoffConfirmed;
  const storedMs = Date.parse(match.utcKickoff);
  if (!Number.isFinite(storedMs)) return false;

  if (['sportscore', 'football-data', 'api-football'].includes(match.primarySource)) {
    return true;
  }

  if (match.primarySource === 'thesportsdb' && match.externalIds?.thesportsdbEventId) {
    const raw = VERIFIED_THESPORTSDB_EVENTS.find(
      (event) => event.idEvent === match.externalIds.thesportsdbEventId
    );
    const resolved = raw ? resolveTheSportsDBKickoff(raw) : null;
    return Boolean(
      resolved?.confirmed && resolved.utcIso === new Date(storedMs).toISOString()
    );
  }

  return false;
}

function migrateMatches(matches: MatchRecord[]): {
  matches: MatchRecord[];
  oldToNewId: Map<string, string>;
} {
  const byId = new Map<string, MatchRecord>();
  const idByDedupKey = new Map<string, string>();
  const oldToNewId = new Map<string, string>();

  /**
   * ═══ احترام التوحيد المُثبت عند قراءة اللقطة ═══
   *
   * بعد توحيد مباراة واحدة جاءت من مصدرين، يحمل السجل الأساسي معرّفات المصدرين معًا
   * (مطلوب: لا يُفقد معرّف أي مصدر)، ومنها معرّف المزوّد الذي يشتق منه `getStableMatchId`
   * معرّفًا جديدًا — وهو المعرّف نفسه الذي يحمله السجل المُعلَّم كتكرار. إعادة الاشتقاق هنا
   * كانت تُسقط أحد السجلين أو تخلط معرّفيهما. لذلك:
   *   • سجل مُعلَّم كتكرار (`duplicateOfId`) يبقى **بمعرّفه وبياناته كما هي** بلا إعادة اشتقاق،
   *     فيظل رابط صفحته صالحًا للتحويل إلى السجل الأساسي.
   *   • سجل أساسي في عملية توحيد (يشير إليه سجل آخر) يبقى **بمعرّفه** كذلك، فلا يتغيّر
   *     الرابط المعروض على الموقع بعد كل قراءة لقطة.
   */
  const consolidationSurvivorIds = new Set(
    matches.map((match) => match.duplicateOfId).filter((id): id is string => Boolean(id))
  );

  for (const original of matches) {
    if (original.duplicateOfId) {
      byId.set(original.id, original);
      oldToNewId.set(original.id, original.duplicateOfId);
      continue;
    }
    const externalIds = original.externalIds || {};
    const derivedId = getStableMatchId({
      externalIds,
      competitionCode: original.competitionCode,
      homeTeamId: original.homeTeam.id,
      awayTeamId: original.awayTeam.id,
      cairoDate: original.cairoDate,
      fallbackId: original.id,
    });
    const kickoffConfirmed = inferLegacyKickoffConfirmation(original);
    const hasValidKickoff = Number.isFinite(Date.parse(original.utcKickoff));
    const normalizedStatus = normalizeMatchStatus(
      original.status,
      original.statusLabelAr,
      kickoffConfirmed ? original.utcKickoff : undefined
    );
    const statusNeedsConfirmedKickoff =
      !kickoffConfirmed &&
      (normalizedStatus.status === 'live' || normalizedStatus.status === 'not_started');
    const safeStatus = statusNeedsConfirmedKickoff
      ? {
          status: 'unconfirmed' as const,
          statusLabelAr: 'الموعد غير مؤكد من المصدر',
          statusNoteAr: 'تُحدَّث حالة المباراة تلقائيًا من المصدر.',
        }
      : normalizedStatus;
    const cairoDate = hasValidKickoff
      ? toCairoDateString(original.utcKickoff)
      : isValidDateParam(original.cairoDate)
      ? original.cairoDate
      : '';
    const cairoTime = kickoffConfirmed && hasValidKickoff
      ? toCairoTimeArabic(original.utcKickoff)
      : 'الموعد غير مؤكد';
    // سجل أساسي لعملية توحيد: يبقى بمعرّفه المعروض (روابط ثابتة)، وإلا يُشتق المعرّف كالمعتاد.
    const id = consolidationSurvivorIds.has(original.id) ? original.id : derivedId;
    const match: MatchRecord = {
      ...original,
      id,
      cairoDate,
      cairoTime,
      kickoffConfirmed,
      status: safeStatus.status,
      statusLabelAr: safeStatus.statusLabelAr,
      statusNoteAr: safeStatus.statusNoteAr,
      nemoLink: resolveNemoSportsLink({
        canonicalMatchId: id,
        sportscoreSlug: externalIds.sportscoreSlug,
        sportscoreTrackerId: externalIds.sportscoreTrackerId,
        thesportsdbEventId: externalIds.thesportsdbEventId,
        apiFootballFixtureId: externalIds.apiFootballFixtureId,
        competitionCode: original.competitionCode,
        homeTeamId: original.homeTeam.id,
        awayTeamId: original.awayTeam.id,
        cairoDate,
      }),
    };

    const dedupKey = buildMatchDedupKey(match);
    const targetId = byId.has(id) ? id : idByDedupKey.get(dedupKey) || id;
    oldToNewId.set(original.id, targetId);
    const existing = byId.get(targetId);
    byId.set(targetId, existing ? { ...mergeMatchRecords(existing, { ...match, id: targetId }), id: targetId } : match);
    idByDedupKey.set(dedupKey, targetId);
  }

  return {
    matches: Array.from(byId.values()).sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return Date.parse(a.utcKickoff) - Date.parse(b.utcKickoff);
    }),
    oldToNewId,
  };
}

function migrateMappingTable(stored: NemoMappingEntry[] | undefined): NemoMappingEntry[] {
  const mappings = new Map<string, NemoMappingEntry>();

  for (const mapping of stored || []) {
    const current = VERIFIED_NEMO_MAPPING_TABLE.find((entry) =>
      hasSameTrustedSourceIdentity(entry, mapping)
    );
    if (current) {
      mappings.set(current.canonicalMatchId, current);
    } else {
      // Preserve the old mapping record for audit/history, but remove destinations that
      // have not been re-verified as an exact match page.
      mappings.set(mapping.canonicalMatchId, {
        ...mapping,
        verifiedNemoMatchSlug: null,
        verifiedNemoCompetitionSlug: null,
        verificationNoteAr:
          'المسار القديم محفوظ كسجل، لكن لا توجد وجهة مباراة مباشرة أُعيد التحقق منها؛ لا يُستخدم بديل عام.',
      });
    }
  }

  for (const mapping of VERIFIED_NEMO_MAPPING_TABLE) {
    mappings.set(mapping.canonicalMatchId, mapping);
  }

  return Array.from(mappings.values());
}

export function migrateGatewayDatabase(db: GatewayDatabase): GatewayDatabase {
  const sources = { ...db.sources };
  (Object.keys(sources) as SourceId[]).forEach((sourceId) => {
    sources[sourceId] = {
      ...sources[sourceId],
      ...migrateSourceDefinition(sourceId, sources[sourceId]),
    };
  });

  const migratedMatches = migrateMatches(Array.isArray(db.matches) ? db.matches : []);
  const news = Array.isArray(db.news)
    ? db.news.map((rawItem) => {
        const item = migrateNewsItem(rawItem);
        const relatedMatchIds = item.relatedMatchIds.map(
          (matchId) => migratedMatches.oldToNewId.get(matchId) || matchId
        );
        // Old generic /watch links were not match-specific. Do not carry them into public news;
        // new related-match references remain plain text until an exact page is verified.
        return {
          ...item,
          relatedMatchIds,
          nemoRelatedUrl: null,
          nemoRelatedLabelAr: null,
        };
      })
    : [];

  return {
    ...db,
    meta: {
      ...db.meta,
      schemaVersion: '1.3.0',
      lastNewsSyncAt: db.meta.lastNewsSyncAt ?? null,
      lastSuccessfulNewsSyncAt: db.meta.lastSuccessfulNewsSyncAt ?? null,
    },
    sources,
    matches: migratedMatches.matches,
    news,
    nemoMappingTable: migrateMappingTable(db.nemoMappingTable),
    newsSourceSyncs: Array.isArray(db.newsSourceSyncs) ? db.newsSourceSyncs : [],
    newsImportErrors: Array.isArray(db.newsImportErrors) ? db.newsImportErrors : [],
    newsDedupRecords: Array.isArray(db.newsDedupRecords) ? db.newsDedupRecords : [],
  };
}
