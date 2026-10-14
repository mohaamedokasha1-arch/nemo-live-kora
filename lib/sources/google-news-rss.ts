import { RawNewsCandidate } from '../types';
import {
  isDirectPublisherArticleUrl,
  isGoogleNewsUrl,
} from '../news/validate';
import { isTrustedPublisherArticleUrl } from '../news/publisher-domains';
import { collapseWhitespace, normalizeNewsUrl, stripHtml } from '../news/normalize';
import { enrichCandidates } from '../news/article-enrichment';
import {
  ResolverStrategy,
  isGoogleNewsRelayUrl,
  resolveGoogleNewsRelayUrl,
} from '../news/google-news-resolver';
import { fetchWithProtection } from './http-client';

const GOOGLE_NEWS_RSS_BASE_URL =
  process.env.GOOGLE_NEWS_RSS_BASE_URL || 'https://news.google.com/rss';
const GOOGLE_NEWS_SEARCH_URL =
  process.env.GOOGLE_NEWS_RSS_SEARCH_URL || `${GOOGLE_NEWS_RSS_BASE_URL}/search`;

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
 * The relay link is preserved in `relayUrl` so the resolver and the audit log can both see it.
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
    const enclosureMatch = block.match(/<enclosure[^>]+url="([^"]+)"[^>]*type="image/i);

    let title = collapseWhitespace(rawTitle);
    const link = collapseWhitespace(rawLink);
    const publisherUrl = sourceMatch?.[1] ? collapseWhitespace(decodeXmlEntities(sourceMatch[1])) : null;
    const publisherName = sourceMatch?.[2]
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
      imageUrl: enclosureMatch?.[1] ? decodeXmlEntities(enclosureMatch[1]) : null,
      publisherName: publisherName || 'Google News',
      publisherUrl,
      language,
      categoryAr,
      fetchedAt,
    });
  }

  return items;
}

/**
 * Resolves one candidate's link to the publisher article URL, and verifies that the resolved host
 * really belongs to the publisher named in the RSS `<source>` tag. Returns null when no strategy
 * produced a usable publisher URL — the caller then records the item as rejected with a reason.
 */
export async function resolveGoogleNewsArticleUrl(
  candidate: RawNewsCandidate,
  timeoutMs = 5000
): Promise<string | null> {
  const candidateUrl = candidate.originalUrl || candidate.link;
  if (!candidateUrl) return null;

  // Already a direct publisher URL: keep it when it is an article on that publisher's domain.
  if (!isGoogleNewsRelayUrl(candidateUrl) && !isGoogleNewsUrl(candidateUrl)) {
    const direct = isTrustedPublisherArticleUrl(candidateUrl, candidate.publisherUrl);
    return direct.ok && direct.normalized ? normalizeNewsUrl(direct.normalized) || direct.normalized : null;
  }

  const resolved = await resolveGoogleNewsRelayUrl(candidateUrl, { timeoutMs });
  if (!resolved.url) return null;

  const trusted = isTrustedPublisherArticleUrl(resolved.url, candidate.publisherUrl);
  if (!trusted.ok || !trusted.normalized) return null;
  return normalizeNewsUrl(trusted.normalized) || trusted.normalized;
}

export interface ResolutionReport {
  attempted: number;
  resolved: number;
  unresolved: number;
  strategies: Record<string, number>;
  errors: Record<string, number>;
}

function emptyResolutionReport(): ResolutionReport {
  return { attempted: 0, resolved: 0, unresolved: 0, strategies: {}, errors: {} };
}

/**
 * Resolves the relay links of the first `maxResolved` candidates (bounded, small concurrency) and
 * returns the full list — resolved items first, unresolved ones kept so rejection accounting in
 * the admin log stays truthful instead of silently dropping rows.
 */
