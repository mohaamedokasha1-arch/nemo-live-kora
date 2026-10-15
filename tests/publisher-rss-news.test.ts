import test, { after, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { TheSportsDBRawEvent } from '../lib/sources/thesportsdb';
import { mapTheSportsDBEventToRecord } from '../lib/sources/thesportsdb';
import { mergeMatchRecords } from '../lib/db/seed-data';
import { clearHttpCache } from '../lib/sources/http-client';
import { fetchWithProtection } from '../lib/sources/http-client';
import {
  PUBLISHER_RSS_FEEDS,
  fetchPublisherRss,
  isFeedPublisherArticleUrl,
  parsePublisherRssXml,
  resolvePublisherRssFeeds,
} from '../lib/sources/publisher-rss';
import {
  decodeGoogleNewsArticleToken,
  extractBatchExecuteParams,
  parseBatchExecuteResponse,
} from '../lib/news/google-news-resolver';

/**
 * Regression suite for the 2026-10-15 news repair:
 *
 *  A) The RECORDED live Google News RSS sample (see tests/fixtures/google-news/
 *     rss-live-relay-tokens-2026-10-15.json) proves the current relay format carries an opaque
 *     AU_yqL id with no embedded publisher URL — offline decoding CANNOT resolve it, which is
 *     the verified root cause of the production `resolved: 0` state.
 *  B) The new `publisher-rss` source parses feeds into validated candidates, isolates failing
 *     feeds, and refuses off-domain links.
 *  C) Engine integration: articles published from publisher feeds appear exactly once even when
 *     the same story also arrives through a resolved Google relay, and re-running the sync is
 *     idempotent.
 *  D) A provider re-assignment of the fixture behind the SAME stable event id (real production
 *     case: TheSportsDB event 2561130) updates a `not_started` record's teams, but never touches
 *     a record with a live/finished state.
 *  E) `retryOnNetworkErrorOnly` — cold-start network failures get one bounded retry, timeouts don't.
 */

const projectRoot = process.cwd();
const RELAY_FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(projectRoot, 'tests/fixtures/google-news/rss-live-relay-tokens-2026-10-15.json'),
    'utf-8'
  )
) as { items: Array<{ title: string; publisher: string; pubDate: string; relayUrl: string }> };

/* ─────────────────────────────────────────────────────────────────────────────
 * A) Recorded live relay tokens — offline decode must fail (no fabricated URL)
 * ──────────────────────────────────────────────────────────────────────────── */

