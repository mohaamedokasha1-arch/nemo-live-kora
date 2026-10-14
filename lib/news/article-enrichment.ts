/**
 * Article enrichment.
 *
 * Google News RSS descriptions are usually just the headline repeated, so an item that passes
 * every validation rule still had no real content to show. This module fetches the *resolved
 * publisher URL* (never the Google relay) and lifts the publisher's own metadata: `<title>`,
 * `meta[name=description]`, `og:description`, `og:image`, and the first paragraphs of body copy.
 *
 * Only a short excerpt is stored — enough to present and index the item, not a copy of the
 * article. The canonical link always points at the publisher, and the publisher is credited.
 */

const MAX_HTML_BYTES = 300_000;
const MAX_EXCERPT_CHARS = 600;
const MIN_EXCERPT_CHARS = 160;

export interface EnrichedArticle {
  ok: boolean;
  /** The publisher's own headline, when it has one. */
  title: string | null;
  /** Publisher-supplied summary, or the first paragraphs of the article. */
  excerpt: string | null;
  imageUrl: string | null;
  publisherName: string | null;
  publishedAt: string | null;
  httpStatus: number | null;
  latencyMs: number;
  error?: string;
}

const EMPTY_RESULT: Omit<EnrichedArticle, 'latencyMs'> = {
  ok: false,
  title: null,
  excerpt: null,
  imageUrl: null,
  publisherName: null,
  publishedAt: null,
  httpStatus: null,
};

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html: string, selectors: RegExp[]): string | null {
  for (const pattern of selectors) {
    const match = html.match(pattern);
    const value = match?.[1] || match?.[2];
    if (!value) continue;
    const cleaned = decodeEntities(value);
    if (cleaned.length >= 40) return cleaned;
  }
  return null;
}

/** Strips boilerplate (scripts, styles, nav) before extracting paragraphs. */
function stripBoilerplate(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

/**
 * First meaningful paragraphs of body copy. Used when the publisher exposes no meta description.
 * Short paragraphs (navigation crumbs, "read more" links) are skipped.
 */
export function extractBodyExcerpt(html: string, minChars = MIN_EXCERPT_CHARS): string | null {
  const body = stripBoilerplate(html);
  const paragraphs = body
    .match(/<p[^>]*>([\s\S]*?)<\/p>/gi)
    ?.map((block) => decodeEntities(block))
    .filter((text) => text.length >= 60)
    .filter((text) => !/^(اقرأ أيضًا|اقرأ ايضًا|read more|click here|تابعنا)/i.test(text))
    .filter((text) => !/^\s*\d+\s*[-–]\s*\d+\s*$/.test(text));
  if (!paragraphs || paragraphs.length === 0) return null;

  let excerpt = '';
  for (const paragraph of paragraphs) {
    excerpt = excerpt ? `${excerpt} ${paragraph}` : paragraph;
    if (excerpt.length >= minChars) break;
  }
  if (excerpt.length < minChars) return null;
  return excerpt.length > MAX_EXCERPT_CHARS ? `${excerpt.slice(0, MAX_EXCERPT_CHARS - 1).trimEnd()}…` : excerpt;
}

function extractIsoDate(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']publish-date["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const parsed = new Date(match[1]);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

export interface EnrichOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Fetches one publisher article and extracts presentation metadata.
 * Never throws; a failed fetch returns `{ ok: false }` and the caller keeps the RSS values.
 */
export async function enrichArticleFromPublisher(
  articleUrl: string,
  options: EnrichOptions = {}
): Promise<EnrichedArticle> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 7000;
  const fetchImpl = options.fetchImpl || fetch;

  try {
    const response = await fetchImpl(articleUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar,en;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (compatible; NemoSportsNewsBot/1.0; +https://nemo-live-kora.vercel.app/bot)',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });

    if (!response.ok) {
      return { ...EMPTY_RESULT, httpStatus: response.status, latencyMs: Date.now() - startedAt, error: `http_${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/html|xml/i.test(contentType)) {
      return { ...EMPTY_RESULT, httpStatus: response.status, latencyMs: Date.now() - startedAt, error: 'not_html' };
    }

    const full = await response.text();
    const html = full.length > MAX_HTML_BYTES ? full.slice(0, MAX_HTML_BYTES) : full;

    const title =
      metaContent(html, [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      ]) ||
      (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ? decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]).slice(0, 200)
        : null);

    const description = metaContent(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
    ]);

    const bodyExcerpt = extractBodyExcerpt(html);
    const excerpt = description && description.length >= MIN_EXCERPT_CHARS ? description : bodyExcerpt || description;

    const imageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
      || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    let imageUrl: string | null = imageMatch?.[1] ? decodeEntities(imageMatch[1]) : null;
    if (imageUrl) {
      try {
        imageUrl = new URL(imageUrl, articleUrl).href;
        if (!/^https?:$/.test(new URL(imageUrl).protocol)) imageUrl = null;
      } catch {
        imageUrl = null;
      }
    }

    const publisherMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);

    const latencyMs = Date.now() - startedAt;
    if (!excerpt && !title) {
      return { ...EMPTY_RESULT, httpStatus: response.status, latencyMs, error: 'no_extractable_content' };
    }

    return {
      ok: true,
      title: title || null,
      excerpt: excerpt || null,
      imageUrl,
      publisherName: publisherMatch?.[1] ? decodeEntities(publisherMatch[1]) : null,
      publishedAt: extractIsoDate(html),
      httpStatus: response.status,
      latencyMs,
    };
  } catch (error) {
    return { ...EMPTY_RESULT, latencyMs: Date.now() - startedAt, error: `fetch_failed:${(error as Error).message}` };
  }
}

/**
 * Runs enrichment over a bounded number of candidates, with a small concurrency limit so a cron
 * run cannot fan out into dozens of simultaneous publisher requests.
 */
export async function enrichCandidates<T extends { link: string; excerpt: string | null; imageUrl: string | null }>(
  candidates: T[],
  options: EnrichOptions & { limit?: number; concurrency?: number } = {}
): Promise<Map<string, EnrichedArticle>> {
  const limit = options.limit ?? 6;
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const targets = candidates.slice(0, limit);
  const results = new Map<string, EnrichedArticle>();

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const settled = await Promise.all(
      batch.map(async (candidate) => {
        const enriched = await enrichArticleFromPublisher(candidate.link, options);
        return [candidate.link, enriched] as const;
      })
    );
    for (const [link, enriched] of settled) results.set(link, enriched);
  }
  return results;
}

export const ENRICHMENT_LIMITS = { MAX_EXCERPT_CHARS, MIN_EXCERPT_CHARS };
