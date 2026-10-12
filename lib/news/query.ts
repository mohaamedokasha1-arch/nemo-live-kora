import { NewsItemRecord } from '../types';
import { compareNewsByRealDate, isFreshNews, isStaleForLatestSection } from './age-policy';

export function getPublishedNews(
  news: NewsItemRecord[],
  now: Date = new Date()
): NewsItemRecord[] {
  return news
    .filter((item) => item.publishStatus === 'published')
    .sort((a, b) => compareNewsByRealDate(a, b))
    .map((item) =>
      isStaleForLatestSection(item, now) && item.publishStatus === 'published'
        ? item
        : item
    );
}

export function getLatestNews(
  news: NewsItemRecord[],
  limit = 12,
  now: Date = new Date()
): NewsItemRecord[] {
  return getPublishedNews(news, now)
    .filter((item) => item.publishedAtKnown && isFreshNews(item.publishedAt, now))
    .slice(0, limit);
}

export function getArchiveNews(
  news: NewsItemRecord[],
  now: Date = new Date()
): NewsItemRecord[] {
  return getPublishedNews(news, now).filter(
    (item) => !item.publishedAtKnown || !isFreshNews(item.publishedAt, now)
  );
}

export function findNewsBySlug(
  news: NewsItemRecord[],
  slug: string
): NewsItemRecord | undefined {
  return news.find(
    (item) => item.slug === slug && item.publishStatus === 'published'
  );
}

export function getRelatedPublishedNews(
  news: NewsItemRecord[],
  current: NewsItemRecord,
  limit = 4
): NewsItemRecord[] {
  return getPublishedNews(news)
    .filter((item) => item.id !== current.id)
    .filter((item) => {
      if (item.relatedTeamIds.some((id) => current.relatedTeamIds.includes(id))) {
        return true;
      }
      if (
        item.relatedCompetitionCodes.some((code) =>
          current.relatedCompetitionCodes.includes(code)
        )
      ) {
        return true;
      }
      return item.categoryAr === current.categoryAr;
    })
    .slice(0, limit);
}

export function getNewsAdminStats(news: NewsItemRecord[], now: Date = new Date()) {
  const published = news.filter((item) => item.publishStatus === 'published');
  const withUnknownDate = published.filter((item) => !item.publishedAtKnown);
  const latestKnown = published
    .filter((item) => item.publishedAtKnown && item.publishedAt)
    .sort((a, b) => compareNewsByRealDate(a, b))[0];

  return {
    fetched: news.length,
    published: published.length,
    latest: getLatestNews(news, 1000, now).length,
    archive: getArchiveNews(news, now).length,
    duplicates: news.filter((item) => item.publishStatus === 'duplicate').length,
    rejected: news.filter((item) => item.publishStatus === 'rejected').length,
    pending: news.filter((item) => item.publishStatus === 'pending').length,
    sourceError: news.filter((item) => item.publishStatus === 'source_error').length,
    unknownPublishDate: withUnknownDate.length,
    latestPublishedAt: latestKnown?.publishedAt || null,
  };
}