export async function resolveFeedArticleUrls(
  candidates: RawNewsCandidate[],
  options: { maxResolved?: number; concurrency?: number; timeoutMs?: number } = {}
): Promise<{ candidates: RawNewsCandidate[]; report: ResolutionReport }> {
  const maxResolved = options.maxResolved ?? 10;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const timeoutMs = options.timeoutMs ?? 5000;
  const report = emptyResolutionReport();

  const targets = candidates.slice(0, maxResolved);
  const rest = candidates.slice(maxResolved);
  const resolved: RawNewsCandidate[] = [];

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const settled = await Promise.all(
      batch.map(async (candidate) => {
        report.attempted += 1;
        if (!isGoogleNewsRelayUrl(candidate.originalUrl || candidate.link)) {
          // A feed that already hands us the publisher URL needs no resolution.
          const direct = isDirectPublisherArticleUrl(
            candidate.originalUrl || candidate.link,
            candidate.publisherUrl
          );
          if (direct) {
            report.resolved += 1;
            report.strategies.direct = (report.strategies.direct || 0) + 1;
            return candidate;
          }
          report.unresolved += 1;
          report.errors.not_a_relay_url = (report.errors.not_a_relay_url || 0) + 1;
          return candidate;
        }

        const resolution = await resolveGoogleNewsRelayUrl(candidate.originalUrl || candidate.link, {
          timeoutMs,
        });
        const strategy: ResolverStrategy | null = resolution.strategy;
        if (resolution.url) {
          const trusted = isTrustedPublisherArticleUrl(resolution.url, candidate.publisherUrl);
          if (trusted.ok && trusted.normalized) {
            const finalUrl = normalizeNewsUrl(trusted.normalized) || trusted.normalized;
            report.resolved += 1;
            report.strategies[strategy || 'unknown'] = (report.strategies[strategy || 'unknown'] || 0) + 1;
            return { ...candidate, link: finalUrl, originalUrl: finalUrl };
          }
          report.unresolved += 1;
          const reason = `publisher_mismatch:${trusted.reason}`;
          report.errors[reason] = (report.errors[reason] || 0) + 1;
          return candidate;
        }
        report.unresolved += 1;
        const reason = resolution.error || 'unknown';
        report.errors[reason] = (report.errors[reason] || 0) + 1;
        return candidate;
      })
    );
    resolved.push(...settled);
  }

  return { candidates: [...resolved, ...rest], report };
}

/** Feeds fetched on every news sync. Egyptian coverage first, then international. */
export const NEWS_FEEDS: Array<{
  query: string;
  hl: 'ar' | 'en';
  gl: string;
  categoryAr: string;
  labelAr: string;
}> = [
  {
    query: 'الدوري المصري',
    hl: 'ar',
    gl: 'EG',
    categoryAr: 'الدوري المصري الممتاز',
    labelAr: 'الدوري المصري',
  },
  {
    query: 'الأهلي OR الزمالك',
    hl: 'ar',
    gl: 'EG',
    categoryAr: 'الأندية المصرية',
    labelAr: 'الأهلي والزمالك',
  },
  {
    query: 'منتخب مصر',
    hl: 'ar',
    gl: 'EG',
    categoryAr: 'منتخب مصر',
    labelAr: 'منتخب مصر',
  },
  {
    query: 'كورة مصر أخبار',
    hl: 'ar',
    gl: 'EG',
    categoryAr: 'الكرة المصرية',
    labelAr: 'الكرة المصرية',
  },
  {
    query: 'Egyptian Premier League',
    hl: 'en',
    gl: 'EG',
    categoryAr: 'تغطية دولية — الكرة المصرية',
    labelAr: 'التغطية الدولية للدوري المصري',
  },
  {
    query: 'الدوري المصري الممتاز',
    hl: 'ar',
    gl: 'EG',
    categoryAr: 'الدوري المصري الممتاز',
    labelAr: 'ترتيب ونتائج الدوري المصري',
  },
  {
    query: 'كأس مصر',
    hl: 'ar',
    gl: 'EG',
    categoryAr: 'كأس مصر',
    labelAr: 'كأس مصر',
  },
  {
    query: 'بيراميدز OR الإسماعيلي OR المصري البورسعيدي',
    hl: 'ar',
    gl: 'EG',
    categoryAr: 'الأندية المصرية',
    labelAr: 'أندية الدوري المصري',
  },
  {
    query: 'دوري أبطال أفريقيا',
    hl: 'ar',
    gl: 'EG',
    categoryAr: 'البطولات الأفريقية',
    labelAr: 'دوري أبطال أفريقيا',
  },
  {
    query: 'الدوري السعودي OR كأس العالم للأندية',
    hl: 'ar',
    gl: 'EG',
    categoryAr: 'الكرة العربية والعالمية',
    labelAr: 'الكرة العربية والعالمية',
  },
  {
    query: 'Champions League OR Premier League',
    hl: 'ar',
    gl: 'EG',
    categoryAr: 'الكرة العالمية',
    labelAr: 'الكرة العالمية',
  },
];

