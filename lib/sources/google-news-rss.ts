import { RawNewsCandidate } from '../types';
import { collapseWhitespace, stripHtml } from '../news/normalize';
import { fetchWithProtection } from './http-client';

const GOOGLE_NEWS_RSS_BASE_URL =
  process.env.GOOGLE_NEWS_RSS_BASE_URL || 'https://news.google.com/rss/search';

function decodeXmlEntities(str: string): string {
  return stripHtml(str);
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match?.[1] ? decodeXmlEntities(match[1]) : '';
}

function parseRssDate(raw: string): { publishedAt: string | null; known: boolean } {
  const trimmed = collapseWhitespace(raw);
  if (!trimmed) return { publishedAt: null, known: false };
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return { publishedAt: null, known: false };
  return { publishedAt: parsed.toISOString(), known: true };
}

function excerptFromDescription(rawDescription: string, title: string): string | null {
  const text = stripHtml(rawDescription);
  if (!text) return null;
  const withoutTitle = text.replace(title, '').trim();
  const candidate = withoutTitle.length >= 12 ? withoutTitle : text;
  if (!candidate || candidate === title) return null;
  if (candidate.length <= 240) return candidate;
  return `${candidate.slice(0, 237).trim()}...`;
}

/**
 * Parses Google News RSS 2.0 XML into RawNewsCandidate[].
 * Never copies full article bodies. Never substitutes today's date for a missing pubDate.
 */
export function parseGoogleNewsRssXml(
  xmlText: string,
  language: 'ar' | 'en' = 'ar',
  categoryAr: string = 'الكرة المصرية',
  fetchedAt: string = new Date().toISOString()
): RawNewsCandidate[] {
  if (!xmlText || (!xmlText.includes('<rss') && !xmlText.includes('<feed') && !xmlText.includes('<item'))) {
    return [];
  }

  const items: RawNewsCandidate[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[1];
    const rawTitle = extractTag(block, 'title');
    const rawLink = extractTag(block, 'link');
    const rawGuid = extractTag(block, 'guid');
    const rawPubDate = extractTag(block, 'pubDate');
    const rawDescription = extractTag(block, 'description');
    const sourceMatch = block.match(/<source(?:\s+url="([^"]*)")?>([\s\S]*?)<\/source>/i);

    let title = collapseWhitespace(rawTitle);
    const link = collapseWhitespace(rawLink);
    const publisherUrl = sourceMatch?.[1] ? collapseWhitespace(decodeXmlEntities(sourceMatch[1])) : null;
    let publisherName = sourceMatch?.[2]
      ? collapseWhitespace(decodeXmlEntities(sourceMatch[2]))
      : '';

    if (publisherName && title.endsWith(` - ${publisherName}`)) {
      title = title.slice(0, -(` - ${publisherName}`).length).trim();
    }

    if (!title || !link) continue;

    const { publishedAt, known } = parseRssDate(rawPubDate);
    const sourceItemId = rawGuid || null;

    items.push({
      sourceId: 'google-news-rss',
      sourceItemId,
      title,
      link,
      originalUrl: link,
      publishedAt,
      publishedAtKnown: known,
      updatedAt: null,
      excerpt: excerptFromDescription(rawDescription, title),
      imageUrl: null,
      publisherName: publisherName || 'Google News',
      publisherUrl,
      language,
      categoryAr,
      fetchedAt,
    });
  }

  return items;
}

export interface GoogleNewsFetchResult {
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  news: RawNewsCandidate[];
  error?: string;
  errorAr?: string;
  feedResults: Array<{
    url: string;
    ok: boolean;
    httpStatus: number | null;
    itemCount: number;
    error?: string;
  }>;
}

/**
 * Fetches Arabic & English Egyptian football news feeds from Google News RSS.
 */
export async function fetchGoogleNewsRss(options: {
  timeoutMs?: number;
  retries?: number;
  limitFeeds?: number;
} = {}): Promise<GoogleNewsFetchResult> {
  const fetchedAt = new Date().toISOString();
  const timeoutMs = options.timeoutMs ?? 8000;
  const retries = options.retries ?? 1;
  const allFeeds: Array<{ url: string; lang: 'ar' | 'en'; categoryAr: string }> = [
    {
      url: `${GOOGLE_NEWS_RSS_BASE_URL}?q=${encodeURIComponent('الدوري المصري')}&hl=ar&gl=EG&ceid=EG:ar`,
      lang: 'ar',
      categoryAr: 'الدوري المصري الممتاز',
    },
    {
      url: `${GOOGLE_NEWS_RSS_BASE_URL}?q=${encodeURIComponent('منتخب مصر')}&hl=ar&gl=EG&ceid=EG:ar`,
      lang: 'ar',
      categoryAr: 'منتخب مصر',
    },
    {
      url: `${GOOGLE_NEWS_RSS_BASE_URL}?q=${encodeURIComponent('Egyptian Premier League')}&hl=en&gl=EG&ceid=EG:en`,
      lang: 'en',
      categoryAr: 'تغطية دولية — الكرة المصرية',
    },
  ];
  const feeds = allFeeds.slice(0, options.limitFeeds || allFeeds.length);

  const allItems: RawNewsCandidate[] = [];
  const feedResults: GoogleNewsFetchResult['feedResults'] = [];
  let anyOk = false;
  let lastHttp: number | null = null;
  let totalLatency = 0;
  let lastErr: string | undefined;

  for (const feed of feeds) {
    const res = await fetchWithProtection<string>(
      feed.url,
      {
        timeoutMs,
        retries,
        cacheTtlMs: 10 * 60_000,
      },
      'text'
    );
    totalLatency += res.latencyMs;
    if (res.httpStatus) lastHttp = res.httpStatus;

    if (res.ok && typeof res.data === 'string') {
      const lower = res.data.toLowerCase();
      if (!lower.includes('<rss') && !lower.includes('<item>')) {
        feedResults.push({
          url: feed.url,
          ok: false,
          httpStatus: res.httpStatus,
          itemCount: 0,
          error: 'Response was not a valid RSS feed',
        });
        lastErr = 'Response was not a valid RSS feed';
        continue;
      }
      anyOk = true;
      const parsed = parseGoogleNewsRssXml(res.data, feed.lang, feed.categoryAr, fetchedAt);
      allItems.push(...parsed.slice(0, 20));
      feedResults.push({
        url: feed.url,
        ok: true,
        httpStatus: res.httpStatus,
        itemCount: parsed.length,
      });
    } else {
      lastErr = res.error;
      feedResults.push({
        url: feed.url,
        ok: false,
        httpStatus: res.httpStatus,
        itemCount: 0,
        error: res.error,
      });
    }
  }

  const seen = new Set<string>();
  const deduped = allItems.filter((item) => {
    const key = `${item.sourceItemId || ''}::${item.link}::${item.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    ok: anyOk,
    httpStatus: lastHttp,
    latencyMs: totalLatency,
    news: deduped,
    error: anyOk ? undefined : lastErr || 'Failed to fetch Google News RSS',
    errorAr: anyOk
      ? undefined
      : 'تعذر جلب خلاصة Google News RSS. تم الاحتفاظ بالأخبار المنشورة سابقًا.',
    feedResults,
  };
}
