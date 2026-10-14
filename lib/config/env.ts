/**
 * Central, validated view of every environment variable this system reads.
 *
 * Why this file exists: keys and endpoints used to be read with `process.env.X || default`
 * scattered across the source adapters. A typo, a whitespace-only value, or a key pasted with
 * quotes around it produced a silent "source connected but returned nothing" failure. Every
 * consumer now goes through this module, which trims values, strips accidental surrounding
 * quotes, and reports a machine-readable reason when a required key is absent.
 *
 * Nothing in this module ever returns a secret to the caller in a loggable form. Use
 * `describeSourceConfiguration()` for anything that may be rendered or logged.
 */

export type ConfiguredKeyState = 'configured' | 'missing' | 'placeholder';

/** Values users paste into dashboards that mean "not set yet". */
const PLACEHOLDER_VALUES = new Set([
  '',
  'changeme',
  'change_me',
  'your_api_key',
  'your-api-key',
  'xxxxxxxx',
  'xxx',
  'test',
  'key',
  'null',
  'undefined',
  'none',
  '-',
]);

/** Reads a raw env value, trimming whitespace and one layer of accidental quotes. */
export function readEnv(name: string): string {
  const raw = process.env[name];
  if (raw === undefined) return '';
  let value = raw.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

/** Reads an env value or falls back to the shipped default. */
export function readEnvOrDefault(name: string, fallback: string): string {
  return readEnv(name) || fallback;
}

/** Classifies a key so the UI can say "مضبوط" instead of pretending a placeholder is a key. */
export function keyState(name: string): ConfiguredKeyState {
  const value = readEnv(name);
  if (!value) return 'missing';
  if (PLACEHOLDER_VALUES.has(value.toLowerCase())) return 'placeholder';
  return 'configured';
}

export function hasUsableKey(name: string): boolean {
  return keyState(name) === 'configured';
}

/** Never returns the secret itself; only its length and a short masked fingerprint. */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 6) return `${'*'.repeat(value.length)}`;
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(3, value.length - 6))}${value.slice(-3)}`;
}

/* ------------------------------------------------------------------ *
 * Provider endpoints
 * ------------------------------------------------------------------ */

/**
 * Endpoint configuration, read live from the environment on every access.
 *
 * These are getters rather than a one-time snapshot: a module-level `const` freezes the value at
 * import time, so a value set later (test setup, a runtime override in a worker) was silently
 * ignored. Reading live keeps configuration and behaviour in step.
 */
export const SOURCE_ENDPOINTS = {
  /** Free public widget API — https://sportscore.com/developers/ */
  get sportscoreBase() {
    return readEnvOrDefault('SPORTSCORE_BASE_URL', 'https://sportscore.com');
  },
  /** Football-Data.org v4. `/competitions` works keyless; matches/standings need a free token. */
  get footballDataBase() {
    return readEnvOrDefault('FOOTBALL_DATA_BASE_URL', 'https://api.football-data.org/v4');
  },
  /** TheSportsDB v1 JSON API. Free test key is `123` (documented); `3` still resolves. */
  get thesportsdbBase() {
    return readEnvOrDefault('THESPORTSDB_BASE_URL', 'https://www.thesportsdb.com/api/v1/json');
  },
  get thesportsdbV2Base() {
    return readEnvOrDefault('THESPORTSDB_V2_BASE_URL', 'https://www.thesportsdb.com/api/v2/json');
  },
  /** API-Football v3 direct host. RapidAPI mirror is selected with API_FOOTBALL_HOST. */
  get apiFootballBase() {
    return readEnvOrDefault('API_FOOTBALL_BASE_URL', 'https://v3.football.api-sports.io');
  },
  get apiFootballHostHeader() {
    return readEnv('API_FOOTBALL_HOST');
  },
  get googleNewsRssBase() {
    return readEnvOrDefault('GOOGLE_NEWS_RSS_BASE_URL', 'https://news.google.com/rss');
  },
};

export interface SourceKeyConfig {
  sourceId: string;
  envVar: string;
  state: ConfiguredKeyState;
  /** Short masked fingerprint, safe to render. Empty when the key is absent. */
  fingerprint: string;
  /** Whether the source can fetch anything at all with the current configuration. */
  usable: boolean;
  /**
   * What the code will actually send at runtime. A source whose env var is `missing` is not
   * necessarily dead — TheSportsDB falls back to the documented free key — so the raw env state
   * alone would mislead an operator reading `/sources`.
   */
  effectiveAr: string;
  noteAr: string;
}

function effectiveKeyDescription(sourceId: string, state: ConfiguredKeyState, fingerprint: string): string {
  const configured = state === 'configured';
  switch (sourceId) {
    case 'thesportsdb':
      return configured
        ? `سيُجرَّب مفتاحك (${fingerprint}) أولًا ثم المفتاح المجاني 123 ثم 3 عند رفضه`
        : 'سيُستخدم المفتاح المجاني العام 123 ثم 3 — المصدر يعمل بدون إعداد';
    case 'api-football':
      return configured
        ? `سيُرسل ${readEnv('API_FOOTBALL_HOST') ? 'x-rapidapi-key عبر RapidAPI' : 'x-apisports-key مباشرة'} (${fingerprint})`
        : 'لن يُجلب شيء من هذا المصدر حتى يُضبط مفتاح (requires_api_key)';
    case 'football-data':
      return configured
        ? `سيُرسل X-Auth-Token (${fingerprint}) وتعمل مسارات المباريات والترتيب`
        : 'سيُجلب فهرس البطولات والمواسم فقط (partial_keyless) دون مباريات أو ترتيب';
    case 'sportscore':
      return configured ? `سيُرسل المفتاح الاختياري (${fingerprint})` : 'لا يحتاج مفتاحًا — يعمل مباشرة';
    case 'google-news-rss':
      return 'لا يحتاج مفتاحًا — يعمل مباشرة';
    default:
      return configured ? `سيُستخدم (${fingerprint})` : 'غير مضبوط';
  }
}

/**
 * The complete key matrix the operator needs. Rendered by `/sources` and `/api/sources` so a
 * missing key is visible in the UI instead of being discoverable only by reading lambda logs.
 */
export function describeSourceConfiguration(): SourceKeyConfig[] {
  const entries: Array<{ sourceId: string; envVar: string; optional: boolean; noteAr: string }> = [
    {
      sourceId: 'sportscore',
      envVar: 'SPORTSCORE_API_KEY',
      optional: true,
      noteAr: 'المصدر مجاني بدون مفتاح؛ المفتاح اختياري لرفع الحصة.',
    },
    {
      sourceId: 'thesportsdb',
      envVar: 'THESPORTSDB_API_KEY',
      optional: true,
      noteAr:
        'يعمل بالمفتاح المجاني العام 123. ضع مفتاحك المدفوع في THESPORTSDB_API_KEY للحصول على أكثر من نتيجة واحدة لكل نداء.',
    },
    {
      sourceId: 'football-data',
      envVar: 'FOOTBALL_DATA_API_KEY',
      optional: true,
      noteAr:
        '/v4/competitions يعمل بدون مفتاح؛ مسارات المباريات والترتيب تتطلب مفتاحًا مجانيًا من football-data.org.',
    },
    {
      sourceId: 'api-football',
      envVar: 'API_FOOTBALL_KEY',
      optional: true,
      noteAr: 'يتطلب مفتاحًا من api-sports.io أو RapidAPI لتفعيل جلب المباريات والترتيب.',
    },
    {
      sourceId: 'google-news-rss',
      envVar: 'GOOGLE_NEWS_RSS_BASE_URL',
      optional: true,
      noteAr: 'لا يحتاج مفتاحًا؛ يمكن override عنوان الخلاصة للاختبار.',
    },
  ];

  return entries.map((entry) => {
    const state = keyState(entry.envVar);
    const value = readEnv(entry.envVar);
    const fingerprint = maskSecret(value);
    return {
      sourceId: entry.sourceId,
      envVar: entry.envVar,
      state,
      fingerprint,
      usable: state !== 'placeholder',
      effectiveAr: effectiveKeyDescription(entry.sourceId, state, fingerprint),
      noteAr: entry.noteAr,
    };
  });
}

/** TheSportsDB keys to try, in order: the operator's key first, then the documented free keys. */
export function thesportsdbKeyCandidates(): string[] {
  const configured = readEnv('THESPORTSDB_API_KEY');
  const list = configured ? [configured] : [];
  for (const fallback of ['123', '3']) {
    if (!list.includes(fallback)) list.push(fallback);
  }
  return list;
}

export function apiFootballKey(): string | null {
  return hasUsableKey('API_FOOTBALL_KEY') ? readEnv('API_FOOTBALL_KEY') : null;
}

export function footballDataKey(): string | null {
  return hasUsableKey('FOOTBALL_DATA_API_KEY') ? readEnv('FOOTBALL_DATA_API_KEY') : null;
}

export function sportscoreKey(): string | null {
  return hasUsableKey('SPORTSCORE_API_KEY') ? readEnv('SPORTSCORE_API_KEY') : null;
}

/**
 * API-Football league ids we follow. `league` + `season` returns a whole competition instead of
 * a single day, which is what makes the Egyptian table complete. Override with
 * `API_FOOTBALL_EGYPT_LEAGUE_ID` if the provider ever re-numbers.
 */
export const API_FOOTBALL_LEAGUES = {
  get egyptPremierLeague() {
    return Number(readEnvOrDefault('API_FOOTBALL_EGYPT_LEAGUE_ID', '302'));
  },
  get egyptCup() {
    return Number(readEnvOrDefault('API_FOOTBALL_EGYPT_CUP_ID', '303'));
  },
  get cafChampionsLeague() {
    return Number(readEnvOrDefault('API_FOOTBALL_CAF_CL_ID', '272'));
  },
  get cafConfederationCup() {
    return Number(readEnvOrDefault('API_FOOTBALL_CAF_CONFED_ID', '273'));
  },
};

/** TheSportsDB league ids we follow, with the reason each one is or is not included. */
export const THESPORTSDB_LEAGUES = {
  get egyptianPremierLeague() {
    return readEnvOrDefault('THESPORTSDB_EGY_LEAGUE_ID', '4829');
  },
  get egyptLeagueCup() {
    return readEnvOrDefault('THESPORTSDB_EGY_LEAGUE_CUP_ID', '5185');
  },
  get cafConfederationCup() {
    return readEnvOrDefault('THESPORTSDB_CAF_CONFED_ID', '5057');
  },
  /** Documented as excluded: this id returns a baseball league in fixtures. */
  get excludedLeagueIds() {
    return readEnvOrDefault('THESPORTSDB_EXCLUDED_LEAGUE_IDS', '4830')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  },
};
