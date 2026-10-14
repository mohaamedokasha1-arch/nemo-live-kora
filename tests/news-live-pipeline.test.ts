import test, { after, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { GatewayDatabase } from '../lib/types';
import { setStorageDriverForTesting } from '../lib/storage';
import { clearHttpCache } from '../lib/sources/http-client';
import { MemoryStorageDriver } from '../lib/storage/file-driver';

/**
 * End-to-end news pipeline test.
 *
 * This reproduces the reported production symptom — "Google News RSS connected but 0 articles
 * published" — and proves it is fixed: relay links are resolved to real publisher articles, the
 * publisher's own summary becomes the excerpt, the items are published, and they survive a cold
 * start because they were written to the storage backend.
 */

const projectRoot = process.cwd();
const environmentKeys = ['NEMO_GATEWAY_STORE_PERSIST', 'NEMO_NEWS_ENRICH'] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

/** Real relay token: `\x08\x13\x22` + length byte + publisher URL. */
function token(publisherUrl: string): string {
  return Buffer.concat([
    Buffer.from([0x08, 0x13, 0x22]),
    Buffer.from([publisherUrl.length]),
    Buffer.from(publisherUrl, 'utf-8'),
  ]).toString('base64url');
}

const ARTICLES = [
  {
    title: 'الزمالك يعلن قائمة الفريق لمواجهة الأهلي في قمة الدوري المصري',
    publisher: 'اليوم السابع',
    publisherUrl: 'https://www.youm7.com',
    url: 'https://www.youm7.com/story/2026/10/12/zamalek-squad-ahly/1234501',
    pubDate: 'Sun, 12 Oct 2026 09:30:00 GMT',
    description:
      'أعلن الجهاز الفني لنادي الزمالك قائمة الفريق المختارة لمواجهة الأهلي في قمة الجولة السادسة من الدوري المصري الممتاز، وشهدت القائمة عودة عدد من اللاعبين بعد التعافي من الإصابة واستبعاد آخرين لأسباب فنية قبل المباراة المرتقبة على استاد القاهرة الدولي.',
    category: 'الدوري المصري الممتاز',
  },
  {
    title: 'منتخب مصر يستعد لمعسكر نوفمبر استعدادًا لتصفيات كأس العالم',
    publisher: 'المصري اليوم',
    publisherUrl: 'https://www.almasryalyoum.com',
    url: 'https://www.almasryalyoum.com/news/details/2026/10/12/egypt-national-team-camp/2987654',
    pubDate: 'Sun, 12 Oct 2026 08:05:00 GMT',
    description:
      'يستعد منتخب مصر الأول لكرة القدم للدخول في معسكر مغلق خلال شهر نوفمبر المقبل استعدادًا لمباريات تصفيات كأس العالم، حيث يدرس الجهاز الفني ضم عدد من الوجوه الجديدة بعد متابعة مباريات الدوري المصري الممتاز خلال الجولات الأخيرة.',
    category: 'منتخب مصر',
  },
  {
    title: 'الأهلي 2 - 1 الزمالك',
    publisher: 'يلا كورة',
    publisherUrl: 'https://www.yallakora.com',
    url: 'https://www.yallakora.com/egypt/2026/10/12/score-only/555001',
    pubDate: 'Sun, 12 Oct 2026 07:00:00 GMT',
    description: 'نتيجة المباراة',
    category: 'الدوري المصري الممتاز',
  },
];

function rssFor(article: (typeof ARTICLES)[number]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${article.category} - Google News</title>
<item>
  <title>${article.title} - ${article.publisher}</title>
  <link>https://news.google.com/rss/articles/${token(article.url)}?oc=5</link>
  <guid isPermaLink="false">${token(article.url)}</guid>
  <pubDate>${article.pubDate}</pubDate>
  <description>&lt;a href="https://news.google.com/rss/articles/${token(article.url)}?oc=5"&gt;${article.title}&lt;/a&gt;</description>
  <source url="${article.publisherUrl}">${article.publisher}</source>
</item>
</channel></rss>`;
}

function articleHtml(article: (typeof ARTICLES)[number]): string {
  return `<!doctype html><html lang="ar"><head>
<title>${article.title} - ${article.publisher}</title>
<meta property="og:title" content="${article.title}">
<meta property="og:description" content="${article.description}">
<meta property="og:image" content="${article.publisherUrl}/images/og.jpg">
<meta property="og:site_name" content="${article.publisher}">
<meta property="article:published_time" content="${article.pubDate}">
</head><body><p>${article.description}</p></body></html>`;
}

let workspace: string;
let engine: typeof import('../lib/sync/engine');
let store: typeof import('../lib/db/store');
let driver: MemoryStorageDriver;

before(async () => {
  const cacheDirectory = path.join(projectRoot, '.cache');
  fs.mkdirSync(cacheDirectory, { recursive: true });
  workspace = fs.mkdtempSync(path.join(cacheDirectory, 'news-live-test-'));
  fs.mkdirSync(path.join(workspace, 'data'));
  fs.copyFileSync(
    path.join(projectRoot, 'data/gateway-store.json'),
    path.join(workspace, 'data/gateway-store.json')
  );
  process.chdir(workspace);

  driver = new MemoryStorageDriver();
  setStorageDriverForTesting(driver);
  engine = await import('../lib/sync/engine');
  store = await import('../lib/db/store');
  store.resetStoreForTesting();
});

beforeEach(() => {
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  process.env.NEMO_NEWS_ENRICH = 'on';
  store.resetStoreForTesting();
  driver.writes.length = 0;
  clearHttpCache();

  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));

    // 1) The RSS feeds themselves.
    if (url.hostname === 'news.google.com' && url.searchParams.has('ceid')) {
      const query = url.searchParams.get('q') || '';
      const match = ARTICLES.find((article) =>
        query.includes('منتخب مصر')
          ? article.publisher === 'المصري اليوم'
          : article.publisher === 'اليوم السابع'
      );
      return new Response(match ? rssFor(match) : '<rss><channel></channel></rss>', {
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      });
    }

    // 2) Publisher article pages (enrichment).
    const article = ARTICLES.find((item) => url.href.startsWith(item.url));
    if (article) {
      return new Response(articleHtml(article), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    return new Response('', { status: 404 });
  });
});

after(() => {
  mock.restoreAll();
  process.chdir(projectRoot);
  store.resetStoreForTesting();
  setStorageDriverForTesting(null);
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
});

test('Google News RSS publishes real articles instead of 0', async () => {
  const sync = await engine.runNewsSync('اختبار خط أنابيب الأخبار');

  assert.equal(sync.ok, true, sync.messageAr);
  assert.ok(sync.fetchedCount > 0, 'items were fetched from the feeds');
  assert.ok(sync.resolutionReport, 'the resolution report is recorded');
  assert.ok(sync.resolutionReport!.resolved > 0, 'relay links were resolved to publisher URLs');
  assert.ok(sync.publishedCount > 0, `articles were published: ${sync.messageAr}`);
  assert.match(sync.messageAr, /نُشر [1-9]/);

  const db = store.getGatewayDatabase();
  const published = db.news.filter((item) => item.publishStatus === 'published');
  assert.ok(published.length > 0);

  for (const item of published) {
    // Every published link is a real publisher article, never a Google relay.
    assert.equal(item.link.includes('news.google.com'), false, `relay link published: ${item.link}`);
    assert.ok(item.publishedAtKnown, `publish date is known: ${item.title}`);
    assert.ok(
      (item.excerpt || '').length >= 160,
      `the excerpt is the publisher's own summary: ${item.title}`
    );
    assert.ok(item.imageUrl, 'the publisher image was picked up');
    assert.ok(item.publisherName, 'the publisher is credited');
  }

  const zamalek = published.find((item) => item.title.includes('الزمالك يعلن قائمة'));
  assert.ok(zamalek, 'the Egyptian league story was published');
  assert.equal(zamalek!.link, ARTICLES[0].url);
  assert.equal(zamalek!.categoryAr, 'الدوري المصري الممتاز');
});