export function buildGoogleNewsFeedUrl(feed: { query: string; hl: string; gl: string }): string {
  const params = new URLSearchParams({ q: feed.query, hl: feed.hl, gl: feed.gl, ceid: `${feed.gl}:${feed.hl}` });
  return `${GOOGLE_NEWS_SEARCH_URL}?${params.toString()}`;
}

export interface GoogleNewsFetchResult {
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  news: RawNewsCandidate[];
  error?: string;
  errorAr?: string;
  /** How many relay links were turned into real publisher article URLs. */
  resolvedCount: number;
  /** How many items now carry a publisher-derived excerpt instead of a headline echo. */
  enrichedCount: number;
  resolution: ResolutionReport;
  feedResults: Array<{
    url: string;
    labelAr: string;
    ok: boolean;
    httpStatus: number | null;
    itemCount: number;
    error?: string;
  }>;
}

/**
 * Fetches Arabic & English football news from Google News RSS, resolves every relay link to its
 * publisher article, and enriches a bounded number of items with the publisher's own summary.
 */
export async function fetchGoogleNewsRss(options: {
  timeoutMs?: number;
  retries?: number;
  limitFeeds?: number;
  /**
   * موضع البداية داخل قائمة المجموعات — يتيح **تدوير** المجموعات في التحديث السريع
   * عند الطلب (الذي يقرأ مجموعة واحدة فقط للبقاء داخل ميزانية زمن قصيرة)، فلا
   * تُهمَّل مجموعة بعينها ويتجدّد المحتوى من كل المصادر خلال ساعات اليوم.
   */
  feedOffset?: number;
  /** Relay links to resolve per feed. Raise for a full daily crawl. */
  maxResolvedPerFeed?: number;
  /** Publisher pages to read for a real excerpt (bounded to stay inside a cron budget). */
  enrichmentLimit?: number;
} = {}): Promise<GoogleNewsFetchResult> {
  const fetchedAt = new Date().toISOString();
  const timeoutMs = options.timeoutMs ?? 8000;
  const retries = options.retries ?? 1;
  const totalFeeds = NEWS_FEEDS.length;
  const requestedCount = Math.min(options.limitFeeds || totalFeeds, totalFeeds);
  const startIndex =
    totalFeeds === 0
      ? 0
      : ((Math.trunc(options.feedOffset || 0) % totalFeeds) + totalFeeds) % totalFeeds;
  // نافذة دائرية: تقرأ `requestedCount` مجموعة بدءًا من موضع البداية مع الالتفاف عند النهاية.
  const feeds = Array.from(
    { length: requestedCount },
    (_, index) => NEWS_FEEDS[(startIndex + index) % totalFeeds]
  ).filter((feed): feed is (typeof NEWS_FEEDS)[number] => Boolean(feed));
  const enrichmentEnabled =
    (process.env.NEMO_NEWS_ENRICH || 'on').trim().toLowerCase() !== 'off';

  const allItems: RawNewsCandidate[] = [];
  const feedResults: GoogleNewsFetchResult['feedResults'] = [];
  const totals = emptyResolutionReport();
  let anyOk = false;
  let lastHttp: number | null = null;
  let totalLatency = 0;
  let lastErr: string | undefined;

  for (const feed of feeds) {
    const url = buildGoogleNewsFeedUrl(feed);
    const res = await fetchWithProtection<string>(
      url,
      { timeoutMs, retries, cacheTtlMs: 10 * 60_000 },
      'text'
    );
    totalLatency += res.latencyMs;
    if (res.httpStatus) lastHttp = res.httpStatus;

    if (res.ok && typeof res.data === 'string') {
      const lower = res.data.toLowerCase();
      if (!lower.includes('<rss') && !lower.includes('<item>')) {
        feedResults.push({
          url,
          labelAr: feed.labelAr,
          ok: false,
          httpStatus: res.httpStatus,
          itemCount: 0,
          error: 'Response was not a valid RSS feed',
        });
        lastErr = 'Response was not a valid RSS feed';
        continue;
      }
      anyOk = true;
      const parsed = parseGoogleNewsRssXml(res.data, feed.hl, feed.categoryAr, fetchedAt);
      const resolution = await resolveFeedArticleUrls(parsed.slice(0, 20), {
        maxResolved: options.maxResolvedPerFeed ?? 10,
        timeoutMs: 5000,
      });
      totals.attempted += resolution.report.attempted;
      totals.resolved += resolution.report.resolved;
      totals.unresolved += resolution.report.unresolved;
      for (const [key, value] of Object.entries(resolution.report.strategies)) {
        totals.strategies[key] = (totals.strategies[key] || 0) + value;
      }
      for (const [key, value] of Object.entries(resolution.report.errors)) {
        totals.errors[key] = (totals.errors[key] || 0) + value;
      }
      allItems.push(...resolution.candidates);
      feedResults.push({
        url,
        labelAr: feed.labelAr,
        ok: true,
        httpStatus: res.httpStatus,
        itemCount: parsed.length,
      });
    } else {
      lastErr = res.error;
      feedResults.push({
        url,
        labelAr: feed.labelAr,
        ok: false,
        httpStatus: res.httpStatus,
        itemCount: 0,
        error: res.error,
      });
    }
  }

  // Deduplicate across feeds: the same story appears in several queries.
  const seen = new Set<string>();
  const deduped = allItems.filter((item) => {
    const key = `${item.sourceItemId || ''}::${item.link}::${item.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Pull the publisher's own summary for a bounded set of resolved items so the site shows real
  // content instead of a repeated headline.
  let enrichedCount = 0;
  if (enrichmentEnabled && deduped.length > 0) {
    const targets = deduped.filter((item) => !isGoogleNewsUrl(item.link));
    const enriched = await enrichCandidates(targets, {
      limit: options.enrichmentLimit ?? 6,
      concurrency: 3,
      timeoutMs: 7000,
    });
    for (let i = 0; i < deduped.length; i += 1) {
      const found = enriched.get(deduped[i].link);
      if (!found?.ok) continue;
      const current = deduped[i];
      deduped[i] = {
        ...current,
        excerpt: found.excerpt && found.excerpt.length > (current.excerpt?.length || 0) ? found.excerpt : current.excerpt,
        imageUrl: current.imageUrl || found.imageUrl,
        publishedAt: current.publishedAtKnown ? current.publishedAt : found.publishedAt,
        publishedAtKnown: current.publishedAtKnown || Boolean(found.publishedAt),
      };
      if (found.excerpt) enrichedCount += 1;
    }
  }

  return {
    ok: anyOk,
    httpStatus: lastHttp,
    latencyMs: totalLatency,
    news: deduped,
    error: anyOk ? undefined : lastErr || 'Failed to fetch Google News RSS',
    errorAr: anyOk
      ? undefined
      : 'تعذر جلب خلاصة Google News RSS. تم الاحتفاظ بالأخبار المنشورة سابقًا.',
    resolvedCount: totals.resolved,
    enrichedCount,
    resolution: totals,
    feedResults,
  };
}
