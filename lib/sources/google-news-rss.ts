import { formatArabicTimestamp, toCairoDateString } from '../cairo-time';
import { NewsItemRecord } from '../types';
import { fetchWithProtection } from './http-client';

const GOOGLE_NEWS_RSS_BASE_URL =
  process.env.GOOGLE_NEWS_RSS_BASE_URL || 'https://news.google.com/rss/search';

function decodeXmlEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

/**
 * Parses Google News RSS 2.0 XML into canonical NewsItemRecord[] with full source attribution.
 * Never copies full article bodies — only headline, timestamp, publisher name, and original URL.
 */
export function parseGoogleNewsRssXml(
  xmlText: string,
  language: 'ar' | 'en' = 'ar',
  categoryAr: string = 'الكرة المصرية'
): NewsItemRecord[] {
  const items: NewsItemRecord[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[1];
    const rawTitle = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
    const rawLink = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
    const rawPubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '';
    const sourceMatch = block.match(/<source(?:\s+url="([^"]*)")?>([\s\S]*?)<\/source>/i);

    let title = decodeXmlEntities(rawTitle);
    const link = decodeXmlEntities(rawLink);
    const publisherUrl = sourceMatch?.[1] ? decodeXmlEntities(sourceMatch[1]) : null;
    let publisherName = sourceMatch?.[2] ? decodeXmlEntities(sourceMatch[2]) : 'Google News';

    // Strip trailing " - Publisher" from Google News title if present
    if (publisherName && title.endsWith(` - ${publisherName}`)) {
      title = title.slice(0, -(` - ${publisherName}`).length).trim();
    }

    if (!title || !link) continue;

    const pubDateObj = rawPubDate ? new Date(rawPubDate.trim()) : new Date();
    const publishedAt = !Number.isNaN(pubDateObj.getTime())
      ? pubDateObj.toISOString()
      : new Date().toISOString();

    const idSlug = Buffer.from(link).toString('base64url').slice(-20);

    items.push({
      id: `news-gn-${language}-${idSlug}`,
      title,
      link,
      publishedAt,
      cairoDate: toCairoDateString(publishedAt),
      cairoTimeLabel: formatArabicTimestamp(publishedAt),
      publisherName,
      publisherUrl,
      language,
      categoryAr,
      sourceId: 'google-news-rss',
    });
  }

  return items;
}

/**
 * Fetches Arabic & English Egyptian football news feeds from Google News RSS.
 */
export async function fetchGoogleNewsRss(): Promise<{
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  news: NewsItemRecord[];
  error?: string;
}> {
  const feeds: Array<{ url: string; lang: 'ar' | 'en'; categoryAr: string }> = [
    {
      url: `${GOOGLE_NEWS_RSS_BASE_URL}?q=${encodeURIComponent('الدوري المصري')}&hl=ar&gl=EG&ceid=EG:ar`,
      lang: 'ar',
      categoryAr: 'الدوري المصري الممتاز',
    },
    {
      url: `${GOOGLE_NEWS_RSS_BASE_URL}?q=${encodeURIComponent('Egyptian Premier League')}&hl=en&gl=EG&ceid=EG:en`,
      lang: 'en',
      categoryAr: 'تغطية دولية — الكرة المصرية',
    },
  ];

  const allItems: NewsItemRecord[] = [];
  let anyOk = false;
  let lastHttp: number | null = null;
  let totalLatency = 0;
  let lastErr: string | undefined;

  for (const f of feeds) {
    const res = await fetchWithProtection<string>(
      f.url,
      {
        timeoutMs: 7000,
        retries: 1,
        cacheTtlMs: 10 * 60_000,
      },
      'text'
    );
    totalLatency += res.latencyMs;
    if (res.httpStatus) lastHttp = res.httpStatus;

    if (res.ok && typeof res.data === 'string') {
      anyOk = true;
      const parsed = parseGoogleNewsRssXml(res.data, f.lang, f.categoryAr);
      allItems.push(...parsed.slice(0, 12));
    } else if (res.error) {
      lastErr = res.error;
    }
  }

  // Deduplicate by title
  const seen = new Set<string>();
  const deduped = allItems.filter((item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return {
    ok: anyOk,
    httpStatus: lastHttp,
    latencyMs: totalLatency,
    news: deduped.slice(0, 18),
    error: anyOk ? undefined : lastErr || 'Failed to fetch Google News RSS',
  };
}
