/**
 * Publisher domain matching.
 *
 * Google News RSS never carries the publisher's article URL: `<link>` is a Google relay and
 * `<source url="...">` is the publisher's *root* URL. To decide whether a resolved link really
 * belongs to the publisher named in the feed item, the article host is compared with the
 * publisher host at the registrable-domain level (eTLD+1). An exact-host comparison rejected
 * legitimate articles served from `m.youm7.com`, `amp.dostor.org`, or a CDN alias, which is one
 * of the reasons the news pipeline published 0 articles.
 */

/**
 * Compact multi-part public suffixes. This is deliberately a subset, not the full PSL: it covers
 * the suffixes that actually appear in Arabic/Egyptian and international sports publishing. For
 * an unknown suffix the single-label rule applies, which is the correct answer for `.com`,
 * `.org`, `.net`, `.io`, `.tv`, `.news`, etc.
 */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.eg', 'net.eg', 'org.eg', 'gov.eg', 'edu.eg',
  'com.sa', 'net.sa', 'org.sa', 'gov.sa',
  'com.tr', 'net.tr', 'org.tr', 'gov.tr',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  'co.za', 'org.za', 'web.za', 'gov.za',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.mx', 'net.mx', 'org.mx', 'gob.mx',
  'com.ar', 'net.ar', 'org.ar', 'gov.ar',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'go.kr',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'co.in', 'net.in', 'org.in', 'gov.in',
  'com.pk', 'net.pk', 'org.pk',
  'com.my', 'net.my', 'org.my',
  'co.id', 'or.id', 'web.id',
  'com.ua', 'net.ua', 'org.ua',
  'com.sg', 'net.sg', 'org.sg', 'gov.sg',
  'com.hk', 'org.hk', 'gov.hk',
  'com.ng', 'org.ng', 'gov.ng',
  'co.ke', 'or.ke',
  'com.gh', 'org.gh',
  'com.ma', 'net.ma', 'org.ma',
  'com.tn', 'org.tn',
  'com.dz', 'org.dz',
  'com.ly', 'org.ly',
  'com.iq', 'org.iq',
  'com.jo', 'org.jo',
  'com.lb', 'org.lb',
  'com.kw', 'org.kw',
  'com.qa', 'org.qa',
  'com.bh', 'org.bh',
  'com.om', 'org.om',
  'com.ye', 'org.ye',
  'com.sy', 'org.sy',
  'com.ps', 'org.ps',
  'com.sd', 'org.sd',
  'com.et', 'org.et',
]);

/** Hosts that are never an article destination, whatever the feed claims. */
const BLOCKED_HOSTS = [
  'news.google.com',
  'consent.google.com',
  'accounts.google.com',
  'google.com',
  'googleusercontent.com',
  'gstatic.com',
  'facebook.com',
  'fb.watch',
  'instagram.com',
  'twitter.com',
  'x.com',
  't.co',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'bit.ly',
  'tinyurl.com',
  'linkedin.com',
  'telegram.me',
  't.me',
  'whatsapp.com',
  'wa.me',
  'apple.com',
  'play.google.com',
  'pinterest.com',
  'reddit.com',
  'discord.gg',
  'open.spotify.com',
];

/** Host suffixes that are app-store/social wrappers rather than publisher articles. */
const BLOCKED_SUFFIXES = ['.google.com', '.googleapis.com', '.doubleclick.net'];

export function isBlockedArticleHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  if (BLOCKED_HOSTS.includes(host)) return true;
  return BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Registrable domain (eTLD+1) for the suffixes this site can encounter.
 * `news.youm7.com` → `youm7.com`, `sport.almasryalyoum.com` → `almasryalyoum.com`.
 */
export function registrableDomain(hostname: string): string | null {
  const host = hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  if (!host || host.includes('..')) return null;
  const labels = host.split('.');
  if (labels.length < 2) return null;
  if (!labels.every((label) => label.length > 0 && !label.includes(' '))) return null;

  const lastTwo = labels.slice(-2).join('.');
  const lastThree = labels.slice(-3).join('.');
  if (labels.length >= 3 && MULTI_PART_SUFFIXES.has(lastTwo)) return lastThree;
  return lastTwo;
}

/** Two hosts belong to the same publisher when their registrable domains match. */
export function samePublisherHost(articleHostname: string, publisherHostname: string): boolean {
  const a = registrableDomain(articleHostname);
  const b = registrableDomain(publisherHostname);
  if (!a || !b) return false;
  return a === b;
}

export interface TrustedArticleCheck {
  ok: boolean;
  reason: 'ok' | 'not_https' | 'credentials' | 'port' | 'blocked_host' | 'no_path' | 'host_mismatch' | 'invalid_url';
  normalized: string | null;
}

/**
 * Accepts a resolved article URL only when it is a plausible article on the publisher's own
 * domain. This replaces the previous exact-host equality test that silently rejected mobile and
 * AMP mirrors of the same publisher.
 */
export function isTrustedPublisherArticleUrl(
  articleUrl: string | null | undefined,
  publisherUrl: string | null | undefined
): TrustedArticleCheck {
  if (!articleUrl) return { ok: false, reason: 'invalid_url', normalized: null };

  let article: URL;
  try {
    article = new URL(articleUrl.trim());
  } catch {
    return { ok: false, reason: 'invalid_url', normalized: null };
  }
  if (article.protocol !== 'https:' && article.protocol !== 'http:') {
    return { ok: false, reason: 'not_https', normalized: null };
  }
  if (article.username || article.password) return { ok: false, reason: 'credentials', normalized: null };
  if (article.port) return { ok: false, reason: 'port', normalized: null };
  if (isBlockedArticleHost(article.hostname)) return { ok: false, reason: 'blocked_host', normalized: null };

  const segments = article.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return { ok: false, reason: 'no_path', normalized: article.href };

  if (publisherUrl) {
    let publisher: URL;
    try {
      publisher = new URL(publisherUrl.trim());
    } catch {
      publisher = null as unknown as URL;
    }
    if (publisher && !samePublisherHost(article.hostname, publisher.hostname)) {
      return { ok: false, reason: 'host_mismatch', normalized: article.href };
    }
  }

  article.hash = '';
  return { ok: true, reason: 'ok', normalized: article.href };
}
