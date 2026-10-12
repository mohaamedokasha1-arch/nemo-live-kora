const DEFAULT_GATEWAY_ORIGIN = 'https://nemo-live-kora-matchat.vercel.app';

function asOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Prefer Vercel's configured production domain over a stale NEXT_PUBLIC fallback. Set
 * GATEWAY_SITE_URL explicitly when the production hostname is custom or changed.
 */
export const GATEWAY_SITE_URL =
  asOrigin(process.env.GATEWAY_SITE_URL) ||
  asOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
  asOrigin(process.env.NEXT_PUBLIC_GATEWAY_URL) ||
  DEFAULT_GATEWAY_ORIGIN;
