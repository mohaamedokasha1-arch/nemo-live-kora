import { NewsItemRecord, RawNewsCandidate } from '../types';
import { collapseWhitespace, normalizeNewsUrl, stripHtml } from './normalize';
import {
  isBlockedArticleHost,
  isTrustedPublisherArticleUrl,
  samePublisherHost,
} from './publisher-domains';

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
    if (isBlockedArticleHost(url.hostname)) return false;
    if (url.pathname === '/' || /^\/(?:rss|feed|search)(?:\/|$)/i.test(url.pathname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The publisher root URL is not an article URL. Accept direct article URLs when the article host
 * belongs to the same publisher as the RSS `<source url>` (compared at the registrable-domain
 * level, so mobile/AMP mirrors of the same publisher are accepted), the host is not a
 * social/Google property, and the path is deeper than the site root.
 */
export function isDirectPublisherArticleUrl(
  articleUrl: string | null | undefined,
  publisherUrl: string | null | undefined
): boolean {
  return isTrustedPublisherArticleUrl(articleUrl, publisherUrl).ok;
}

/**
 * Headlines that are nothing but a scoreboard entry ("الأهلي 2 - 1 الزمالك", "Result: 3-0") are
 * match data, not journalism. They are rejected with their own code so the admin log shows why
 * the feed produced nothing publishable instead of blaming the link resolver.
 */
const SCORE_HEADLINE_RE =
  /(\d+\s*[-–—:]\s*\d+)|(\b\d+\s*goals?\b.*\b\d+\s*goals?\b)/i;
const SCORE_CONTEXT_RE =
  /(نتيجة|النتيجة|انتهت|ملخص|شاهد أهداف|اهداف المباراة|highlights?|match report|full[- ]time|final score|live score|نتائج مباريات|نتائج اليوم)/i;

export function isMatchScoreHeadline(title: string, excerpt?: string | null): boolean {
  const clean = collapseWhitespace(stripHtml(title || ''));
  if (!clean) return false;
  if (!SCORE_HEADLINE_RE.test(clean)) return false;
  // A score plus real reporting context is still an article; a bare scoreboard line is not.
  const hasContext = SCORE_CONTEXT_RE.test(`${clean} ${excerpt || ''}`);
  const words = clean.split(/\s+/).length;
  return !hasContext || words <= 8;
}

/** حدّ أدنى لنصّ أي خبر ليُعتبر قابلًا للفهرسة (يمنع الصفحات الرقيقة). */
export const NEWS_INDEX_MIN_TITLE = 15;
/** أخبار المصادر: المقتطف هو كل ما لدينا، فالحدّ مرتفع. */
export const NEWS_INDEX_MIN_EXCERPT = 160;
/** أخبار الموقع نفسها (كتابة إدارية): يُحتسب النصّ الكامل + المقتطف معًا. */
export const NEWS_INDEX_MIN_FIRST_PARTY = 200;

/**
 * Thin headline-only syndication pages are intentionally not indexable.
 *
 * خبر مكتوب في لوحة الإدارة (origin = 'manual') **محتوى الموقع نفسه**: لا معنى لاشتراط
 * رابط ناشر خارجي موثوق فيه — وهو ما كان يمنع ظهور أخبار اللوحة في خريطة الموقع رغم أن
 * صفحاتها تعمل وتُعرض للزوار. ويبقى شرط «لا نصّ رقيق» قائمًا بحساب المقتطف + النصّ الكامل.
 */
export function isIndexableNewsArticle(item: NewsItemRecord): boolean {
  const publishable =
    item.publishStatus === 'published' &&
    item.publishedAtKnown &&
    Boolean(item.publishedAt && !Number.isNaN(Date.parse(item.publishedAt)));
  if (!publishable) return false;
  if (collapseWhitespace(item.title).length < NEWS_INDEX_MIN_TITLE) return false;

  if (item.origin === 'manual') {
    const text =
      collapseWhitespace(stripHtml(item.excerpt || '')).length +
      collapseWhitespace(stripHtml(item.bodyText || '')).length;
    return text >= NEWS_INDEX_MIN_FIRST_PARTY;
  }

  return (
    collapseWhitespace(stripHtml(item.excerpt || '')).length >= NEWS_INDEX_MIN_EXCERPT &&
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

  if (isMatchScoreHeadline(title, candidate.excerpt)) {
    return {
      ok: false,
      code: 'match_score_only',
      messageAr: 'رفض: العنوان نتيجة مباراة وليس خبرًا صحفيًا.',
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

export { isBlockedArticleHost, isTrustedPublisherArticleUrl, samePublisherHost };

/**
 * شرح عربي لكل رمز رفض ينتجه خط الأخبار. الرموز تُسجَّل في المخزن (`newsImportErrors`)
 * وتُعرض في `/api/sources` وفي اللوحة، فتصبح «لماذا لا يوجد خبر؟» سؤالًا له جواب مكتوب
 * بدل تخمين: قد يكون الرابط الوسيط من Google News لم يُحلّ، أو العنوان نتيجة مباراة، إلخ.
 */
export const NEWS_REJECTION_LABELS_AR: Record<string, string> = {
  missing_title: 'عنوان فارغ أو غير صالح',
  missing_publisher: 'اسم الناشر الأصلي غير معروف',
  invalid_url: 'الرابط ليس رابط مقالة مباشرة من الناشر (رابط Google News الوسيط لم يُحلّ)',
  error_page: 'المحتوى يشبه صفحة خطأ أو حظر',
  match_score_only: 'العنوان نتيجة مباراة وليس خبرًا صحفيًا',
  empty_or_technical: 'المحتوى فارغ أو تقني أو ليس خبرًا رياضيًا',
  rejected: 'لم يستوفِ شروط النشر',
};

export function describeNewsRejectionAr(code: string | null | undefined): string {
  const key = (code || '').trim();
  return NEWS_REJECTION_LABELS_AR[key] || `سبب غير مُصنَّف (${key || 'غير معروف'})`;
}

/**
 * أكثر سبب رفض تكرارًا في دفعة واحدة، مع عدّاده — يُستخدم في وصف حالة المصدر
 * وفي `/api/sources` حتى يقرأ المشغّل السبب الفعلي لا مجرّد «صفر أخبار».
 */
export function summarizeNewsRejectionsAr(
  breakdown: Record<string, number> | null | undefined
): { code: string; count: number; labelAr: string } | null {
  const entries = Object.entries(breakdown || {}).filter(([, count]) => count > 0);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [code, count] = entries[0];
  return { code, count, labelAr: describeNewsRejectionAr(code) };
}
