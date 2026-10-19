import { after } from 'next/server';
import { google, type indexing_v3 } from 'googleapis';
import { hasUsableKey, readEnv } from '@/lib/config/env';
import { matchContentFingerprint } from '@/lib/db/store';
import { GATEWAY_SITE_URL } from '@/lib/site-url';
import { buildMatchLandingPath } from '@/lib/matches/match-links';
import { isIndexableNewsArticle } from '@/lib/news/validate';
import type { MatchRecord, NewsItemRecord } from '@/lib/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Google Indexing API — إشعار فوري بصفحات المباريات والأخبار الجديدة/المحدَّثة
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  الهدف: أول ما مباراة أو خبر «يتسيف أو يتحدّث» فعلًا في المخزن (من مزامنة مجدولة
 *  أو حفظ يدوي من لوحة الإدارة)، يُرسَل عنوان صفحته إلى Google Indexing API بنوع
 *  **URL_UPDATED** في الخلفية، فيزحف Google إلى النسخة الجديدة في دقائق بدلًا من
 *  انتظار الدورة الدورية لخريطة الموقع. وعند حذف صفحة يدوية يُرسَل **URL_DELETED**
 *  حتى تُسقَط من الفهرس بدل أن تبقى رابطًا ميتًا.
 *
 *  الإعداد (Vercel → Environment Variables):
 *    • GOOGLE_CLIENT_EMAIL — بريد حساب الخدمة (Service Account) من Google Cloud،
 *      ويجب إضافته «مالكًا» للموقع في Search Console وإلا ردّت الواجهة 403.
 *    • GOOGLE_PRIVATE_KEY  — المفتاح الخاص للحساب. يُقبَل بأسطره الحقيقية أو بصيغة
 *      \n المهرّبة (الصيغتان تُطبَّعان إلى شكل واحد قبل الاستخدام).
 *    • GOOGLE_INDEXING_MAX_URLS_PER_RUN — سقف الروابط في الجولة الواحدة
 *      (افتراضي 50) حمايةً للحصة اليومية الافتراضية للواجهة (~200 طلب/يوم).
 *    • GOOGLE_INDEXING_ENABLED=off — مفتاح إيقاف كلي لحظي بلا تعديل كود.
 *
 *  مبادئ ملزمة لهذه الطبقة:
 *   ① لا نجاح وهمي ولا فشل مُسقط: كل رابط يُحاسَب صراحةً (نجح/فشل/تخطّته الحصة)،
 *     والدالة لا ترمي استثناءً أبدًا فلا تُسقط مزامنةً ولا حفظًا من لوحة الإدارة.
 *   ② لا استهلاك للحصة على ما لم يتغيّر: المقارنة تستخدم بصمة المحتوى نفسها التي
 *     يفرّق بها المخزن بين «محدَّث» و«لم يتغيّر» (matchContentFingerprint)،
 *     وحقول النبضة (lastUpdatedAt / lastSyncedAt) مستبعدة من المقارنة.
 *   ③ الإرسال في الخلفية: تُستدعى الدالة داخل after() من next/server في مسارات
 *     الطلبات، فتُرسَل الإجابة فورًا وتكتمل الإشعارات قبل إنهاء نسخة الدالة.
 *   ④ لا أسرار في السجلات: لا يُطبع المفتاح الخاص ولا بريد الحساب كاملًا.
 */

export type IndexingNotificationType = 'URL_UPDATED' | 'URL_DELETED';

export interface IndexingUrlFailure {
  url: string;
  error: string;
}

export interface GoogleIndexingSummary {
  /** هل متغيرا البيئة مضبوطان والمفتاح غير مُوقِف؟ بلا ذلك لا تُجرى أي مكالمة شبكية. */
  configured: boolean;
  type: IndexingNotificationType;
  /** روابط صالحة دخلت الإرسال فعلًا (بعد التطبيع وإزالة التكرار وسقف الحصة). */
  attempted: number;
  succeeded: number;
  failed: number;
  /** روابط صالحة لم تُرسل في هذه الجولة بسبب سقف الحصة — تُلتقط في الجولات التالية عبر خريطة الموقع. */
  skippedByQuota: number;
  /** مدخلات تعذّر تحويلها إلى رابط صالح فأُسقطت قبل أي مكالمة. */
  invalid: number;
  failures: IndexingUrlFailure[];
}

export type IndexingUrlPublisher = (
  url: string,
  type: IndexingNotificationType
) => Promise<void>;