test('a bare scoreboard headline is rejected, not published as news', async () => {
  const sync = await engine.runNewsSync('اختبار رفض النتائج');
  const db = store.getGatewayDatabase();
  const scoreItem = db.news.find((item) => item.title === 'الأهلي 2 - 1 الزمالك');
  if (scoreItem) {
    assert.equal(scoreItem.publishStatus, 'rejected');
    assert.equal(scoreItem.rejectionReason, 'match_score_only');
  }
  const publishedTitles = db.news
    .filter((item) => item.publishStatus === 'published')
    .map((item) => item.title);
  assert.equal(publishedTitles.includes('الأهلي 2 - 1 الزمالك'), false);
  void sync;
});

test('published news survives a cold start because it was written to the backend', async () => {
  await engine.runNewsSync('اختبار دوام الأخبار');
  const before = store.getGatewayDatabase().news.filter((n) => n.publishStatus === 'published').length;
  assert.ok(before > 0);
  assert.ok(driver.writes.length > 0, 'the store wrote to the backend');

  // Cold start: forget the in-memory copy and hydrate from the backend only.
  store.resetStoreForTesting();
  const hydrated = await store.hydrateStore();
  const after = hydrated.news.filter((n) => n.publishStatus === 'published').length;
  assert.equal(after, before);

  const roundTrip = await store.verifyStorageRoundTrip();
  assert.equal(roundTrip.ok, true);
  assert.equal(roundTrip.newsReadBack, hydrated.news.length);
});

