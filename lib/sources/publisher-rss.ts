/**
 * Publisher-direct RSS news source (`publisher-rss`).
 *
 * Why this source exists (verified 2026-10-15): the Google News RSS feed answers with real
 * headlines, but every `<link>` is now a `news.google.com/rss/articles/CBMi…` relay whose decoded
 * payload carries an opaque `AU_yqL…` id — no embedded publisher URL anymore (proven offline in
 * `tests/publisher-rss-news.test.ts` against a live-captured feed sample). The relay can only be
 * unwrapped by fetching the interstitial and calling Google's internal decode RPC; production
 * shows that path failing with `interstitial_without_destination` (0 of 10 resolved), so the
 * pipeline published 0 articles. A publisher's own RSS feed hands over article URLs directly —
 * same validation, same attribution, no relay, no third-party decode to depend on.
 *
 * Hard rules inherited from the news policy:
 *  • Only items whose link lives on the feed's declared publisher domain are kept (registrable
 *    domain match — mobile/AMP mirrors pass, anything else is discarded and counted).
 *  • Full article bodies are never copied; title, publisher summary, image and date only.
 *  • Missing publish dates stay unknown; today's date is never substituted.
 *  • One failing feed never blocks the others; stored news is never deleted on failure.
 */

import { RawNewsCandidate } from '../types';
import {
  collapseWhitespace,
  normalizeNewsUrl,
  stripHtml,
} from '../news/normalize';
import {
  isBlockedArticleHost,
  registrableDomain,
} from '../news/publisher-domains';
import { fetchWithProtection } from './http-client';

export interface PublisherRssFeed {
  /** Stable machine id — used as part of feed reports and sourceItemId namespaces. */
  id: string;
  labelAr: string;
  url: string;
  /** Publisher root used for the domain ownership check (registrable-domain level). */
  publisherUrl: string;
  /**
   * Additional registrable domains owned by the same publisher (live-verified 2026-10-15: BBC's
   * Arabic articles serve from www.bbc.com even though the feed is hosted on feeds.bbci.co.uk).
   * When present it replaces the publisherUrl-derived domain as the acceptance set.
   */
  domains?: string[];
  publisherName: string;
  language: 'ar' | 'en';
  categoryAr: string;
}

/**
 * Default feed list. Every entry is a public, syndication-oriented publisher feed (this is the
 * purpose RSS exists for): the item link is the article URL itself, so no relay decoding is
 * involved. The default roster was LIVE-VERIFIED on 2026-10-15 (06:17Z): BBC Sport Football and
 * The Guardian Football answer with real items and direct article links; FilGoal's public RSS is
 * retired site-wide ("Sorry, this service is no longer available") and BBC Arabic's /arabic/sport
 * path redirects to the general feed, so Youm7's sports section feed (Egyptian, live channel)
 * replaces it for the Egyptian-first angle. Owners can extend the list via NEMO_PUBLISHER_RSS_FEEDS.
 */
export const PUBLISHER_RSS_FEEDS: PublisherRssFeed[] = [
  {
    // Live-verified 2026-10-15T06:17Z — fresh World/Champions-League items, direct links.
    id: 'bbc-football',
    labelAr: 'BBC Sport — كرة القدم',
    url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
    publisherUrl: 'https://www.bbc.co.uk/sport/football',
    // BBC articles are served from both bbc.co.uk and bbc.com — the feed itself mixes them.
    domains: ['bbc.co.uk', 'bbc.com'],
    publisherName: 'BBC Sport',
    language: 'en',
    categoryAr: 'كرة القدم العالمية — BBC',
  },
  {
    // Live-verified 2026-10-15T06:17Z — full match reports with canonical article URLs.
    id: 'guardian-football',
    labelAr: 'الجارديان — كرة القدم',
    url: 'https://www.theguardian.com/football/rss',
    publisherUrl: 'https://www.theguardian.com/football',
    publisherName: 'The Guardian',
    language: 'en',
    categoryAr: 'كرة القدم العالمية — الجارديان',
  },
  {
    // Egyptian first. Channel answered live on 2026-10-15 through the audit egress; per-item
    // verification was not possible from that environment, and feed isolation contains the risk.
    id: 'youm7-sport',
    labelAr: 'اليوم السابع — رياضة',
    url: 'https://www.youm7.com/rss/SectionRss?SectionID=4',
    publisherUrl: 'https://www.youm7.com',
    publisherName: 'اليوم السابع',
    language: 'ar',
    categoryAr: 'الكرة المصرية — اليوم السابع',
  },
];

