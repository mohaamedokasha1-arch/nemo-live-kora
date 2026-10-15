import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../lib/db/store';
import { parseGoogleNewsRssXml } from '../lib/sources/google-news-rss';
import {
  describeNewsRejectionAr,
  summarizeNewsRejectionsAr,
} from '../lib/news/validate';
import { GET as sourcesGET } from '../app/api/sources/route';
import type { NewsItemRecord, NewsSourceSyncRecord } from '../lib/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  صدق وصف حالة مصدر الأخبار (تدقيق 2026-10-15)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  عيب الإنتاج قبل الإصلاح: كان وصف المصدر يُبنى من نتيجة **النشر** لا من نتيجة **الجلب**،
 *  فمصدر استجاب فعلًا وأعاد عناوين لم تجتز شروط الجودة كان يُوصف بـ«تعذر جلب الأخبار من
 *  المصدر» وتُحتسب عليه أخطاء — وهو وصف غير صحيح يدفع المشغّل للبحث عن عطل شبكة لا وجود له،
 *  ويجعل القارئ يظن أن الأخبار المفقودة سببها انقطاع المصدر.
 *
 *  هذه الاختبارات تحكم الحالات الثلاث على مسار الإنتاج نفسه (`recordNewsSync`):
 *   ① المصدر يعمل ولا عنوان قابل للنشر → يعمل، بلا عدّاد أخطاء.
 *   ② فشل جلب حقيقي → degraded + عدّاد أخطاء، والأخبار المنشورة سابقًا تبقى كما هي.
 *   ③ نشر فعلي → active مع تسجيل وقت آخر مزامنة ناجحة.
 */

const environmentKeys = ['NEMO_GATEWAY_STORE_PERSIST', 'NEMO_DATA_DIR', 'VERCEL', 'VERCEL_ENV'] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
let dataDir: string;

function syncRecord(overrides: Partial<NewsSourceSyncRecord>): NewsSourceSyncRecord {
  return {
    id: `news-sync-${Math.random().toString(16).slice(2)}`,
    sourceId: 'google-news-rss',
    startedAt: '2026-10-15T05:00:00.000Z',
    finishedAt: '2026-10-15T05:00:02.000Z',
    ok: false,
    feedOk: false,
    httpStatus: 200,
    latencyMs: 900,
    fetchedCount: 0,
    importedCount: 0,
    publishedCount: 0,
    duplicateCount: 0,
    rejectedCount: 0,
    updatedCount: 0,
    errorCount: 0,
    messageAr: '—',
    ...overrides,
  };
}

function publishedNewsItem(index: number): NewsItemRecord {
  return {
    id: `news-keep-${index}`,
    sourceItemId: null,
    sourceId: 'google-news-rss',
    title: `خبر منشور رقم ${index}`,
    slug: `news-keep-${index}`,
    link: `https://example.com/news/${index}`,
    originalUrl: null,
    publishedAt: '2026-10-14T12:00:00.000Z',
    publishedAtKnown: true,
    updatedAt: null,
    fetchedAt: '2026-10-14T12:05:00.000Z',
    lastSyncedAt: '2026-10-14T12:05:00.000Z',
    cairoDate: '2026-10-14',
    cairoTimeLabel: '٠٢:٠٠ م',
    excerpt: 'مقتطف الخبر.',
    imageUrl: null,
    publisherName: 'Example',
    publisherUrl: 'https://example.com',
    language: 'ar',
    categoryAr: 'كرة عالمية',
    publishStatus: 'published',
    rejectionReason: null,
    rejectionReasonAr: null,
    duplicateOfId: null,
    relatedMatchIds: [],
    relatedTeamIds: [],
    relatedCompetitionCodes: [],
    nemoRelatedUrl: null,
    nemoRelatedLabelAr: null,
  };
}

before(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nemo-news-honesty-'));
});

beforeEach(async () => {
  for (const key of environmentKeys) delete process.env[key];
  process.env.NEMO_DATA_DIR = dataDir;
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  store.resetStoreStateForTests();
  await store.hydrateGatewayDatabase();
  const db = store.getGatewayDatabase();
  db.news = [publishedNewsItem(1), publishedNewsItem(2)];
  db.newsSourceSyncs = [];
  store.persistGatewayDatabase(db);
});