export interface NotifyGoogleIndexingOptions {
  /** نوع الإشعار: تحديث/نشر (افتراضي) أو حذف من الفهرس. */
  type?: IndexingNotificationType;
  /** سقف الروابط لهذه الجولة — يتجاوز المتغير البيئي. */
  maxUrls?: number;
  /** وصف الجهة المُشغِّلة يظهر في سطر السجل (مثال: «cron/sync (daily)»). */
  contextAr?: string;
  /**
   * حقن للاختبارات: بديل يتسلّم الإرسال بدل الاتصال الحقيقي؛ بوجوده لا يُبنى
   * عميل Google ولا تُجرى أي مكالمة شبكية. لا يُستخدم خارج الاختبارات.
   */
  publish?: IndexingUrlPublisher;
}

const INDEXING_API_SCOPE = 'https://www.googleapis.com/auth/indexing';

/**
 * الحصة الافتراضية الموثّقة للواجهة ~200 طلب نشر/يوم. السقف الافتراضي للجولة
 * الواحدة 50 حتى تتسع الجولات المتعددة في اليوم الواحد بأمان.
 */
const DEFAULT_MAX_URLS_PER_RUN = 50;
const HARD_MAX_URLS_PER_RUN = 200;

/** تحذير «غير مُفعَّل» يُطبع مرة واحدة لكل نسخة حتى لا تُغرق السجلات كل جولة. */
let notConfiguredWarningShown = false;

/** مفتاح إيقاف لحظي بلا تعديل كود (نفس نمط مفاتيح الموقع الأخرى مثل GA). */
export function isGoogleIndexingEnabled(): boolean {
  return readEnv('GOOGLE_INDEXING_ENABLED').toLowerCase() !== 'off';
}

/**
 * يوحّد شكل المفتاح الخاص: Vercel يقبل اللصق متعدد الأسطر (أسطر حقيقية) أو لصق
 * محتوى JSON كاملًا في سطر واحد (تحويلات \n نصّية مهرّبة) — الصيغتان صحيحتان.
 */
export function normalizeGooglePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

interface GoogleIndexingCredentials {
  clientEmail: string;
  privateKey: string;
}

/** يقرأ الاعتماد من البيئة أو يعيد null مع السبب — لا يعيد السرّ نفسه للخارج أبدًا. */
function readCredentials(): GoogleIndexingCredentials | null {
  if (!isGoogleIndexingEnabled()) return null;
  if (!hasUsableKey('GOOGLE_CLIENT_EMAIL') || !hasUsableKey('GOOGLE_PRIVATE_KEY')) return null;
  const clientEmail = readEnv('GOOGLE_CLIENT_EMAIL');
  const privateKey = normalizeGooglePrivateKey(readEnv('GOOGLE_PRIVATE_KEY'));
  if (!clientEmail || !privateKey) return null;
  return { clientEmail, privateKey };
}

/**
 * عميل الواجهة يُبنى مرة واحدة لكل نسخة دافئة ويُعاد استخدامه؛ وإذا تغيّرت بيانات
 * الاعتماد (إعادة نشر بمفاتيح جديدة) يُبنى عميل جديد بدل العمل بمفاتيح قديمة.
 */
let cachedClient: { fingerprint: string; api: indexing_v3.Indexing } | null = null;

function getIndexingApi(credentials: GoogleIndexingCredentials): indexing_v3.Indexing {
  const fingerprint = `${credentials.clientEmail}::${credentials.privateKey.length}`;
  if (cachedClient && cachedClient.fingerprint === fingerprint) return cachedClient.api;
  const auth = new google.auth.JWT({
    email: credentials.clientEmail,
    key: credentials.privateKey,
    scopes: [INDEXING_API_SCOPE],
  });
  const api = google.indexing({ version: 'v3', auth });
  cachedClient = { fingerprint, api };
  return api;
}

/**
 * تطبيع المدخلات: يقبل المسار النسبي («/matches/x») أو رابطًا كاملًا http(s)،
 * ويرفض أي شيء آخر بلا استثناء — رابط مشوّه يكلف طلبًا من الحصة ولا يفيد شيئًا.
 */
export function toAbsoluteSiteUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const candidate = trimmed.startsWith('/') ? `${GATEWAY_SITE_URL}${trimmed}` : trimmed;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** رابط صفحة المباراة القانوني (نفسه المستخدم في خريطة الموقع ووسم canonical). */
export function matchLandingUrl(matchId: string): string {
  return `${GATEWAY_SITE_URL}${buildMatchLandingPath(matchId)}`;
}

/** رابط صفحة الخبر القانوني. */
export function newsArticleUrl(slug: string): string {
  return `${GATEWAY_SITE_URL}/news/${encodeURIComponent(slug)}`;
}

