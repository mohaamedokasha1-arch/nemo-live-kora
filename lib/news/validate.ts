import { RawNewsCandidate } from '../types';
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

export function isGoogleNewsSearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.hostname.includes('news.google.com') &&
      (url.pathname.includes('/rss/search') || url.pathname.includes('/search'))
    );
  } catch {
    return false;
  }
}

export function isLikelyArticleUrl(value: string): boolean {
  const normalized = normalizeNewsUrl(value);
  if (!normalized) return false;
  if (isGoogleNewsSearchUrl(normalized)) return false;
  return true;
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
  if (!isLikelyArticleUrl(link)) {
    return {
      ok: false,
      code: 'invalid_url',
      messageAr: 'رفض: الرابط غير صالح أو يشير إلى صفحة بحث وليس إلى خبر.',
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