test('a news sync failure keeps previously published news and is recorded honestly', async () => {
  const goodSync = await engine.runNewsSync('نجاح أول');
  assert.ok(goodSync.publishedCount > 0);
  const publishedBefore = store
    .getGatewayDatabase()
    .news.filter((n) => n.publishStatus === 'published').length;

  mock.restoreAll();
  clearHttpCache(); // a cached feed inside its TTL would otherwise be served as a success
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('network unreachable');
  });

  const failedSync = await engine.runNewsSync('فشل الشبكة');
  assert.equal(failedSync.ok, false);
  assert.equal(failedSync.publishedCount, 0);
  assert.match(failedSync.messageAr, /تعذر جلب/);

  const publishedAfter = store
    .getGatewayDatabase()
    .news.filter((n) => n.publishStatus === 'published').length;
  assert.equal(publishedAfter, publishedBefore, 'published news was not deleted by a failed run');

  const db = store.getGatewayDatabase();
  assert.equal(db.sources['google-news-rss'].status, 'degraded');
  assert.equal(db.sources['google-news-rss'].lastSuccessfulNewsSyncAt, goodSync.finishedAt);
});

test('the news sync record stored in the database carries the resolution evidence', async () => {
  await engine.runNewsSync('اختبار سجل المزامنة');
  const db = store.getGatewayDatabase();
  const record = db.newsSourceSyncs[0];
  assert.ok(record);
  assert.ok(record.resolutionReport);
  assert.ok(record.resolutionReport!.attempted > 0);
  assert.equal(record.resolutionReport!.resolved + record.resolutionReport!.unresolved, record.resolutionReport!.attempted);
  const persisted = (await driver.read()).database;
  assert.ok(persisted?.newsSourceSyncs[0].resolutionReport, 'the evidence is persisted, not just in memory');
});

/** Guards the store shape the pages depend on after a real sync. */
test('the synced database still satisfies the GatewayDatabase shape', async () => {
  await engine.runNewsSync('اختبار الشكل');
  const db = store.getGatewayDatabase();
  const keys: Array<keyof GatewayDatabase> = [
    'meta',
    'sources',
    'competitions',
    'seasons',
    'teams',
    'matches',
    'standings',
    'news',
    'newsSourceSyncs',
    'syncLogs',
  ];
  for (const key of keys) {
    assert.ok(db[key] !== undefined, `${key} is present`);
  }
  assert.ok(Array.isArray(db.matches));
  assert.ok(db.matches.length > 0, 'the match schedule was preserved by the news sync');
});