function describeIndexingError(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: string;
      code?: number | string;
      response?: { status?: number; data?: { error?: { message?: string } } };
    };
    const status = candidate.response?.status ?? candidate.code;
    /** رسالة googleapis للأخطاء الشائعة (403 صلاحية، 429 تجاوز حصة) واضحة ولا تحمل أسرارًا. */
    const message =
      candidate.response?.data?.error?.message || candidate.message || 'unknown_error';
    const trimmed = message.slice(0, 300);
    return status !== undefined ? `${status}: ${trimmed}` : trimmed;
  }
  return String(error).slice(0, 300);
}

function resolveMaxUrlsPerRun(override?: number): number {
  const clamp = (value: number) => Math.max(1, Math.min(HARD_MAX_URLS_PER_RUN, Math.floor(value)));
  if (override !== undefined && Number.isFinite(override) && override > 0) return clamp(override);
  const fromEnv = Number(readEnv('GOOGLE_INDEXING_MAX_URLS_PER_RUN'));
  if (Number.isFinite(fromEnv) && fromEnv > 0) return clamp(fromEnv);
  return DEFAULT_MAX_URLS_PER_RUN;
}

/**
 * يرسل إشعارات URL_UPDATED/URL_DELETED لمجموعة روابط، بلا أن يرمي استثناءً أبدًا.
 *
 *  الترتيب متعمَّد: تطبيع ← إزالة تكرار ← فحص الإعداد ← سقف الحصة ← إرسال تسلسلي
 *  (الواجهة حصّتها بالدقيقة واليوم، والإرسال المتوازي هناك لا يكسب شيئًا ويستهلك
 *  زمن «الخلفية» نفسه). فشل رابط واحد لا يوقف الباقي، وسبب كل فشل يُسجَّل ويُعاد.
 */
export async function notifyGoogleIndexing(
  urlsInput: Array<string | null | undefined>,
  options: NotifyGoogleIndexingOptions = {}
): Promise<GoogleIndexingSummary> {
  const type: IndexingNotificationType = options.type ?? 'URL_UPDATED';
  const contextAr = options.contextAr || 'غير محددة';

  const seen = new Set<string>();
  const urls: string[] = [];
  let invalid = 0;
  for (const raw of urlsInput ?? []) {
    const absolute = toAbsoluteSiteUrl(raw);
    if (!absolute) {
      if (raw && raw.trim()) invalid += 1;
      continue;
    }
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    urls.push(absolute);
  }

  const summary: GoogleIndexingSummary = {
    configured: false,
    type,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skippedByQuota: 0,
    invalid,
    failures: [],
  };
  if (urls.length === 0) return summary;

  const credentials = readCredentials();
  if (!credentials) {
    if (!notConfiguredWarningShown) {
      notConfiguredWarningShown = true;
      console.info(
        '[google-indexing] الإشعار غير مُفعَّل: اضبط GOOGLE_CLIENT_EMAIL وGOOGLE_PRIVATE_KEY ' +
          '(وأضِف بريد حساب الخدمة مالكًا في Search Console). هذا تحذير لمرة واحدة.'
      );
    }
    return summary;
  }
  summary.configured = true;

  const maxUrls = resolveMaxUrlsPerRun(options.maxUrls);
  const batch = urls.slice(0, maxUrls);
  summary.skippedByQuota = urls.length - batch.length;

  const realPublish: IndexingUrlPublisher = async (url, notificationType) => {
    const api = getIndexingApi(credentials);
    await api.urlNotifications.publish({
      requestBody: { url, type: notificationType },
    });
  };
  const publish = options.publish ?? realPublish;

  for (const url of batch) {
    try {
      await publish(url, type);
      summary.attempted += 1;
      summary.succeeded += 1;
    } catch (error) {
      summary.attempted += 1;
      summary.failed += 1;
      const reason = describeIndexingError(error);
      summary.failures.push({ url, error: reason });
      console.error(`[google-indexing] فشل إشعار ${type} — ${url} — ${reason}`);
    }
  }

  console.info(
    '[google-indexing]',
    JSON.stringify({
      contextAr,
      requested: urls.length,
      ...summary,
      failures: summary.failures.length,
    })
  );
  return summary;
}

