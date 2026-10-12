import { NewsItemRecord, RawNewsCandidate } from '../types';
import { collapseWhitespace, normalizeNewsUrl, stripHtml } from './normalize';

export interface NewsValidationResult {
  ok: boolean;
  code: string | null;
  messageAr: string | null;
  normalizedUrl: string | null;
}

const ERROR_TITLE_RE =
  /access denied|just a moment|attention required|captcha|error 404|403 forbidden|503 service|request unsuccessful|please enable cookies|news\.google\.com/i;

const SCORE_ONLY_RE = /^\d+\s*[-:]\s*\d+$/;

const TECHNICAL_TITLE_RE =
  /^(undefined|null|rss|atom|feed|error|test|lorem ipsum)$/i;

export function isValidHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return normalizeNewsUrl(value) !== null;
}

export function isGoogleNewsUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'news.google.com' || host.endsWith('.news.google.com');
  } catch {
    return false;
  }
}

/** Kept as a narrow compatibility helper for existing tests/integrations. */
export function isGoogleNewsSearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      isGoogleNewsUrl(value) &&
      (url.pathname.includes('/rss/search') || url.pathname.includes('/search'))
    );
  } catch {
    return false;
  }
}

export function isLikelyArticleUrl(value: string): boolean {
  const normalized = normalizeNewsUrl(value);
  if (!normalized || isGoogleNewsUrl(normalized)) return false;

  try {
    const url = new URL(normalized);
    if (url.pathname === '/' || /^\/(?:rss|feed|search)(?:\/|$)/i.test(url.pathname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The publisher root URL is not an article URL. Accept direct article URLs only when the
 * article host exactly matches the RSS publisher host (with only the www alias normalized).
 */
export function isDirectPublisherArticleUrl(
  articleUrl: string | null | undefined,
  publisherUrl: string | null | undefined
): boolean {
  if (!articleUrl || !publisherUrl || !isLikelyArticleUrl(articleUrl)) return false;

  try {
    const article = new URL(articleUrl);
    const publisher = new URL(publisherUrl);
    if (
      !['http:', 'https:'].includes(publisher.protocol) ||
      article.username ||
      article.password ||
      article.port ||
      publisher.username ||
      publisher.password ||
      publisher.port
    ) {
      return false;
    }

    // Normalize the common www alias, but require the same host. Suffix-only checks can
    // accidentally treat public suffixes (for example, "com") as a publisher domain.
    const articleHost = article.hostname.toLowerCase().replace(/^www\./, '');
    const publisherHost = publisher.hostname.toLowerCase().replace(/^www\./, '');
    return articleHost === publisherHost && article.pathname.split('/').filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

/** Thin headline-only syndication pages are intentionally not indexable. */
export function isIndexableNewsArticle(item: NewsItemRecord): boolean {
  return (
    item.publishStatus === 'published' &&
    item.publishedAtKnown &&
    Boolean(item.publishedAt && !Number.isNaN(Date.parse(item.publishedAt))) &&
    collapseWhitespace(item.title).length >= 15 &&
    collapseWhitespace(stripHtml(item.excerpt || '')).length >= 160 &&
    isDirectPublisherArticleUrl(item.originalUrl || item.link, item.publisherUrl)
  );
}

export function looksLikeErrorPage(title: string, excerpt?: string | null): boolean {
  const haystack = `${title} ${excerpt || ''}`;
  return ERROR_TITLE_RE.test(haystack);
}

export function isEmptyOrTechnicalContent(title: string, excerpt?: string | null): boolean {
  const cleanTitle = collapseWhitespace(stripHtml(title));
  if (cleanTitle.length < 8) return true;
  if (TECHNICAL_TITLE_RE.test(cleanTitle)) return true;
  if (SCORE_ONLY_RE.test(cleanTitle)) return true;
  const cleanExcerpt = excerpt ? collapseWhitespace(stripHtml(excerpt)) : '';
  if (cleanExcerpt && /^(undefined|null|error)$/i.test(cleanExcerpt)) return true;
  return false;
}

export function validateNewsCandidate(candidate: RawNewsCandidate): NewsValidationResult {
  const title = collapseWhitespace(candidate.title || '');
  if (!title) {
    return {
      ok: false,
      code: 'missing_title',
      messageAr: 'رفض: العنوان غير صالح أو فارغ.',
      normalizedUrl: null,
    };
  }

  if (!candidate.publisherName || !collapseWhitespace(candidate.publisherName)) {
    return {
      ok: false,
      code: 'missing_publisher',
      messageAr: 'رفض: المصدر الأصلي غير معروف.',
      normalizedUrl: null,
    };
  }

  const link = candidate.originalUrl || candidate.link;
  if (!isDirectPublisherArticleUrl(link, candidate.publisherUrl)) {
    return {
      ok: false,
      code: 'invalid_url',
      messageAr:
        'رفض: الرابط ليس رابط مقالة مباشرة من الناشر (روابط بحث أو تحويل Google News غير قابلة للنشر).',
      normalizedUrl: normalizeNewsUrl(link),
    };
  }

  if (looksLikeErrorPage(title, candidate.excerpt)) {
    return {
      ok: false,
      code: 'error_page',
      messageAr: 'رفض: الاستجابة تشبه صفحة خطأ أو حظر وليست خبرًا.',
      normalizedUrl: normalizeNewsUrl(link),
    };
  }

  if (isEmptyOrTechnicalContent(title, candidate.excerpt)) {
    return {
      ok: false,
      code: 'empty_or_technical',
      messageAr: 'رفض: المحتوى فارغ أو تقني أو ليس خبرًا رياضيًا.',
      normalizedUrl: normalizeNewsUrl(link),
    };
  }

  return {
    ok: true,
    code: null,
    messageAr: null,
    normalizedUrl: normalizeNewsUrl(link),
  };
}
