export interface FetchWithProtectionOptions {
  timeoutMs?: number;
  retries?: number;
  cacheTtlMs?: number;
  headers?: Record<string, string>;
}

export interface ProtectedFetchResult<T> {
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  data: T | null;
  rawText?: string;
  fromCache: boolean;
  error?: string;
}

interface CacheBucket {
  expiresAt: number;
  httpStatus: number;
  rawText: string;
}

const memoryCache = new Map<string, CacheBucket>();
const lastRequestByHost = new Map<string, number>();

/**
 * Performs an HTTP GET with timeout, rate-limit spacing, retry with backoff, and TTL caching.
 * Never throws unhandled rejections; returns a structured ProtectedFetchResult.
 */
export async function fetchWithProtection<T = unknown>(
  url: string,
  options: FetchWithProtectionOptions = {},
  parser: 'json' | 'text' = 'json'
): Promise<ProtectedFetchResult<T>> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const retries = options.retries ?? 1;
  const cacheTtlMs = options.cacheTtlMs ?? 60_000;

  const now = Date.now();
  const cached = memoryCache.get(url);
  if (cached && cached.expiresAt > now) {
    try {
      const parsed = parser === 'json' ? (JSON.parse(cached.rawText) as T) : (cached.rawText as unknown as T);
      return {
        ok: cached.httpStatus >= 200 && cached.httpStatus < 300,
        httpStatus: cached.httpStatus,
        latencyMs: 0,
        data: parsed,
        rawText: cached.rawText,
        fromCache: true,
      };
    } catch {
      memoryCache.delete(url);
    }
  }

  let host = 'default';
  try {
    host = new URL(url).host;
  } catch {
    // ignore malformed URL host extraction
  }

  // Polite rate-limit spacing (minimum 150ms between calls to same host)
  const lastCall = lastRequestByHost.get(host) ?? 0;
  const elapsed = Date.now() - lastCall;
  if (elapsed < 150) {
    await new Promise((r) => setTimeout(r, 150 - elapsed));
  }
  lastRequestByHost.set(host, Date.now());

  let lastError = 'Unknown network error';
  let lastHttpStatus: number | null = null;
  const startMs = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: parser === 'json' ? 'application/json' : 'application/rss+xml, application/xml, text/xml',
          'User-Agent': 'NemoSportsMatchGateway/1.0 (+https://nemo-sports.vercel.app)',
          ...options.headers,
        },
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);

      lastHttpStatus = response.status;
      const rawText = await response.text();
      const latencyMs = Date.now() - startMs;

      if (response.status === 429 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }

      if (response.ok && cacheTtlMs > 0) {
        memoryCache.set(url, {
          expiresAt: Date.now() + cacheTtlMs,
          httpStatus: response.status,
          rawText,
        });
      }

      if (parser === 'text') {
        return {
          ok: response.ok,
          httpStatus: response.status,
          latencyMs,
          data: (response.ok ? rawText : null) as unknown as T,
          rawText,
          fromCache: false,
          error: response.ok ? undefined : `HTTP ${response.status}`,
        };
      }

      try {
        const parsed = JSON.parse(rawText) as T;
        return {
          ok: response.ok,
          httpStatus: response.status,
          latencyMs,
          data: parsed,
          rawText,
          fromCache: false,
          error: response.ok ? undefined : `HTTP ${response.status}`,
        };
      } catch (parseErr) {
        return {
          ok: false,
          httpStatus: response.status,
          latencyMs,
          data: null,
          rawText,
          fromCache: false,
          error: `Invalid JSON response (${(parseErr as Error).message})`,
        };
      }
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }

  return {
    ok: false,
    httpStatus: lastHttpStatus,
    latencyMs: Date.now() - startMs,
    data: null,
    fromCache: false,
    error: lastError,
  };
}
