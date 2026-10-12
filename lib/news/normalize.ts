import { createHash } from 'crypto';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'oc',
  'fbclid',
  'gclid',
]);

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function stripHtml(value: string): string {
  return collapseWhitespace(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
  );
}

export function normalizeNewsTitle(title: string): string {
  return collapseWhitespace(title)
    .toLowerCase()
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleTokenOverlap(a: string, b: string): number {
  const ta = new Set(
    normalizeNewsTitle(a)
      .split(' ')
      .filter((token) => token.length > 1)
  );
  const tb = new Set(
    normalizeNewsTitle(b)
      .split(' ')
      .filter((token) => token.length > 1)
  );
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const token of ta) {
    if (tb.has(token)) intersection += 1;
  }
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}

export function normalizeNewsUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    const params = url.searchParams;
    for (const key of [...params.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        params.delete(key);
      }
    }
    let normalized = url.toString();
    if (normalized.endsWith('/') && url.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return null;
  }
}

export function stableNewsHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function slugifyNewsTitle(title: string): string {
  const cleaned = collapseWhitespace(title)
    .replace(/\s+/g, '-')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
  return cleaned || 'khabar';
}

export function buildNewsSlug(title: string, idTail: string): string {
  return `${slugifyNewsTitle(title)}-${idTail}`;
}
