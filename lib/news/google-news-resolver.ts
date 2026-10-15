/**
 * Google News relay-link resolver.
 *
 * The RSS feed returns `<link>https://news.google.com/rss/articles/CBMi...?oc=5</link>`. That
 * relay never 302s to the publisher: it answers 200 with a JavaScript interstitial, so a plain
 * redirect-following fetch — which is what the pipeline did before — always ended on a
 * `news.google.com` URL and every item was rejected. This module resolves the real publisher URL
 * with four independent strategies, cheapest first:
 *
 *  1. `decode`        — the article id is a base64 protobuf; for the classic `CBMi<hex>` format
 *                       the publisher URL is embedded verbatim and can be read offline.
 *  2. `batchexecute`  — the post-2024 `AU_yqL…` tokens are opaque, so Google's own internal
 *                       `Fbv4je` RPC is called with the signature + timestamp served on the
 *                       relay page. This is the same RPC the relay page itself uses.
 *  3. `redirect`      — follow HTTP redirects while every hop stays on news.google.com, then
 *                       accept the first off-Google target.
 *  4. `interstitial`  — read the relay page HTML and lift the destination out of `data-n-au`,
 *                       an anchor, or a `location.replace(...)` call.
 *
 * Nothing here copies article bodies; it only determines where an item points.
 */

import { isTrustedPublisherArticleUrl } from './publisher-domains';

export type ResolverStrategy =
  | 'direct'
  | 'decode'
  | 'batchexecute'
  | 'redirect'
  | 'interstitial';

export interface ResolvedArticleUrl {
  url: string | null;
  strategy: ResolverStrategy | null;
  /** Machine-readable reason when resolution failed. */
  error: string | null;
  /**
   * Deeper failure detail for operators — why the error happened (e.g. which sub-step of the
   * interstitial path failed). Purely additive: the stable `error` code never changes.
   */
  detail?: string | null;
  /** How many network round-trips this resolution cost. */
  requests: number;
  latencyMs: number;
}

export interface ResolverOptions {
  /** Per-strategy timeout. Kept small: resolution runs inside a cron budget. */
  timeoutMs?: number;
  /** Disable network strategies (offline decoding only). Used by tests. */
  offline?: boolean;
  fetchImpl?: typeof fetch;
}

const GOOGLE_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_TIMEOUT_MS = 5000;
const REDIRECT_HOP_LIMIT = 6;
/** Never read more than this from a relay/interstitial page. */
const MAX_HTML_BYTES = 200_000;

export function isGoogleNewsRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const isGoogleNewsHost = host === 'news.google.com' || host.endsWith('.news.google.com');
    return isGoogleNewsHost && /\/(articles|read)\//.test(url.pathname);
  } catch {
    return false;
  }
}

export function isGoogleNewsHost(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'news.google.com' || host.endsWith('.news.google.com');
  } catch {
    return false;
  }
}

/** The opaque article token from a Google News relay URL (`/articles/<token>` or `/read/<token>`). */
export function extractGoogleNewsArticleId(relayUrl: string): string | null {
  try {
    const url = new URL(relayUrl);
    if (!isGoogleNewsHost(url.href)) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const markerIndex = segments.findIndex((segment) => segment === 'articles' || segment === 'read');
    if (markerIndex === -1 || markerIndex === segments.length - 1) return null;
    const token = segments[markerIndex + 1].trim();
    return token.length > 8 ? token : null;
  } catch {
    return null;
  }
}

function base64UrlDecodeToLatin1(token: string): string | null {
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (token.length % 4)) % 4);
    const binary = Buffer.from(padded, 'base64').toString('latin1');
    return binary;
  } catch {
    return null;
  }
}

/**
 * Offline decode of a classic `CBMi…` token.
 *
 * The payload is a protobuf whose first string field is the publisher URL. It is length-prefixed
 * after a `\x08\x13\x22` header, and the length prefix is a one- or two-byte varint. Newer tokens
 * carry an opaque `AU_yqL…` identifier instead of a URL; that case is reported so the caller can
 * fall through to the batchexecute strategy.
 */