/**
 * Operator feed list override: a comma-separated list of RSS/Atom URLs.
 * Extra URLs are appended to the defaults; setting `NEMO_PUBLISHER_RSS_FEEDS=none` disables the
 * source at configuration level without touching the admin toggles.
 */
export function resolvePublisherRssFeeds(): PublisherRssFeed[] {
  const raw = (process.env.NEMO_PUBLISHER_RSS_FEEDS || '').trim();
  if (raw.toLowerCase() === 'none') return [];
  const extra = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => /^https?:\/\//i.test(entry))
    .filter((url) => !PUBLISHER_RSS_FEEDS.some((feed) => feed.url === url))
    .map((url) => feedFromUrl(url));
  return [...PUBLISHER_RSS_FEEDS, ...extra];
}

function feedFromUrl(url: string): PublisherRssFeed {
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep raw */
  }
  return {
    id: `rss-${host.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '-')}`,
    labelAr: host,
    url,
    publisherUrl: url,
    publisherName: host,
    language: 'ar',
    categoryAr: 'خلاصة ناشر مضافة يدويًا',
  };
}

function decodeEntities(value: string): string {
  return stripHtml(value);
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match?.[1] ? decodeEntities(match[1]) : '';
}

function extractAtomLink(block: string): string {
  // Prefer rel="alternate"; otherwise the first <link href="…">.
  const alternate = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alternate?.[1]) return decodeEntities(alternate[1]);
  const any = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return any?.[1] ? decodeEntities(any[1]) : '';
}

function parseDate(raw: string): { publishedAt: string | null; known: boolean } {
  const trimmed = collapseWhitespace(raw);
  if (!trimmed) return { publishedAt: null, known: false };
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return { publishedAt: null, known: false };
  return { publishedAt: parsed.toISOString(), known: true };
}

function excerptFromHtml(raw: string, title: string): string | null {
  const text = collapseWhitespace(stripHtml(raw));
  if (!text) return null;
  if (collapseWhitespace(text) === collapseWhitespace(title)) return null;
  return text.length <= 240 ? text : `${text.slice(0, 237).trim()}...`;
}

/**
 * Validates that an item link is a real article on the feed's own publisher domain.
 * Registrable-domain comparison (not exact host) so `m.`/`amp.`/section mirrors of the same
 * publisher pass, while injected off-domain links (aggregators, social, Google relays) fail.
 */
