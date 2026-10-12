import {
  NewsDedupRecord,
  NewsImportErrorRecord,
  NewsItemRecord,
  NewsPublishStatus,
  RawNewsCandidate,
} from '../types';
import {
  formatNewsTimestampLabel,
  toCairoDateStringOrNull,
} from './age-policy';
import { linkNewsToMatches, NewsMatchContext } from './match-linker';
import {
  buildNewsSlug,
  collapseWhitespace,
  normalizeNewsTitle,
  normalizeNewsUrl,
  stableNewsHash,
  titleTokenOverlap,
} from './normalize';
import { validateNewsCandidate } from './validate';

const SAME_PUBLISHER_SIMILARITY = 0.82;
const MAX_PUBLISHED = 160;
const MAX_REJECTED = 80;
const MAX_DUPLICATE = 80;

export interface NewsBatchStats {
  fetched: number;
  imported: number;
  published: number;
  duplicates: number;
  rejected: number;
  updated: number;
}

export interface NewsBatchResult {
  news: NewsItemRecord[];
  stats: NewsBatchStats;
  errors: NewsImportErrorRecord[];
  dedupRecords: NewsDedupRecord[];
}

function identityKey(candidate: Pick<RawNewsCandidate, 'sourceId' | 'sourceItemId' | 'link' | 'originalUrl'>): string {
  if (candidate.sourceItemId) {
    return `${candidate.sourceId}::id::${candidate.sourceItemId}`;
  }
  const url = normalizeNewsUrl(candidate.originalUrl || candidate.link) || candidate.link;
  return `${candidate.sourceId}::url::${url}`;
}

function findExistingItem(
  existing: NewsItemRecord[],
  candidate: RawNewsCandidate
): NewsItemRecord | undefined {
  const incomingKey = identityKey(candidate);
  const incomingUrl = normalizeNewsUrl(candidate.originalUrl || candidate.link);
  return existing.find((item) => {
    if (identityKey(item) === incomingKey) return true;
    if (incomingUrl && normalizeNewsUrl(item.originalUrl || item.link) === incomingUrl) {
      return true;
    }
    return false;
  });
}

function findDuplicate(
  existing: NewsItemRecord[],
  candidate: RawNewsCandidate
): { item: NewsItemRecord; matchedBy: string[] } | null {
  const incomingTitle = normalizeNewsTitle(candidate.title);
  for (const item of existing) {
    if (item.publishStatus === 'rejected' || item.publishStatus === 'source_error') continue;
    const matchedBy: string[] = [];
    const overlap = titleTokenOverlap(candidate.title, item.title);
    const samePublisher =
      collapseWhitespace(candidate.publisherName).toLowerCase() ===
      collapseWhitespace(item.publisherName).toLowerCase();
    if (incomingTitle && incomingTitle === normalizeNewsTitle(item.title) && samePublisher) {
      matchedBy.push('normalized_title');
    }
    if (samePublisher && overlap >= SAME_PUBLISHER_SIMILARITY) {
      matchedBy.push('similar_title_same_publisher');
    }
    if (matchedBy.length > 0) {
      return { item, matchedBy };
    }
  }
  return null;
}

function buildId(candidate: RawNewsCandidate): string {
  const basis = candidate.sourceItemId
    ? `${candidate.sourceId}:${candidate.sourceItemId}`
    : `${candidate.sourceId}:${normalizeNewsUrl(candidate.originalUrl || candidate.link) || candidate.title}`;
  return `news-${candidate.sourceId}-${stableNewsHash(basis)}`;
}