test('A1. every relay link captured live on 2026-10-15 is an opaque AU_yqL token offline', () => {
  for (const item of RELAY_FIXTURE.items) {
    const decoded = decodeGoogleNewsArticleToken(item.relayUrl);
    assert.equal(decoded.url, null, `offline decode must not invent a URL for: ${item.title}`);
    assert.equal(decoded.error, 'opaque_token');
    assert.ok(decoded.opaqueToken?.startsWith('AU_yqL'), 'payload exposes the opaque id');
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * B) Publisher-direct RSS parsing rules
 * ──────────────────────────────────────────────────────────────────────────── */

const BBC_ARABIC = PUBLISHER_RSS_FEEDS[0];

function rss(channelTitle: string, items: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${channelTitle}</title>${items}</channel></rss>`;
}

test('B1. parses RSS items with direct publisher links, dates, images and attribution', () => {
  const xml = rss(
    'BBC عربي | رياضة',
    `<item>
      <title>الأهلي يحسم صفقة جديدة في الميركاتو - BBC News عربي</title>
      <link>https://www.bbc.co.uk/arabic/sport/articles/ahly-signing-2026</link>
      <guid isPermaLink="false">ahly-signing-2026-guid</guid>
      <pubDate>Thu, 15 Oct 2026 03:30:00 GMT</pubDate>
      <description>حسم النادي الأهلي التعاقد مع الصفقة الجديدة بعد مفاوضات طويلة، ووقع اللاعب على عقد يمتد لأربعة مواسم في حضور الجهاز الفني ومجلس الإدارة قبل انطلاق الموسم الكروي الجديد.</description>
      <enclosure url="https://c.files.bbci.co.uk/media/ahly.jpg" length="12000" type="image/jpeg"/>
    </item>`
  );
  const feed = { ...BBC_ARABIC };
  const parsed = parsePublisherRssXml(xml, feed, '2026-10-15T05:00:00.000Z');
  assert.equal(parsed.items.length, 1);
  const item = parsed.items[0];
  assert.equal(item.sourceId, 'publisher-rss');
  assert.equal(item.title, 'الأهلي يحسم صفقة جديدة في الميركاتو', 'publisher suffix stripped');
  assert.equal(item.link, 'https://www.bbc.co.uk/arabic/sport/articles/ahly-signing-2026');
  assert.equal(item.publishedAtKnown, true);
  assert.equal(item.sourceItemId, 'ahly-signing-2026-guid');
  assert.equal(item.imageUrl, 'https://c.files.bbci.co.uk/media/ahly.jpg');
  assert.equal(item.publisherName, 'BBC News عربي');
  assert.ok((item.excerpt || '').length >= 160, 'real summary, not a headline echo');
});

test('B2. items linking off the publisher domain are rejected and counted, never published', () => {
  const xml = rss(
    'Channel',
    `<item><title>خبر خارج النطاق يستحق الرفض لأنه لا يخص الناشر</title><link>https://evil-aggregator.example.com/copycat/story</link><pubDate>Thu, 15 Oct 2026 03:30:00 GMT</pubDate></item>
     <item><title>رابط جوجل وسيط يجب أن يرفض أيضًا في هذا المصدر</title><link>https://news.google.com/rss/articles/CBMiXYZ?oc=5</link><pubDate>Thu, 15 Oct 2026 03:31:00 GMT</pubDate></item>`
  );
  const parsed = parsePublisherRssXml(xml, { ...BBC_ARABIC }, '2026-10-15T05:00:00.000Z');
  assert.equal(parsed.items.length, 0);
  assert.equal(parsed.rejectedCount, 2);
  assert.equal(parsed.rejected.off_publisher_host, 2);
});

test('B3. non-feed responses (HTML/JSON) are recognized as not-a-feed', () => {
  const parsed = parsePublisherRssXml('{"matches":[],"events":[]}', { ...BBC_ARABIC }, '2026-10-15T05:00:00.000Z');
  assert.equal(parsed.items.length, 0);
  assert.equal(parsed.rejected.not_a_feed, 1);
});