after(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('مصدر استجاب ولم ينشر: يُوصف بأنه يعمل، ولا يُحتسب خطأ عليه', () => {
  const before = store.getGatewayDatabase();
  const beforeErrorCount = before.sources['google-news-rss'].errorCount || 0;
  const beforeLastSuccess = before.sources['google-news-rss'].lastSuccessfulNewsSyncAt ?? null;

  store.recordNewsSync(
    syncRecord({
      feedOk: true,
      ok: false,
      fetchedCount: 11,
      importedCount: 11,
      rejectedCount: 11,
      messageAr:
        'جُلب ١١ عنوانًا من RSS… نُشر 0، تحديث 0، تكرار 0، رفض 11. المصدر استجاب فعلًا، ولم يجتز أي عنوان شرط النشر (جودة/رابط ناشر).',
    })
  );

  const source = store.getGatewayDatabase().sources['google-news-rss'];
  assert.equal(source.status, 'active', 'المصدر يعمل — ليس degraded');
  assert.match(source.statusLabelAr, /المصدر يعمل/);
  assert.doesNotMatch(source.statusLabelAr, /تعذر جلب/, 'لا يُوصف الجلب بالفشل بلا سبب');
  assert.equal(source.errorCount || 0, beforeErrorCount, 'لا يُحتسب خطأ على مصدر يعمل');
  assert.equal(
    source.lastSuccessfulNewsSyncAt ?? null,
    beforeLastSuccess,
    'آخر مزامنة ناجحة لا تُحدَّث بنشر لم يحدث'
  );
  assert.equal(store.queryPublishedNews(10).length, 2, 'الأخبار المنشورة السابقة لم تُمس');
});

test('فشل جلب حقيقي: degraded + عدّاد أخطاء، والأخبار السابقة تبقى', () => {
  const beforeErrorCount = store.getGatewayDatabase().sources['google-news-rss'].errorCount || 0;

  store.recordNewsSync(
    syncRecord({
      feedOk: false,
      ok: false,
      httpStatus: null,
      errorCount: 1,
      messageAr: 'تعذر جلب الأخبار من Google News RSS. لم تُحذف الأخبار المنشورة سابقًا.',
    })
  );

  const db = store.getGatewayDatabase();
  const source = db.sources['google-news-rss'];
  assert.equal(source.status, 'degraded');
  assert.match(source.statusLabelAr, /تعذر جلب الأخبار من المصدر/);
  assert.equal((source.errorCount || 0), beforeErrorCount + 1, 'الفشل الحقيقي يُحتسب خطأً');
  assert.equal(store.queryPublishedNews(10).length, 2, 'لا حذف للأخبار عند فشل المصدر');

  // والسجل المحفوظ يحمل الحالتين منفصلتين، فيقرأ المشغّل السبب الحقيقي.
  assert.equal(db.newsSourceSyncs[0].feedOk, false);
  assert.equal(db.newsSourceSyncs[0].ok, false);
});

test('نشر فعلي: active + تسجيل وقت آخر مزامنة ناجحة', () => {
  const finishedAt = '2026-10-15T06:30:00.000Z';
  store.recordNewsSync(
    syncRecord({
      feedOk: true,
      ok: true,
      finishedAt,
      fetchedCount: 9,
      publishedCount: 3,
      importedCount: 3,
      messageAr: 'جُلب ٩ عناوين ونُشر 3.',
    })
  );

  const source = store.getGatewayDatabase().sources['google-news-rss'];
  assert.equal(source.status, 'active');
  assert.equal(source.lastSuccessfulNewsSyncAt, finishedAt);
  assert.match(source.statusLabelAr, /نشر 3/);
  assert.equal(store.queryPublishedNews(10).length, 2, 'الأخبار السابقة باقية إلى جانب الجديد');
});

test('السجل القديم بلا `feedOk` لا يُقرأ كأنه مصدر يعمل', () => {
  // سجلات ما قبل الإصلاح لا تحمل الحقل: تُعامل كفشل جلب (السلوك السابق نفسه) لا كنجاح مُفترض.
  const beforeErrorCount = store.getGatewayDatabase().sources['google-news-rss'].errorCount || 0;
  store.recordNewsSync(syncRecord({ ok: false, errorCount: 1, messageAr: 'تعذر جلب الأخبار من المصدر.' }));
  const source = store.getGatewayDatabase().sources['google-news-rss'];
  assert.equal(source.status, 'degraded');
  assert.equal((source.errorCount || 0), beforeErrorCount + 1);
});

/** ═══ الجذر المُثبت في الإنتاج (2026-10-15): الروابط الوسيطة لم تُحلّ ⇒ لا خبر منشور ═══ */

/** نفس بنية عنصر Google News RSS الحقيقي: رابط وسيط + ناشر معروف في وسم `<source>`. */
function relayFeedXml(count: number): string {
  const items = Array.from({ length: count }, (_, index) => {
    const token = `AU_yqL${'AbCdEf0123456789'.repeat(2)}${index}`;
    return `<item>
  <title>الأهلي يستعد لمواجهة الزمالك في قمة الدوري المصري - اليوم السابع</title>
  <link>https://news.google.com/rss/articles/${token}?oc=5</link>
  <guid isPermaLink="false">${token}</guid>
  <pubDate>Wed, 15 Oct 2026 02:${String(10 + index).padStart(2, '0')}:00 GMT</pubDate>
  <description>&lt;a href="https://news.google.com/rss/articles/${token}?oc=5"&gt;قمة الدوري&lt;/a&gt;</description>
  <source url="https://www.youm7.com">اليوم السابع</source>
</item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>الدوري المصري</title>${items}</channel></rss>`;
}

test('رابط Google News الوسيط غير المُحلَّل: يُرفض بسبب مكتوب، ولا يُنشر رابط بحث كخبر', () => {
  const parsed = parseGoogleNewsRssXml(relayFeedXml(10));
  assert.equal(parsed.length, 10, 'الخلاصة قُرئت فعلًا (١٠ عناوين)');

  const result = store.ingestNewsCandidatesInStore(parsed);
  assert.equal(result.published, 0, 'لا يُنشر رابط وسيط لم يُحلّ إلى صفحة ناشر');
  assert.equal(result.rejected, 10);
  assert.equal(
    result.rejectionBreakdown.invalid_url,
    10,
    'السبب مسجَّل بالرمز نفسه الذي ظهر في الإنتاج'
  );
  assert.equal(
    describeNewsRejectionAr('invalid_url'),
    'الرابط ليس رابط مقالة مباشرة من الناشر (رابط Google News الوسيط لم يُحلّ)'
  );

  const db = store.getGatewayDatabase();
  assert.equal(db.news.filter((item) => item.publishStatus === 'rejected').length, 10);
  assert.equal(db.newsImportErrors.length, 10, 'كل رفض مسجَّل للمراجعة بسببه وعنوانه');
  assert.equal(db.newsImportErrors[0].errorCode, 'invalid_url');
  // الرسالة التفصيلية للعنصر المحفوظ للمراجعة (نصّها المعتمد في التحقق).
  assert.match(db.newsImportErrors[0].messageAr, /غير قابلة للنشر/);
  assert.equal(store.queryPublishedNews(10).length, 2, 'الأخبار المنشورة السابقة لم تُمس بالرفض');
});

test('حالة المصدر تقول السبب الحقيقي، وتبقى «يعمل» لأن الخلاصة استُجيبت', async () => {
  const parsed = parseGoogleNewsRssXml(relayFeedXml(10));
  const ingest = store.ingestNewsCandidatesInStore(parsed);
  store.recordNewsSync(
    syncRecord({
      feedOk: true,
      ok: false,
      fetchedCount: 10,
      rejectedCount: 10,
      rejectionBreakdown: ingest.rejectionBreakdown,
      messageAr: 'جُلب 10 عناوين… رفض 10.',
    })
  );

  const source = store.getGatewayDatabase().sources['google-news-rss'];
  assert.equal(source.status, 'active');
  assert.match(source.statusLabelAr, /الرابط ليس رابط مقالة مباشرة من الناشر/);
  assert.match(source.statusLabelAr, /\(10\)/, 'العدّاد يوضح حجم المشكلة');
  assert.match(source.statusLabelAr, /لم يُحذف أي خبر منشور/);

  // ونفس السبب متاح للقراءة العامة من `/api/sources` بلا تسجيل دخول إداري.
  const response = await sourcesGET();
  const payload = (await response.json()) as {
    newsRejections: {
      top: { code: string; count: number; labelAr: string } | null;
      reasons: Array<{ code: string; count: number; reasonAr: string }>;
      feedOk: boolean | null;
      rejectedCount: number;
    };
  };
  assert.equal(payload.newsRejections.feedOk, true);
  assert.equal(payload.newsRejections.rejectedCount, 10);
  assert.equal(payload.newsRejections.top?.code, 'invalid_url');
  assert.equal(payload.newsRejections.top?.count, 10);
  assert.equal(
    payload.newsRejections.reasons.find((entry) => entry.code === 'invalid_url')?.reasonAr,
    'الرابط ليس رابط مقالة مباشرة من الناشر (رابط Google News الوسيط لم يُحلّ)'
  );
});

test('ترتيب أسباب الرفض: الأكثر تكرارًا أولًا، وبلا اختراع سبب عند غياب البيانات', () => {
  assert.deepEqual(summarizeNewsRejectionsAr({ invalid_url: 7, match_score_only: 2 }), {
    code: 'invalid_url',
    count: 7,
    labelAr: 'الرابط ليس رابط مقالة مباشرة من الناشر (رابط Google News الوسيط لم يُحلّ)',
  });
  assert.deepEqual(summarizeNewsRejectionsAr({ match_score_only: 5, invalid_url: 5 }), {
    code: 'invalid_url',
    count: 5,
    labelAr: 'الرابط ليس رابط مقالة مباشرة من الناشر (رابط Google News الوسيط لم يُحلّ)',
  });
  assert.equal(summarizeNewsRejectionsAr({}), null);
  assert.equal(summarizeNewsRejectionsAr(null), null);
  assert.match(describeNewsRejectionAr('code_never_seen'), /غير مُصنَّف/);
});