function toPublishedItem(
  candidate: RawNewsCandidate,
  existing: NewsItemRecord | undefined,
  context: NewsMatchContext,
  nowIso: string
): NewsItemRecord {
  const id = existing?.id || buildId(candidate);
  const idTail = id.slice(-8);
  const publishedAt = candidate.publishedAtKnown ? candidate.publishedAt : existing?.publishedAt || null;
  const publishedAtKnown = Boolean(publishedAt);
  const links = linkNewsToMatches(candidate.title, publishedAt, context);
  return {
    id,
    sourceItemId: candidate.sourceItemId || existing?.sourceItemId || null,
    sourceId: candidate.sourceId,
    title: collapseWhitespace(candidate.title),
    slug: existing?.slug || buildNewsSlug(candidate.title, idTail),
    link: candidate.link,
    originalUrl: candidate.originalUrl || candidate.link,
    publishedAt,
    publishedAtKnown,
    updatedAt: candidate.updatedAt || existing?.updatedAt || null,
    fetchedAt: existing?.fetchedAt || candidate.fetchedAt || nowIso,
    lastSyncedAt: nowIso,
    cairoDate: toCairoDateStringOrNull(publishedAt),
    cairoTimeLabel: formatNewsTimestampLabel(publishedAt, publishedAtKnown),
    excerpt: candidate.excerpt || existing?.excerpt || null,
    imageUrl: candidate.imageUrl || existing?.imageUrl || null,
    publisherName: collapseWhitespace(candidate.publisherName),
    publisherUrl: candidate.publisherUrl || existing?.publisherUrl || null,
    language: candidate.language,
    categoryAr: candidate.categoryAr,
    publishStatus: 'published',
    rejectionReason: null,
    rejectionReasonAr: null,
    duplicateOfId: null,
    ...links,
  };
}

function toRejectedItem(
  candidate: RawNewsCandidate,
  code: string,
  messageAr: string,
  nowIso: string
): NewsItemRecord {
  const id = buildId(candidate);
  return {
    id,
    sourceItemId: candidate.sourceItemId,
    sourceId: candidate.sourceId,
    title: collapseWhitespace(candidate.title || 'بدون عنوان'),
    slug: buildNewsSlug(candidate.title || 'rejected', id.slice(-8)),
    link: candidate.link,
    originalUrl: candidate.originalUrl,
    publishedAt: candidate.publishedAtKnown ? candidate.publishedAt : null,
    publishedAtKnown: candidate.publishedAtKnown,
    updatedAt: candidate.updatedAt,
    fetchedAt: candidate.fetchedAt || nowIso,
    lastSyncedAt: nowIso,
    cairoDate: toCairoDateStringOrNull(candidate.publishedAt),
    cairoTimeLabel: formatNewsTimestampLabel(
      candidate.publishedAt,
      candidate.publishedAtKnown
    ),
    excerpt: candidate.excerpt,
    imageUrl: candidate.imageUrl,
    publisherName: collapseWhitespace(candidate.publisherName || 'مصدر غير معروف'),
    publisherUrl: candidate.publisherUrl,
    language: candidate.language,
    categoryAr: candidate.categoryAr,
    publishStatus: 'rejected',
    rejectionReason: code,
    rejectionReasonAr: messageAr,
    duplicateOfId: null,
    relatedMatchIds: [],
    relatedTeamIds: [],
    relatedCompetitionCodes: [],
    nemoRelatedUrl: null,
    nemoRelatedLabelAr: null,
  };
}

function capNews(news: NewsItemRecord[]): NewsItemRecord[] {
  const published: NewsItemRecord[] = [];
  const duplicates: NewsItemRecord[] = [];
  const rejected: NewsItemRecord[] = [];
  for (const item of news) {
    if (item.publishStatus === 'published' || item.publishStatus === 'pending' || item.publishStatus === 'stale') {
      published.push(item);
    } else if (item.publishStatus === 'duplicate') {
      duplicates.push(item);
    } else {
      rejected.push(item);
    }
  }
  return [
    ...published.slice(0, MAX_PUBLISHED),
    ...duplicates.slice(0, MAX_DUPLICATE),
    ...rejected.slice(0, MAX_REJECTED),
  ];
}