export function isFeedPublisherArticleUrl(link: string, feed: PublisherRssFeed): boolean {
  let article: URL;
  try {
    article = new URL(link.trim());
  } catch {
    return false;
  }
  if (article.protocol !== 'https:' && article.protocol !== 'http:') return false;
  if (isBlockedArticleHost(article.hostname)) return false;
  if (article.pathname.split('/').filter(Boolean).length < 2) return false;
  const hosts = (feed.domains && feed.domains.length > 0)
    ? feed.domains
    : [new URL(feed.publisherUrl).hostname];
  const allowed = new Set(
    hosts.map((host) => registrableDomain(host.replace(/^https?:\/\//, '')) || '').filter(Boolean)
  );
  if (allowed.size === 0) return false;
  const linkRegistrable = registrableDomain(article.hostname);
  return !!linkRegistrable && allowed.has(linkRegistrable);
}

/**
 * Parses one publisher RSS 2.0 / Atom feed into RawNewsCandidate[].
 * Returns the kept items plus per-reason rejection counts so the sync record stays truthful
 * about feeds that answer 200 but carry nothing publishable.
 */
export function parsePublisherRssXml(
  xmlText: string,
  feed: PublisherRssFeed,
  fetchedAt: string = new Date().toISOString(),
  maxItems = 8
): { items: RawNewsCandidate[]; rejected: Record<string, number>; rejectedCount: number } {
  const rejected: Record<string, number> = {};
  const bump = (code: string) => {
    rejected[code] = (rejected[code] || 0) + 1;
  };
  if (!xmlText || (!/<rss[\s>]/i.test(xmlText) && !/<feed[\s>]/i.test(xmlText) && !/<item>/i.test(xmlText) && !/<entry>/i.test(xmlText))) {
    return { items: [], rejected: { not_a_feed: 1 }, rejectedCount: 1 };
  }

  const isAtom = !/<item>/i.test(xmlText) && /<entry[\s>]/i.test(xmlText);
  const blockRe = isAtom ? /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi : /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;

  // Channel-level title used to strip " - Site name" suffixes publishers append.
  const channelTitle = collapseWhitespace(
    extractTag(xmlText.slice(0, 4000), isAtom ? 'title' : 'title')
  );

  const items: RawNewsCandidate[] = [];
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(xmlText)) !== null) {
    if (items.length >= maxItems) break;
    const block = match[1];
    let title = collapseWhitespace(extractTag(block, 'title'));
    const linkRaw = isAtom ? extractAtomLink(block) : extractTag(block, 'link');
    const guid = collapseWhitespace(extractTag(block, 'guid'));
    const dateRaw =
      extractTag(block, 'pubDate') ||
      extractTag(block, 'published') ||
      extractTag(block, 'updated') ||
      extractTag(block, 'dc:date');
    const bodyRaw =
      extractTag(block, 'description') ||
      extractTag(block, 'summary') ||
      extractTag(block, 'content') ||
      extractTag(block, 'content:encoded');

    if (!title) {
      bump('missing_title');
      continue;
    }
    // Publishers commonly append " - BBC News" / " | The Guardian"; the relay form was handled
    // the same way in the Google parser.
    for (const suffix of [
      ` - ${collapseWhitespace(feed.publisherName)}`,
      ` - ${channelTitle}`,
      ` | ${channelTitle}`,
    ]) {
      if (suffix.trim() !== ' -' && title.endsWith(suffix)) {
        title = title.slice(0, -suffix.length).trim();
        break;
      }
    }

    const link = collapseWhitespace(linkRaw);
    const normalizedLink = normalizeNewsUrl(link);
    if (!normalizedLink) {
      bump('missing_link');
      continue;
    }
    if (!isFeedPublisherArticleUrl(normalizedLink, feed)) {
      bump('off_publisher_host');
      continue;
    }

    const { publishedAt, known } = parseDate(dateRaw);
    const enclosureMatch = block.match(/<enclosure[^>]+url="([^"]+)"[^>]*type="image[^"]*"/i);
    const thumbMatch = block.match(/<media:thumbnail[^>]+url="([^"]+)"/i) || block.match(/<img[^>]+src="([^"]+)"/i);
    let imageUrl = enclosureMatch?.[1] || thumbMatch?.[1] ? decodeEntities(enclosureMatch?.[1] || thumbMatch?.[1] || '') : null;
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) imageUrl = null;

    items.push({
      sourceId: 'publisher-rss',
      sourceItemId: guid || normalizedLink,
      title,
      link: normalizedLink,
      originalUrl: normalizedLink,
      publishedAt,
      publishedAtKnown: known,
      updatedAt: null,
      excerpt: excerptFromHtml(bodyRaw, title),
      imageUrl,
      publisherName: collapseWhitespace(feed.publisherName),
      publisherUrl: feed.publisherUrl,
      language: feed.language,
      categoryAr: feed.categoryAr,
      fetchedAt,
    });
  }

  const rejectedCount = Object.values(rejected).reduce((a, b) => a + b, 0);
  return { items, rejected, rejectedCount };
}

export interface PublisherRssFeedResult {
  feedId: string;
  url: string;
  labelAr: string;
  ok: boolean;
  httpStatus: number | null;
  itemCount: number;
  rejectedCount: number;
  error?: string;
}

export interface PublisherRssFetchResult {
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  news: RawNewsCandidate[];
  feedResults: PublisherRssFeedResult[];
  rejectedCount: number;
  error?: string;
  errorAr?: string;
}

/**
 * Fetches every configured publisher feed independently and merges the validated candidates.
 * An unreachable feed only marks itself failed — the other feeds still contribute, exactly like
 * the isolation rule the match sources follow.
 */