/**
 * نقطة الربط الوحيدة لمسارات الطلبات: تُجدوِل إشعار الروابط ليعمل **بعد إرسال
 * الإجابة** عبر after() من Next، فلا ينتظر المجدوّل ولا لوحة الإدارة شبكة Google.
 *
 * تفصيلتان يجب أن تبقيا ظاهرتين:
 *  ① المُعادة من الدالة المجدولة هي Promise الحقيقي للإرسال — هذا بالضبط ما
 *    يُبقي نسخة Vercel حيّة حتى تكتمل مكالمات Google. لو مُرِّرت دالة «أطلق
 *    وانسَ» لجمّدت المنصة النسخة بعد الإجابة وقُتلت الإشعارات في منتصفها صمتًا.
 *  ② after() يرمي خطأً عند استدعائه خارج نطاق طلب (اختبارات تستدعي المعالج
 *    مباشرة، سكربتات CLI). في تلك السياقات يُشغَّل العمل مباشرةً في الخلفية
 *    بدل إسقاط المعالج — والناتج في بيئة بلا اعتماد «غير مُفعَّل» بلا أثر جانبي.
 */
export function notifyGoogleIndexingAfterResponse(
  urlsInput: Array<string | null | undefined>,
  options: NotifyGoogleIndexingOptions = {}
): void {
  const run = async () => {
    try {
      await notifyGoogleIndexing(urlsInput, options);
    } catch (error) {
      console.error(
        `[google-indexing] تعذّر تنفيذ الإشعار بعد الإجابة (${options.contextAr || 'غير محددة'}):`,
        describeIndexingError(error)
      );
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/* ------------------------------------------------------------------------ *
 *  كشف «ما الذي تغيّر فعلًا» بين لقطتَي المخزن قبل المزامنة وبعدها
 * ------------------------------------------------------------------------ */

/**
 * المباريات التي أُدرجت أو تغيّر محتواها في هذه الجولة. المقارنة ببصمة المحتوى
 * نفسها التي يفرّق بها المخزن (تستبعد نبضة lastUpdatedAt)، فلا يُبلَّغ عن مباراة
 * أعادت المزامنة جلبها كما هي. السجلات المُعلَّمة كتكرار (duplicateOfId) تُستبعد:
 * صفحاتها تحيل إلى السجل الأساسي بوسم canonical فإبلاغها هدر للحصة.
 */
export function collectChangedMatchIds(
  before: readonly MatchRecord[],
  after: readonly MatchRecord[]
): string[] {
  const fingerprintBefore = new Map(before.map((record) => [record.id, matchContentFingerprint(record)]));
  const changed: string[] = [];
  for (const record of after) {
    if (record.duplicateOfId) continue;
    const previous = fingerprintBefore.get(record.id);
    if (previous === undefined || previous !== matchContentFingerprint(record)) {
      changed.push(record.id);
    }
  }
  return changed;
}

/**
 * بصمة محتوى الخبر بحقوله الظاهرة فقط: lastSyncedAt/fetchedAt نبضتا جولات
 * (تتحدّثان كل مزامنة بلا تغيير مرئي) فاستبعادهما شرط حتى لا تُرسل كل الأخبار
 * المنشورة إلى Google مع كل جولة وتُسرفَد الحصة اليومية قبل منتصف النهار.
 */
function newsIndexingSignature(item: NewsItemRecord): string {
  return JSON.stringify([
    item.slug,
    item.title,
    item.publishStatus,
    item.publishedAt ?? null,
    item.updatedAt ?? null,
    item.excerpt ?? null,
    item.imageUrl ?? null,
  ]);
}

/**
 * slugs الأخبار التي صارت قابلة للفهرسة في هذه الجولة (خبر جديد منشور، أو خبر
 * كان غير منشور فنُشر، أو خبر منشور تغيّر محتواه). المعيار هو نفسه معيار خريطة
 * الموقع (isIndexableNewsArticle): لا ندفع إلى Google صفحة اختار الموقع عدم
 * فهرستها أصلًا (المقتطفات الناقصة والروابط الوسيطة).
 */
export function collectChangedPublishedNewsSlugs(
  before: readonly NewsItemRecord[],
  after: readonly NewsItemRecord[]
): string[] {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const slugs: string[] = [];
  const seenSlugs = new Set<string>();
  for (const item of after) {
    if (!isIndexableNewsArticle(item)) continue;
    if (seenSlugs.has(item.slug)) continue;
    const previous = beforeById.get(item.id);
    const becameIndexable = !previous || !isIndexableNewsArticle(previous);
    const contentChanged = previous
      ? newsIndexingSignature(previous) !== newsIndexingSignature(item)
      : false;
    if (becameIndexable || contentChanged) {
      seenSlugs.add(item.slug);
      slugs.push(item.slug);
    }
  }
  return slugs;
}