export function processNewsBatch(
  existing: NewsItemRecord[],
  incoming: RawNewsCandidate[],
  context: NewsMatchContext,
  now: Date = new Date()
): NewsBatchResult {
  const nowIso = now.toISOString();
  const byId = new Map<string, NewsItemRecord>();
  for (const item of existing) {
    byId.set(item.id, item);
  }

  const errors: NewsImportErrorRecord[] = [];
  const dedupRecords: NewsDedupRecord[] = [];
  let imported = 0;
  let published = 0;
  let duplicates = 0;
  let rejected = 0;
  let updated = 0;

  for (const candidate of incoming) {
    const validation = validateNewsCandidate(candidate);
    if (!validation.ok) {
      const rejectedItem = toRejectedItem(
        candidate,
        validation.code || 'rejected',
        validation.messageAr || 'رفض الخبر.',
        nowIso
      );
      const existingSame = findExistingItem(Array.from(byId.values()), candidate);
      if (!existingSame) {
        byId.set(rejectedItem.id, rejectedItem);
      }
      rejected += 1;
      errors.push({
        id: `news-err-${stableNewsHash(`${rejectedItem.id}:${validation.code}`)}`,
        sourceId: candidate.sourceId,
        timestamp: nowIso,
        errorCode: validation.code || 'rejected',
        message: validation.code || 'rejected',
        messageAr: validation.messageAr || 'رفض الخبر.',
        title: candidate.title,
        url: candidate.link,
      });
      continue;
    }

    const existingSame = findExistingItem(Array.from(byId.values()), candidate);
    if (existingSame) {
      const merged = toPublishedItem(candidate, existingSame, context, nowIso);
      byId.set(existingSame.id, merged);
      updated += 1;
      imported += 1;
      if (merged.publishStatus === 'published') published += 1;
      continue;
    }

    const duplicate = findDuplicate(
      Array.from(byId.values()).filter((item) => item.publishStatus === 'published'),
      candidate
    );
    if (duplicate) {
      const duplicateItem: NewsItemRecord = {
        ...toPublishedItem(candidate, undefined, context, nowIso),
        publishStatus: 'duplicate',
        rejectionReason: duplicate.matchedBy.join(','),
        rejectionReasonAr: `نسخة مكررة وفق: ${duplicate.matchedBy.join('، ')}`,
        duplicateOfId: duplicate.item.id,
      };
      byId.set(duplicateItem.id, duplicateItem);
      duplicates += 1;
      imported += 1;
      dedupRecords.push({
        id: `dedup-${stableNewsHash(`${duplicateItem.id}:${duplicate.item.id}`)}`,
        newsId: duplicateItem.id,
        duplicateOfId: duplicate.item.id,
        matchedBy: duplicate.matchedBy,
        timestamp: nowIso,
        title: duplicateItem.title,
      });
      continue;
    }

    const publishedItem = toPublishedItem(candidate, undefined, context, nowIso);
    byId.set(publishedItem.id, publishedItem);
    imported += 1;
    published += 1;
  }

  const news = capNews(
    Array.from(byId.values()).sort((a, b) => {
      const statusRank: Record<NewsPublishStatus, number> = {
        published: 0,
        pending: 1,
        stale: 2,
        duplicate: 3,
        rejected: 4,
        source_error: 5,
      };
      if (statusRank[a.publishStatus] !== statusRank[b.publishStatus]) {
        return statusRank[a.publishStatus] - statusRank[b.publishStatus];
      }
      const aTime = a.publishedAtKnown && a.publishedAt ? Date.parse(a.publishedAt) : Date.parse(a.fetchedAt);
      const bTime = b.publishedAtKnown && b.publishedAt ? Date.parse(b.publishedAt) : Date.parse(b.fetchedAt);
      return bTime - aTime;
    })
  );

  return {
    news,
    stats: {
      fetched: incoming.length,
      imported,
      published,
      duplicates,
      rejected,
      updated,
    },
    errors,
    dedupRecords,
  };
}