export async function fetchPublisherRss(options: {
  timeoutMs?: number;
  retries?: number;
  maxItemsPerFeed?: number;
  cacheTtlMs?: number;
  retryOnNetworkErrorOnly?: boolean;
  /** Wall-clock budget: feeds that would start after it are recorded as skipped, not requested. */
  budgetMs?: number;
} = {}): Promise<PublisherRssFetchResult> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();
  const feeds = resolvePublisherRssFeeds();
  const feedResults: PublisherRssFeedResult[] = [];
  const all: RawNewsCandidate[] = [];
  let lastHttp: number | null = null;
  let anyOk = false;
  let lastError: string | undefined;
  let totalRejected = 0;

  if (feeds.length === 0) {
    return {
      ok: false,
      httpStatus: null,
      latencyMs: 0,
      news: [],
      feedResults: [],
      rejectedCount: 0,
      error: 'publisher-rss-no-feeds-configured',
      errorAr: 'لا توجد خلاصات ناشر مضبوطة (NEMO_PUBLISHER_RSS_FEEDS=none).',
    };
  }

  const seen = new Set<string>();
  for (const feed of feeds) {
    if (Date.now() - startedAt >= (options.budgetMs ?? Number.POSITIVE_INFINITY)) {
      feedResults.push({
        feedId: feed.id,
        url: feed.url,
        labelAr: feed.labelAr,
        ok: false,
        httpStatus: null,
        itemCount: 0,
        rejectedCount: 0,
        error: 'skipped: time budget used',
      });
      continue;
    }
    const res = await fetchWithProtection<string>(
      feed.url,
      {
        timeoutMs: options.timeoutMs ?? 6000,
        retries: options.retries ?? 1,
        cacheTtlMs: options.cacheTtlMs ?? 10 * 60_000,
        retryOnNetworkErrorOnly: options.retryOnNetworkErrorOnly,
      },
      'text'
    );
    if (res.httpStatus) lastHttp = res.httpStatus;

    if (!res.ok || typeof res.data !== 'string') {
      lastError = res.error || `HTTP ${res.httpStatus ?? '—'}`;
      feedResults.push({
        feedId: feed.id,
        url: feed.url,
        labelAr: feed.labelAr,
        ok: false,
        httpStatus: res.httpStatus,
        itemCount: 0,
        rejectedCount: 0,
        error: lastError,
      });
      continue;
    }

    const lower = res.data.toLowerCase();
    if (!lower.includes('<rss') && !lower.includes('<feed') && !lower.includes('<item') && !lower.includes('<entry')) {
      feedResults.push({
        feedId: feed.id,
        url: feed.url,
        labelAr: feed.labelAr,
        ok: false,
        httpStatus: res.httpStatus,
        itemCount: 0,
        rejectedCount: 0,
        error: 'Response was not a valid RSS/Atom feed',
      });
      lastError = 'Response was not a valid RSS/Atom feed';
      continue;
    }

    anyOk = true;
    const parsed = parsePublisherRssXml(res.data, feed, fetchedAt, options.maxItemsPerFeed ?? 8);
    totalRejected += parsed.rejectedCount;
    for (const item of parsed.items) {
      const key = item.sourceItemId || item.link;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(item);
    }
    feedResults.push({
      feedId: feed.id,
      url: feed.url,
      labelAr: feed.labelAr,
      ok: true,
      httpStatus: res.httpStatus,
      itemCount: parsed.items.length,
      rejectedCount: parsed.rejectedCount,
    });
  }

  // Sort newest-first and drop items older than the feed window would ever show (validation
  // keeps the freshness policy itself — this is only a cheap pre-filter before ingest).
  all.sort((a, b) => Date.parse(b.publishedAt || b.fetchedAt) - Date.parse(a.publishedAt || a.fetchedAt));

  return {
    ok: anyOk,
    httpStatus: lastHttp,
    latencyMs: Date.now() - startedAt,
    news: all,
    feedResults,
    rejectedCount: totalRejected,
    error: anyOk ? undefined : lastError || 'Failed to fetch publisher RSS feeds',
    errorAr: anyOk
      ? undefined
      : 'تعذر جلب خلاصات الناشرين المباشر. تم الاحتفاظ بالأخبار المنشورة سابقًا.',
  };
}