export function decodeGoogleNewsArticleToken(relayUrl: string): {
  url: string | null;
  opaqueToken: string | null;
  error: string | null;
} {
  const articleId = extractGoogleNewsArticleId(relayUrl);
  if (!articleId) return { url: null, opaqueToken: null, error: 'not_a_relay_url' };

  const decoded = base64UrlDecodeToLatin1(articleId);
  if (!decoded) return { url: null, opaqueToken: null, error: 'base64_decode_failed' };

  let body = decoded;
  if (body.startsWith('\x08\x13\x22')) body = body.slice(3);
  if (body.endsWith('\xd2\x01\x00')) body = body.slice(0, -3);
  if (body.length === 0) return { url: null, opaqueToken: null, error: 'empty_payload' };

  const firstByte = body.charCodeAt(0);
  if (firstByte > 0 && firstByte < 0x80) {
    const candidate = body.slice(1, 1 + firstByte);
    const extracted = extractUrlPrefix(candidate);
    if (extracted) return { url: extracted, opaqueToken: null, error: null };
  } else if (firstByte >= 0x80) {
    const candidate = body.slice(2, firstByte + 1);
    const extracted = extractUrlPrefix(candidate);
    if (extracted) return { url: extracted, opaqueToken: null, error: null };
  }

  // Fallback: scan the payload for any embedded http(s) URL.
  const scanned = scanForHttpUrl(decoded);
  if (scanned) return { url: scanned, opaqueToken: null, error: null };

  const opaqueMatch = decoded.match(/AU_yqL[0-9A-Za-z_\-]+/);
  if (opaqueMatch) return { url: null, opaqueToken: opaqueMatch[0], error: 'opaque_token' };

  return { url: null, opaqueToken: null, error: 'no_url_in_payload' };
}

function extractUrlPrefix(value: string): string | null {
  const match = value.match(/^https?:\/\/[^\x00-\x1f\x7f-\xff]+/);
  if (!match) return null;
  const url = match[0];
  return url.length > 12 ? url : null;
}

function scanForHttpUrl(value: string): string | null {
  const match = value.match(/https?:\/\/[^\x00-\x1f\x7f-\xff\xd2]+/);
  if (!match) return null;
  const url = match[0];
  return url.length > 12 ? url : null;
}

async function readBodyCapped(response: Response, maxBytes = MAX_HTML_BYTES): Promise<string> {
  try {
    const text = await response.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  } catch {
    return '';
  }
}

/** Strategy 2: Google's internal Fbv4je RPC, using the signature/timestamp from the relay page. */
export async function resolveViaBatchExecute(
  articleId: string,
  options: { timeoutMs: number; fetchImpl: typeof fetch }
): Promise<{ url: string | null; error: string }> {
  const relayPage = `https://news.google.com/rss/articles/${articleId}`;
  let html = '';
  try {
    const response = await options.fetchImpl(relayPage, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; NemoSportsNewsResolver/1.0)',
      },
      signal: AbortSignal.timeout(options.timeoutMs),
      cache: 'no-store',
    });
    if (!response.ok) return { url: null, error: `relay_page_http_${response.status}` };
    html = await readBodyCapped(response);
  } catch (error) {
    return { url: null, error: `relay_page_failed:${(error as Error).message}` };
  }

  const params = extractBatchExecuteParams(html);
  if (!params) return { url: null, error: 'decoding_params_not_found' };

  const request =
    '[[["Fbv4je","[\\"garturlreq\\",[[\\"en-US\\",\\"US\\",[\\"FINANCE_TOP_INDICES\\",\\"WEB_TEST_1_0_0\\"],' +
    'null,null,1,1,\\"US:en\\",null,180,null,null,null,null,null,0,null,null,[1608992183,723341000]],' +
    '\\"en-US\\",\\"US\\",1,[2,3,4,8],1,0,\\"655000234\\",0,0,null,0],\\"' +
    articleId +
    '\\"","' +
    params.signature +
    '",' +
    params.timestamp +
    ']",null,"generic"]]]';

  try {
    const response = await options.fetchImpl(
      'https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Referer: 'https://news.google.com/',
          'User-Agent': 'Mozilla/5.0 (compatible; NemoSportsNewsResolver/1.0)',
        },
        body: `f.req=${encodeURIComponent(request)}`,
        signal: AbortSignal.timeout(options.timeoutMs),
        cache: 'no-store',
      }
    );
    if (!response.ok) return { url: null, error: `batchexecute_http_${response.status}` };
    const text = await readBodyCapped(response);
    const decoded = parseBatchExecuteResponse(text);
    return decoded ? { url: decoded, error: '' } : { url: null, error: 'batchexecute_no_url' };
  } catch (error) {
    return { url: null, error: `batchexecute_failed:${(error as Error).message}` };
  }
}