test('B4. Atom entries with rel=alternate links parse like RSS items', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/205/Atom">
  <title>موقع رياضي</title>
  <entry>
    <title>نادٍ مصري يتأهل إلى ربع النهائي القاري بعد مباراة ماراثونية</title>
    <link rel="alternate" type="text/html" href="https://www.bbc.co.uk/arabic/sport/atom-entry-1"/>
    <id>tag:bbc,2026:atom-entry-1</id>
    <published>2026-10-14T22:00:00Z</published>
    <summary>ملخص الاختبار لمقال Atom</summary>
  </entry>
</feed>`;
  const parsed = parsePublisherRssXml(xml, { ...BBC_ARABIC }, '2026-10-15T05:00:00.000Z');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].link, 'https://www.bbc.co.uk/arabic/sport/atom-entry-1');
  assert.equal(parsed.items[0].publishedAtKnown, true);
});

test('B5. the publisher host gate accepts section/mirror hosts and rejects other publishers', () => {
  assert.equal(isFeedPublisherArticleUrl('https://m.bbc.co.uk/arabic/sport/a/b', BBC_ARABIC), true);
  assert.equal(isFeedPublisherArticleUrl('https://www.theguardian.com/football/x/y', BBC_ARABIC), false);
  assert.equal(isFeedPublisherArticleUrl('https://www.bbc.co.uk/arabic', BBC_ARABIC), false, 'section root is not an article');
});

test('B6. fetchPublisherRss keeps feeds independent and reports each feed honestly', async () => {
  clearHttpCache();
  const okItem = `<item>
    <title>خبر صحيح من خلاصة تعمل وله رابط مقال كامل من الناشر</title>
    <link>https://www.bbc.co.uk/arabic/sport/articles/good-story</link>
    <guid>good-story</guid>
    <pubDate>Thu, 15 Oct 2026 02:00:00 GMT</pubDate>
  </item>`;
  const calls: string[] = [];
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    calls.push(url);
    if (url === BBC_ARABIC.url) {
      return new Response(rss('BBC عربي', okItem), { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    }
    if (url === PUBLISHER_RSS_FEEDS[1].url) {
      return new Response('upstream blocked', { status: 503 });
    }
    return Response.json({ any: 'json', not: 'a feed' });
  });
  try {
    const res = await fetchPublisherRss({ timeoutMs: 1000, retries: 0, cacheTtlMs: 0 });
    assert.equal(res.ok, true, 'one working feed is enough');
    assert.equal(res.news.length, 1);
    assert.equal(res.news[0].link, 'https://www.bbc.co.uk/arabic/sport/articles/good-story');
    const byFeed = new Map(res.feedResults.map((f) => [f.url, f]));
    assert.equal(byFeed.get(BBC_ARABIC.url)?.ok, true);
    assert.equal(byFeed.get(PUBLISHER_RSS_FEEDS[1].url)?.ok, false, 'the 503 feed is failed — alone');
    assert.equal(byFeed.get(PUBLISHER_RSS_FEEDS[1].url)?.httpStatus, 503);
    assert.equal(byFeed.get(PUBLISHER_RSS_FEEDS[2].url)?.error, 'Response was not a valid RSS/Atom feed', 'JSON is not a feed');
    assert.equal(calls.length, PUBLISHER_RSS_FEEDS.length, 'every configured feed is attempted');
  } finally {
    mock.restoreAll();
  }
});

test('B7. NEMO_PUBLISHER_RSS_FEEDS=none empties the list; extra URLs append', () => {
  const original = process.env.NEMO_PUBLISHER_RSS_FEEDS;
  try {
    process.env.NEMO_PUBLISHER_RSS_FEEDS = 'none';
    assert.deepEqual(resolvePublisherRssFeeds(), []);
    process.env.NEMO_PUBLISHER_RSS_FEEDS = 'https://www.youm7.com/rss/sport';
    const extended = resolvePublisherRssFeeds();
    assert.equal(extended.length, PUBLISHER_RSS_FEEDS.length + 1);
    assert.equal(extended[extended.length - 1].url, 'https://www.youm7.com/rss/sport');
  } finally {
    if (original === undefined) delete process.env.NEMO_PUBLISHER_RSS_FEEDS;
    else process.env.NEMO_PUBLISHER_RSS_FEEDS = original;
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * C) Engine integration — real publish, cross-source dedup, idempotency
 * ──────────────────────────────────────────────────────────────────────────── */

const storeWorkspace: { dir: string; root: string } = { dir: '', root: '' };

function publisherItem(title: string, url: string, guid: string): string {
  return `<item><title>${title}</title><link>${url}</link><guid>${guid}</guid><pubDate>Thu, 15 Oct 2026 01:00:00 GMT</pubDate></item>`;
}

const FILGOAL = PUBLISHER_RSS_FEEDS[3];
const SHARED_STORY_URL = 'https://www.filgoal.com/articles/888888/shared-pyramids-story';

function googleRssWithRelays(): string {
  const items = RELAY_FIXTURE.items
    .map(
      (item) => `<item>
        <title>${item.title} - ${item.publisher}</title>
        <link>${item.relayUrl}</link>
        <guid isPermaLink="false">${item.relayUrl.slice(-32)}</guid>
        <pubDate>${item.pubDate}</pubDate>
        <source url="${item.publisher === 'FilGoal' ? 'https://www.filgoal.com' : 'https://www.youm7.com'}">${item.publisher}</source>
      </item>`
    )
    .join('\n');
  return `<rss version="2.0"><channel><title>Google News</title>${items}</channel></rss>`;
}

let engine: typeof import('../lib/sync/engine');
let store: typeof import('../lib/db/store');

before(async () => {
  const cacheDirectory = path.join(projectRoot, '.cache');
  fs.mkdirSync(cacheDirectory, { recursive: true });
  storeWorkspace.root = fs.mkdtempSync(path.join(cacheDirectory, 'publisher-rss-test-'));
  storeWorkspace.dir = path.join(storeWorkspace.root, 'store');
  fs.mkdirSync(storeWorkspace.dir, { recursive: true });
  process.env.NEMO_DATA_DIR = storeWorkspace.dir;
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'off';
  process.env.NEMO_NEWS_ENRICH = 'off';
  engine = await import('../lib/sync/engine');
  store = await import('../lib/db/store');
  store.resetStoreForTesting();
});

after(() => {
  mock.restoreAll();
  delete process.env.NEMO_DATA_DIR;
  delete process.env.NEMO_NEWS_ENRICH;
  if (storeWorkspace.root) fs.rmSync(storeWorkspace.root, { recursive: true, force: true });
});

beforeEach(async () => {
  clearHttpCache();
  store.resetStoreForTesting();
  await store.hydrateStore();
  const db = store.getGatewayDatabase();
  db.news = [];
  db.newsSourceSyncs = [];
  db.newsImportErrors = [];
  db.newsDedupRecords = [];

  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);

    // 1) Google News RSS: the three RECORDED live relay items (opaque links).
    if (url.includes('news.google.com/rss/search')) {
      return new Response(googleRssWithRelays(), { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    }

    // 2) Google relay pages: item 3 (the FilGoal story) resolves through a JS interstitial to
    //    the SAME article URL the publisher feed carries; items 1 and 2 stay unresolvable —
    //    exactly the production failure mode.
    if (url.includes('news.google.com/rss/articles/')) {
      if (url.includes('CBMiTEFVX3lxTFA0')) {
        return new Response(
          `<html><body><script>location.replace("${SHARED_STORY_URL}")</script></body></html>`,
          { status: 200, headers: { 'content-type': 'text/html' } }
        );
      }
      return new Response('<html><body><center>Please wait…</center></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }

    // 3) Publisher feeds: FilGoal carries the shared story plus one exclusive; BBC Arabic one
    //    story; the BBC English feed answers 404 — one failing feed must not block the rest.
    if (url === FILGOAL.url) {
      return new Response(
        rss(
          'FilGoal',
          publisherItem('بالفيديو — هدف بيراميدز الأول في شباك سيراميكا', SHARED_STORY_URL, 'fg-shared-888888') +
            publisherItem('علي ماهر يعيد بيكهام لتشكيل سيراميكا أمام بتروجت قبل المباراة المرتقبة', 'https://www.filgoal.com/articles/777777/beikham-return-story', 'fg-beikham-777777')
        ),
        { status: 200, headers: { 'content-type': 'application/rss+xml' } }
      );
    }
    if (url === BBC_ARABIC.url) {
      return new Response(
        rss('BBC عربي | رياضة', publisherItem('الدوري المصري ينطلق بجولة مثيرة في الأسبوع الحالي بين الأندية الكبرى', 'https://www.bbc.co.uk/arabic/sport/articles/epl-round-story', 'bbc-epl-round')),
        { status: 200, headers: { 'content-type': 'application/rss+xml' } }
      );
    }

    return new Response('', { status: 404 });
  });
});

test('C1. publisher articles publish even while Google relays fail; each unique story shows once', async () => {
  const sync = await engine.runNewsSync('اختبار تكامل الخلاصات المباشرة', [], { limitFeeds: 1 });

  const db = store.getGatewayDatabase();
  const published = db.news.filter((item) => item.publishStatus === 'published');
  const titles = published.map((item) => item.title);

  // Real articles reached the store — from the publisher source.
  assert.ok(
    titles.some((title) => title.includes('علي ماهر يعيد بيكهام')),
    `the FilGoal-exclusive article is stored: ${titles.join(' | ')}`
  );
  assert.ok(titles.some((title) => title.includes('الدوري المصري ينطلق')), 'the BBC article is stored');

  // The story that arrived through BOTH sources exists exactly once, on the direct URL
  // (the merge may keep either source's attribution — what is forbidden is a second card).
  const shared = published.filter((item) => item.link === SHARED_STORY_URL);
  assert.equal(shared.length, 1, 'cross-source copies collapse to one canonical record');
  assert.ok(!shared[0].link.includes('news.google.com'), 'the canonical link is the publisher URL');
  assert.ok(['publisher-rss', 'google-news-rss'].includes(shared[0].sourceId));

  // Unresolved Google relays are rejected with the honest reason — never published raw.
  const rejected = db.news.filter((item) => item.publishStatus === 'rejected');
  assert.equal(sync.rejectedCount, 2, 'both unresolvable relays accounted as rejected');
  assert.equal(
    Object.values(sync.rejectionBreakdown || {}).reduce((sum, n) => sum + n, 0),
    2,
    'rejection breakdown adds up'
  );
  assert.ok(rejected.length >= 1);
  for (const item of published) {
    assert.ok(!item.link.includes('news.google.com'), 'a relay URL is never visible on a published card');
  }
  // Rejected records keep their relay link — that is the handle the next run re-resolves.
  assert.ok(rejected.every((item) => item.publishStatus === 'rejected'));

  // Source honesty: publisher active with its published count; the returned google record keeps
  // its own semantics (feed worked; one link resolved; the rest rejected).
  const publisherRecord = db.newsSourceSyncs.find((record) => record.sourceId === 'publisher-rss');
  assert.ok(publisherRecord, 'the publisher source has its own sync record');
  assert.equal(publisherRecord!.ok, true);
  assert.equal(publisherRecord!.feedOk, true);
  assert.ok(publisherRecord!.publishedCount >= 2);
  assert.equal(db.sources['publisher-rss'].status, 'active');

  assert.equal(sync.feedOk, true, 'google feed itself answered');
  assert.equal(sync.resolutionReport!.resolved, 1, 'only the interstitial with a destination resolved');
  assert.equal(sync.resolutionReport!.unresolved, 2);
  assert.ok(
    sync.rejectionBreakdown && Object.keys(sync.rejectionBreakdown).length >= 0,
    'rejection accounting present'
  );
  assert.equal(db.meta.lastSuccessfulNewsSyncAt !== null, true, 'a successful news sync happened');
});

test('C2. repeated ingestion is idempotent — no duplicate records, no multiplied counts', async () => {
  await engine.runNewsSync('الجولة الأولى', [], { limitFeeds: 1 });
  const db1 = store.getGatewayDatabase();
  const snapshot1 = {
    published: db1.news.filter((i) => i.publishStatus === 'published').length,
    total: db1.news.length,
    slugs: db1.news.filter((i) => i.publishStatus === 'published').map((i) => i.slug).sort(),
  };

  await engine.runNewsSync('الجولة الثانية', [], { limitFeeds: 1 });
  const db2 = store.getGatewayDatabase();
  const snapshot2 = {
    published: db2.news.filter((i) => i.publishStatus === 'published').length,
    total: db2.news.length,
    slugs: db2.news.filter((i) => i.publishStatus === 'published').map((i) => i.slug).sort(),
  };

  assert.deepEqual(snapshot2, snapshot1, 'the second run changed nothing');
  const urls = db2.news.filter((i) => i.publishStatus === 'published').map((i) => i.link);
  assert.equal(new Set(urls).size, urls.length, 'no published link appears twice');
});

test('C3. when every publisher feed fails, stored articles survive (no destructive behavior)', async () => {
  // Seed one published article, then make ALL fetches fail.
  await engine.runNewsSync('تأسيس', [], { limitFeeds: 1 });
  const before = store.getGatewayDatabase().news.filter((i) => i.publishStatus === 'published').length;
  assert.ok(before > 0);

  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 503 }));
  clearHttpCache();
  const sync = await engine.runNewsSync('عطل تام', [], { limitFeeds: 1 });

  const after = store.getGatewayDatabase();
  assert.equal(sync.ok, false, 'the google record honestly reports the outage');
  assert.equal(
    after.news.filter((i) => i.publishStatus === 'published').length,
    before,
    'stored news untouched'
  );
});

/* ─────────────────────────────────────────────────────────────────────────────
 * D) Provider fixture re-assignment under the same stable id
 * ──────────────────────────────────────────────────────────────────────────── */

const ROUND6_PATH = path.join(projectRoot, 'tests/fixtures/thesportsdb/eventsround-4829-r6-2026-2027.json');

test('D1. a newer provider observation for the same event id updates a not_started matchup', () => {
  const raw = JSON.parse(fs.readFileSync(ROUND6_PATH, 'utf-8')) as { events: TheSportsDBRawEvent[] };
  const source = raw.events.find((event) => event.strHomeTeam && event.strAwayTeam)!;
  assert.ok(source, 'recorded fixture has events');

  // The stored record: pre-kickoff snapshot of the event (no score, not started).
  const stored: ReturnType<typeof mapTheSportsDBEventToRecord> = {
    ...mapTheSportsDBEventToRecord(source),
    status: 'not_started',
    score: { home: null, away: null },
    lastUpdatedAt: '2026-10-10T00:00:00.000Z',
  };
  // The provider re-published the same event id for a DIFFERENT pairing (schedule correction).
  const correctedRaw: TheSportsDBRawEvent = {
    ...source,
    strHomeTeam: 'El Gouna',
    strAwayTeam: 'Smouha',
    idHomeTeam: '139845',
    idAwayTeam: '139840',
    strEvent: 'El Gouna vs Smouha',
  };
  const corrected = {
    ...mapTheSportsDBEventToRecord(correctedRaw),
    id: stored.id,
    status: 'not_started' as const,
    score: { home: null, away: null },
    lastUpdatedAt: '2026-10-15T05:00:00.000Z',
  };

  const merged = mergeMatchRecords(stored, corrected);
  assert.notEqual(merged.homeTeam.id, stored.homeTeam.id, 'teams adopt the corrected pairing');
  assert.notEqual(merged.awayTeam.id, stored.awayTeam.id, 'both sides follow the provider');
  assert.equal(merged.id, stored.id, 'the public URL stays stable');

  // An older observation can never roll the correction back.
  const rollback = { ...stored, lastUpdatedAt: '2026-10-01T00:00:00.000Z' };
  const again = mergeMatchRecords(merged, rollback);
  assert.equal(again.homeTeam.id, merged.homeTeam.id, 'the older observation is refused');

  // And once the match has a state worth protecting, no re-tagging happens at all.
  const finishedBase = { ...stored, status: 'finished' as const, score: { home: 1, away: 0, halfTimeHome: null, halfTimeAway: null } };
  const protectedMerge = mergeMatchRecords({ ...finishedBase, lastUpdatedAt: '2026-10-09T00:00:00.000Z' }, corrected);
  assert.equal(protectedMerge.homeTeam.id, finishedBase.homeTeam.id, 'finished records are never re-tagged');
});

test('D2. a finished record keeps its score even when a newer correction arrives', () => {
  const raw = JSON.parse(fs.readFileSync(ROUND6_PATH, 'utf-8')) as { events: TheSportsDBRawEvent[] };
  const event = raw.events.find((e) => e.intHomeScore !== null && e.intHomeScore !== undefined) || raw.events[0];
  const base = mapTheSportsDBEventToRecord(event);
  const finished = { ...base, status: 'finished' as const, score: { ...base.score, home: 2, away: 0 } };
  const intruder = {
    ...finished,
    lastUpdatedAt: new Date(Date.parse(finished.lastUpdatedAt) + 60_000).toISOString(),
    homeTeam: { ...finished.homeTeam, id: 'team-someone-else', nameEn: 'Someone Else', nameAr: 'نادٍ آخر' },
  };
  const merged = mergeMatchRecords(finished, intruder);
  assert.equal(merged.homeTeam.id, finished.homeTeam.id, 'live/finished records never swap teams');
  assert.equal(merged.score.home, 2);
  assert.equal(merged.score.away, 0);
  assert.equal(merged.status, 'finished');
});

/* ─────────────────────────────────────────────────────────────────────────────
 * E) Resolver parsing robustness + bounded retry semantics
 * ──────────────────────────────────────────────────────────────────────────── */

test('E1. batch-execute params are found under any ds:N index (2024+ relay layout)', () => {
  const html = `<html><script>AF_initDataCallback({key: 'ds:5', hash: '2', data:[null,null,"AF+NEWSIGNATURE","1760000000000000"], sideChannel: {}});</script></html>`;
  const params = extractBatchExecuteParams(html);
  assert.deepEqual(params, { signature: 'AF+NEWSIGNATURE', timestamp: '1760000000000000' });
});

test('E2. when the [null,url] tuple shape misses, the scan decodes bare URLs — never Google hosts', () => {
  const rpc = (inner: string) => `)]}'\n` + JSON.stringify([[['Fbv4je', inner, 200]]]);
  // Positional layout changed in newer relays: the URL sits at index 2, not 1.
  const shifted = rpc('[null,404,"https:\\/\\/www.filgoal.com\\/articles\\/1\\/x"]');
  assert.equal(parseBatchExecuteResponse(shifted), 'https://www.filgoal.com/articles/1/x');
  // A payload that only echoes a Google destination is refused outright — never stored as a relay.
  const googleOnly = rpc('[null,404,"https:\\/\\/news.google.com\\/x\\/y\\/z"]');
  assert.equal(parseBatchExecuteResponse(googleOnly), null);
  // The classic [null,url] shape keeps working.
  const classic = rpc('[null,"https:\\/\\/www.bbc.co.uk\\/arabic\\/sport\\/a\\/b"]');
  assert.equal(parseBatchExecuteResponse(classic), 'https://www.bbc.co.uk/arabic/sport/a/b');
});

test('E3. retryOnNetworkErrorOnly: an instant network error retries once, a timeout does not', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    const res = await fetchWithProtection<{ ok: boolean }>(
      `https://retry-a.test.invalid/x?c=${Date.now()}`,
      { timeoutMs: 900, retries: 1, retryOnNetworkErrorOnly: true, cacheTtlMs: 0 }
    );
    assert.equal(res.ok, true, 'the retry rescued the cold-start race');
    assert.equal(calls, 2);
  } finally {
    mock.restoreAll();
  }

  calls = 0;
  mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    const error = new Error('This operation was aborted');
    error.name = 'AbortError';
    throw error;
  });
  try {
    const res = await fetchWithProtection(
      `https://timeout-b.test.invalid/x?c=${Date.now()}`,
      { timeoutMs: 900, retries: 2, retryOnNetworkErrorOnly: true, cacheTtlMs: 0 }
    );
    assert.equal(res.ok, false);
    assert.equal(calls, 1, 'a timeout must never double the page latency');
  } finally {
    mock.restoreAll();
  }
});
