import { SOURCE_CAPABILITIES } from './capabilities';
import { formatNewsTimestampLabel, toCairoDateStringOrNull } from './age-policy';
import { buildNewsSlug, collapseWhitespace, stableNewsHash } from './normalize';
import { isLikelyArticleUrl } from './validate';
import {
  GatewayDatabase,
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
  const title = collapseWhitespace(asString(raw.title, 'بدون عنوان'));
  const link = asString(raw.link);
  const sourceId = (raw.sourceId as SourceId) || 'google-news-rss';
  const fetchedAt = asString(raw.fetchedAt, asString(raw.publishedAt) || new Date(0).toISOString());
  const publishedAtKnown =
    typeof raw.publishedAtKnown === 'boolean'
      ? raw.publishedAtKnown
      : Boolean(raw.publishedAt);
  const publishedAt = publishedAtKnown ? asNullableString(raw.publishedAt) : null;
  const id =
    asString(raw.id) ||
    `news-${sourceId}-${stableNewsHash(`${sourceId}:${link || title}`)}`;
  const originalUrl = asNullableString(raw.originalUrl) || (link || null);
  const validUrl = originalUrl ? isLikelyArticleUrl(originalUrl) : false;
  let publishStatus: NewsPublishStatus = asPublishStatus((raw as NewsItemRecord).publishStatus) || 'published';
  let rejectionReason = asNullableString(raw.rejectionReason);
  let rejectionReasonAr = asNullableString(raw.rejectionReasonAr);

  if (!validUrl) {
    publishStatus = 'rejected';
    rejectionReason = rejectionReason || 'invalid_url';
    rejectionReasonAr =
      rejectionReasonAr || 'رفض: الرابط غير صالح أو يشير إلى صفحة بحث وليس إلى خبر.';
  }

  return {
    id,
    sourceItemId: asNullableString(raw.sourceItemId),
    sourceId,
    title,
    slug: asString(raw.slug) || buildNewsSlug(title, id.slice(-8)),
    link,
    originalUrl,
    publishedAt,
    publishedAtKnown: Boolean(publishedAt),
    updatedAt: asNullableString(raw.updatedAt),
    fetchedAt,
    lastSyncedAt: asString(raw.lastSyncedAt, fetchedAt),
    cairoDate: toCairoDateStringOrNull(publishedAt),
    cairoTimeLabel: formatNewsTimestampLabel(publishedAt, Boolean(publishedAt)),
    excerpt: asNullableString(raw.excerpt),
    imageUrl: asNullableString(raw.imageUrl),
    publisherName: collapseWhitespace(asString(raw.publisherName, 'مصدر غير معروف')),
    publisherUrl: asNullableString(raw.publisherUrl),
    language: raw.language === 'en' ? 'en' : 'ar',
    categoryAr: asString(raw.categoryAr, 'أخبار رياضية'),
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

export function migrateGatewayDatabase(db: GatewayDatabase): GatewayDatabase {
  const sources = { ...db.sources };
  (Object.keys(sources) as SourceId[]).forEach((sourceId) => {
    sources[sourceId] = {
      ...sources[sourceId],
      ...migrateSourceDefinition(sourceId, sources[sourceId]),
    };
  });

  return {
    ...db,
    meta: {
      ...db.meta,
      schemaVersion: db.meta.schemaVersion || '1.1.0',
      lastNewsSyncAt: db.meta.lastNewsSyncAt ?? null,
      lastSuccessfulNewsSyncAt: db.meta.lastSuccessfulNewsSyncAt ?? null,
    },
    sources,
    news: Array.isArray(db.news) ? db.news.map((item) => migrateNewsItem(item)) : [],
    newsSourceSyncs: Array.isArray(db.newsSourceSyncs) ? db.newsSourceSyncs : [],
    newsImportErrors: Array.isArray(db.newsImportErrors) ? db.newsImportErrors : [],
    newsDedupRecords: Array.isArray(db.newsDedupRecords) ? db.newsDedupRecords : [],
  };
}