/**
 * The relay page embeds `AF_initDataCallback({key: 'ds:0' … })`; the array after
 * `[null,null,"` holds `signature","timestamp`. Google has moved the payload between `ds:N`
 * keys, so any `AF_initDataCallback` block is searched, not only `ds:0`. Exported for unit tests.
 */
export function extractBatchExecuteParams(html: string): { signature: string; timestamp: string } | null {
  const callbackMatch = html.match(/AF_initDataCallback\(\{key:\s*'ds:\d+'/);
  const callbackIndex = callbackMatch ? (callbackMatch.index as number) : -1;
  const scoped = callbackIndex >= 0 ? html.slice(callbackIndex) : html;
  const marker = scoped.indexOf('[null,null,"');
  if (marker === -1) return null;
  const rest = scoped.slice(marker + '[null,null,"'.length);
  // The bootstrap array holds …,"<signature>","<timestamp>"…; split on the quote-comma-quote
  // separator and take the first quoted run of each field.
  const parts = rest.split('","');
  if (parts.length < 2) return null;
  const signature = parts[0].replace(/\\"/g, '"').trim();
  const timestamp = parts[1].split('"')[0].replace(/\\"/g, '"').trim();
  if (!signature || !timestamp) return null;
  return { signature, timestamp };
}

/**
 * batchexecute replies with `)]}'\n<json>`. The decoded payload is a JSON string whose parsed
 * array carries the URL at index 1 (`[null,"https://…"]`). Google has shipped this inside two
 * and three levels of array nesting, so the payload is located by shape instead of by a fixed
 * index — an envelope change must not silently break news resolution.
 */
export function parseBatchExecuteResponse(text: string): string | null {
  const cleaned = text.replace(/^\)\]\}'\s*\n?/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  const structural = findDecodedUrl(parsed, 0);
  if (structural) return structural;
  // Shape fallback (matches how public decoders read the RPC): the destination is the first
  // absolute URL in the payload, `\/` unescaped. Google hosts can never win here because the
  // caller re-validates against the publisher-domains trust check.
  const scanned = cleaned.replace(/\\+\//g, '/').match(/https?:\/\/[^"'\\<>\s]{20,}/);
  if (!scanned) return null;
  const candidate = scanned[0];
  let hostname = '';
  try {
    hostname = new URL(candidate).hostname;
  } catch {
    return null;
  }
  if (isGoogleNewsHost(candidate) || /(google|gstatic|doubleclick)/.test(hostname)) return null;
  return candidate.length > 12 ? candidate : null;
}

function findDecodedUrl(node: unknown, depth: number): string | null {
  if (depth > 6 || node === null || node === undefined) return null;
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const inner = JSON.parse(trimmed) as unknown[];
        const url = Array.isArray(inner) ? inner[1] : null;
        if (typeof url === 'string' && /^https?:\/\//.test(url)) return url;
      } catch {
        /* not the payload; keep walking */
      }
    }
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findDecodedUrl(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Strategy 4: lift the destination out of the relay interstitial HTML. */
export function extractUrlFromInterstitialHtml(html: string): string | null {
  const patterns = [
    /data-n-au="([^"]+)"/i,
    /data-n-au='([^']+)'/i,
    /<a[^>]+href="(https?:\/\/(?!news\.google\.com|accounts\.google\.com|consent\.google\.com)[^"]+)"/i,
    /location\.replace\(\s*"(https?:\/\/[^"]+)"\s*\)/i,
    /location\.href\s*=\s*"(https?:\/\/[^"]+)"/i,
    /window\.location\s*=\s*"(https?:\/\/[^"]+)"/i,
    /<meta[^>]+property="og:url"[^>]+content="(https?:\/\/[^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const candidate = match[1]
      .replace(/\\u003d/g, '=')
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&');
    if (/^https?:\/\//.test(candidate) && !isGoogleNewsHost(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolves a Google News relay link to the publisher article URL.
 * Returns `{ url: null, error }` instead of throwing; the caller records the reason.
 */
export async function resolveGoogleNewsRelayUrl(
  relayUrl: string,
  options: ResolverOptions = {}
): Promise<ResolvedArticleUrl> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl || fetch;
  let requests = 0;
  let detail: string | null = null;
  const finish = (url: string | null, strategy: ResolverStrategy | null, error: string | null): ResolvedArticleUrl => ({
    url,
    strategy,
    error,
    detail,
    requests,
    latencyMs: Date.now() - startedAt,
  });

  // 1) Offline protobuf decode — no network, always tried first.
  const decoded = decodeGoogleNewsArticleToken(relayUrl);
  if (decoded.url) {
    const check = isTrustedPublisherArticleUrl(decoded.url, null);
    if (check.ok && check.normalized) return finish(check.normalized, 'decode', null);
  }

  if (options.offline) {
    return finish(null, null, decoded.error || 'offline_and_undecodable');
  }

  const articleId = extractGoogleNewsArticleId(relayUrl);

  // 2) Opaque AU_yqL token → Google's own decoding RPC.
  if (decoded.opaqueToken && articleId) {
    requests += 1;
    const viaRpc = await resolveViaBatchExecute(articleId, { timeoutMs, fetchImpl });
    if (viaRpc.url) {
      const check = isTrustedPublisherArticleUrl(viaRpc.url, null);
      if (check.ok && check.normalized) return finish(check.normalized, 'batchexecute', null);
    } else {
      detail = `opaque_rpc:${viaRpc.error || 'no_url'}`;
    }
  }

  // 3) HTTP redirect chain, hop by hop, only while every hop stays on news.google.com.
  try {
    let currentUrl = relayUrl;
    for (let hop = 0; hop < REDIRECT_HOP_LIMIT; hop += 1) {
      requests += 1;
      const response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; NemoSportsNewsResolver/1.0)',
        },
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
      const location = response.headers.get('location');
      const isRedirect = GOOGLE_REDIRECT_STATUSES.has(response.status);

      if (isRedirect && location) {
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return finish(null, null, 'invalid_redirect_location');
        }
        if (nextUrl.username || nextUrl.password) return finish(null, null, 'redirect_with_credentials');
        if (!isGoogleNewsHost(nextUrl.href)) {
          const check = isTrustedPublisherArticleUrl(nextUrl.href, null);
          try {
            await response.body?.cancel();
          } catch {
            /* body intentionally not stored */
          }
          return check.ok && check.normalized
            ? finish(check.normalized, 'redirect', null)
            : finish(null, null, `redirect_target_rejected:${check.reason}`);
        }
        currentUrl = nextUrl.href;
        try {
          await response.body?.cancel();
        } catch {
          /* body intentionally not stored */
        }
        continue;
      }

      // 4) 200 + interstitial HTML.
      if (response.status >= 200 && response.status < 300) {
        const html = await readBodyCapped(response);
        const extracted = extractUrlFromInterstitialHtml(html);
        if (extracted) {
          const check = isTrustedPublisherArticleUrl(extracted, null);
          if (check.ok && check.normalized) return finish(check.normalized, 'interstitial', null);
        }
        // The RPC path also works from the interstitial's own decoding parameters.
        if (articleId) {
          const params = extractBatchExecuteParams(html);
          if (params) {
            requests += 1;
            const viaRpc = await resolveViaBatchExecute(articleId, { timeoutMs, fetchImpl });
            if (viaRpc.url) {
              const check = isTrustedPublisherArticleUrl(viaRpc.url, null);
              if (check.ok && check.normalized) return finish(check.normalized, 'batchexecute', null);
            }
            detail = detail ? `${detail};relay_rpc:${viaRpc.error || 'no_url'}` : `relay_rpc:${viaRpc.error || 'no_url'}`;
          } else {
            detail = detail
              ? `${detail};relay_params_not_found`
              : 'relay_params_not_found';
          }
        }
        return finish(null, null, 'interstitial_without_destination');
      }

      return finish(null, null, `unexpected_http_${response.status}`);
    }
    return finish(null, null, 'redirect_loop');
  } catch (error) {
    return finish(null, null, `network:${(error as Error).message}`);
  }
}
