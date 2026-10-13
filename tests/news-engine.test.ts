import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseGoogleNewsRssXml,
  resolveGoogleNewsArticleUrl,
} from '../lib/sources/google-news-rss';
import { processNewsBatch } from '../lib/news/ingest';
import {
  isIndexableNewsArticle,
  validateNewsCandidate,
} from '../lib/news/validate';
import { migrateNewsItem } from '../lib/news/migrate';
import { getLatestNews, getPublishedNews, findNewsBySlug } from '../lib/news/query';
import { SOURCE_CAPABILITIES } from '../lib/news/capabilities';
import { compareNewsByRealDate } from '../lib/news/age-policy';
import { linkNewsToMatches } from '../lib/news/match-linker';
import { RawNewsCandidate } from '../lib/types';
import { EGYPTIAN_TEAMS_CATALOG, CANONICAL_COMPETITIONS } from '../lib/catalog';

const fetchedAt = '2026-10-12T06:00:00.000Z';

const REAL_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>ملخص وأهداف مباراة الأهلي ضد الزمالك (2-0) في الدوري المصري الممتاز - المصري اليوم</title>
    <link>https://news.google.com/rss/articles/CBMiAhlyZamalek</link>
    <guid>guid-ahly-zamalek</guid>
    <pubDate>Sun, 11 Oct 2026 16:11:00 GMT</pubDate>
    <description><![CDATA[<a href="https://news.google.com/rss/articles/CBMiAhlyZamalek">ملخص وأهداف مباراة الأهلي ضد الزمالك (2-0) في الدوري المصري الممتاز</a>&nbsp;&nbsp;<font color="#6f6f6f">المصري اليوم</font>]]></description>
    <source url="https://www.almasryalyoum.com/">المصري اليوم</source>
  </item>
  <item>
    <title>تشكيل الأهلي.. مفاجآت بالدفاع وثلاثي هجومي أمام الزمالك - يلاكورة</title>
    <link>https://news.google.com/rss/articles/CBMiLineup</link>
    <guid>guid-lineup</guid>
    <pubDate>Sun, 11 Oct 2026 15:43:00 GMT</pubDate>
    <source url="https://www.yallakora.com/">يلاكورة</source>
  </item>
</channel></rss>`;

function candidate(overrides: Partial<RawNewsCandidate> = {}): RawNewsCandidate {
  return {
    sourceId: 'google-news-rss',
    sourceItemId: 'src-1',
    title: 'الأهلي يفوز على الزمالك في قمة الدوري المصري',
    link: 'https://www.almasryalyoum.com/sports/news/abc123',
    originalUrl: 'https://www.almasryalyoum.com/sports/news/abc123',
    publishedAt: '2026-10-11T16:11:00.000Z',
    publishedAtKnown: true,
    updatedAt: null,
    excerpt: null,
    imageUrl: null,
    publisherName: 'المصري اليوم',
    publisherUrl: 'https://www.almasryalyoum.com/',
    language: 'ar',
    categoryAr: 'الدوري المصري الممتاز',
    fetchedAt,
    ...overrides,
  };
}

const emptyContext = {
  matches: [],
  teams: EGYPTIAN_TEAMS_CATALOG,
  competitions: CANONICAL_COMPETITIONS,
};

test('News parser extracts real RSS items without inventing today as publishedAt', () => {
  const parsed = parseGoogleNewsRssXml(REAL_RSS, 'ar', 'الدوري المصري', fetchedAt);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].publisherName, 'المصري اليوم');
  assert.equal(
    parsed[0].title,
    'ملخص وأهداف مباراة الأهلي ضد الزمالك (2-0) في الدوري المصري الممتاز'
  );
  assert.equal(parsed[0].publishedAtKnown, true);
  assert.equal(parsed[0].publishedAt, '2026-10-11T16:11:00.000Z');
  assert.equal(parsed[0].fetchedAt, fetchedAt);
  assert.notEqual(parsed[0].publishedAt, fetchedAt);
  assert.equal(validateNewsCandidate(parsed[0]).ok, false);
  assert.equal(validateNewsCandidate(parsed[0]).code, 'invalid_url');
});

test('Google News redirects resolve only to the RSS item’s named publisher', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    assert.equal(new URL(String(_input)).hostname, 'news.google.com');
    assert.equal(init?.redirect, 'manual');
    return new Response(null, {
      status: 302,
      headers: { location: 'https://www.almasryalyoum.com/sports/news/abc123' },
    });
  };

  try {
    const directUrl = await resolveGoogleNewsArticleUrl(
      candidate({
        link: 'https://news.google.com/rss/articles/abc123',
        originalUrl: 'https://news.google.com/rss/articles/abc123',
      })
    );
    assert.equal(directUrl, 'https://www.almasryalyoum.com/sports/news/abc123');
    assert.equal(calls, 1);

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: 'https://www.yallakora.com/sports/news/other' },
      });
    };
    const mismatched = await resolveGoogleNewsArticleUrl(
      candidate({
        link: 'https://news.google.com/rss/articles/abc123',
        originalUrl: 'https://news.google.com/rss/articles/abc123',
      })
    );
    assert.equal(mismatched, null);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Missing pubDate is marked unknown and never replaced with fetch time', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <title>خبر بدون تاريخ من يلا كورة</title>
    <link>https://news.google.com/rss/articles/nodate</link>
    <source url="https://www.yallakora.com/">يلا كورة</source>
  </item></channel></rss>`;
  const parsed = parseGoogleNewsRssXml(xml, 'ar', 'الدوري المصري', fetchedAt);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].publishedAt, null);
  assert.equal(parsed[0].publishedAtKnown, false);
});

test('Invalid URL, empty response, and error-like titles are rejected', () => {
  const invalidUrl = validateNewsCandidate(
    candidate({
      link: 'https://news.google.com/rss/search?q=test',
      originalUrl: 'https://news.google.com/rss/search?q=test',
    })
  );
  assert.equal(invalidUrl.ok, false);
  assert.equal(invalidUrl.code, 'invalid_url');

  const googleRelay = validateNewsCandidate(
    candidate({
      link: 'https://news.google.com/rss/articles/abc123',
      originalUrl: 'https://news.google.com/rss/articles/abc123',
    })
  );
  assert.equal(googleRelay.ok, false);
  assert.equal(googleRelay.code, 'invalid_url');

  const mismatchedPublisher = validateNewsCandidate(
    candidate({ publisherUrl: 'https://www.yallakora.com/' })
  );
  assert.equal(mismatchedPublisher.ok, false);
  assert.equal(mismatchedPublisher.code, 'invalid_url');

  const publicSuffixPublisher = validateNewsCandidate(
    candidate({
      link: 'https://attacker.com/sports/news/story',
      originalUrl: 'https://attacker.com/sports/news/story',
      publisherUrl: 'https://com/',
    })
  );
  assert.equal(publicSuffixPublisher.ok, false);
  assert.equal(publicSuffixPublisher.code, 'invalid_url');

  const emptyTitle = validateNewsCandidate(candidate({ title: '  ' }));
  assert.equal(emptyTitle.ok, false);

  const errorPage = validateNewsCandidate(
    candidate({ title: 'Access Denied - just a moment' })
  );
  assert.equal(errorPage.ok, false);
  assert.equal(errorPage.code, 'error_page');

  const scoreOnly = validateNewsCandidate(candidate({ title: '2-0' }));
  assert.equal(scoreOnly.ok, false);
});

test('Empty RSS produces no published news and keeps previous published items', () => {
  const first = processNewsBatch([], [candidate()], emptyContext);
  assert.equal(first.stats.published, 1);
  const emptyXml = parseGoogleNewsRssXml('<rss><channel></channel></rss>');
  assert.equal(emptyXml.length, 0);
  const second = processNewsBatch(first.news, emptyXml, emptyContext);
  assert.equal(second.stats.imported, 0);
  assert.equal(getPublishedNews(second.news).length, 1);
});

test('Saving a new article then retrying the same item updates instead of duplicating', () => {
  const first = processNewsBatch([], [candidate()], emptyContext);
  assert.equal(first.stats.published, 1);
  const second = processNewsBatch(
    first.news,
    [candidate({ title: 'الأهلي يفوز على الزمالك في قمة الدوري المصري - تحديث' })],
    emptyContext
  );
  assert.equal(second.stats.updated, 1);
  assert.equal(getPublishedNews(second.news).length, 1);
  assert.equal(second.news[0].slug, first.news[0].slug);
});

test('Same publisher similar titles are duplicates; different publishers can both publish', () => {
  const first = processNewsBatch([], [candidate()], emptyContext);
  const dup = processNewsBatch(
    first.news,
    [
      candidate({
        sourceItemId: 'src-2',
        link: 'https://www.almasryalyoum.com/sports/news/other',
        originalUrl: 'https://www.almasryalyoum.com/sports/news/other',
        title: 'الأهلي يفوز على الزمالك في قمة الدوري المصري اليوم',
      }),
    ],
    emptyContext
  );
  assert.equal(dup.stats.duplicates, 1);
  assert.equal(getPublishedNews(dup.news).length, 1);
  assert.equal(getLatestNews(dup.news, 20).every((item) => item.publishStatus === 'published'), true);

  const otherPublisher = processNewsBatch(
    first.news,
    [
      candidate({
        sourceItemId: 'src-3',
        link: 'https://www.filgoal.com/sports/news/filgoal',
        originalUrl: 'https://www.filgoal.com/sports/news/filgoal',
        publisherName: 'FilGoal',
        publisherUrl: 'https://www.filgoal.com/',
        title: 'موعد مباراة بيراميدز وسيراميكا كليوباترا في الدوري',
      }),
    ],
    emptyContext
  );
  assert.equal(getPublishedNews(otherPublisher.news).length, 2);
});

test('Rejected news never appears in latest or public slug lookup', () => {
  const result = processNewsBatch(
    [],
    [
      candidate(),
      candidate({
        sourceItemId: 'bad',
        title: 'خبر بحث',
        link: 'https://news.google.com/rss/search?q=ahly',
        originalUrl: 'https://news.google.com/rss/search?q=ahly',
      }),
    ],
    emptyContext
  );
  const latest = getLatestNews(result.news, 20);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].title.includes('الأهلي'), true);
  const rejected = result.news.find((item) => item.publishStatus === 'rejected');
  assert.ok(rejected);
  assert.equal(findNewsBySlug(result.news, rejected.slug), undefined);
});

test('News detail is indexable only with a dated, direct publisher URL and a substantive excerpt', () => {
  const longExcerpt =
    'تفاصيل موثقة من المصدر الأصلي حول المباراة وتطوراتها وأسماء الفرق والبطولة، مع سياق واضح يساعد القارئ على فهم الخبر دون نسخ نص المقال كاملًا. '.repeat(2);
  const valid = processNewsBatch(
    [],
    [candidate({ excerpt: longExcerpt })],
    emptyContext
  ).news[0];
  assert.equal(isIndexableNewsArticle(valid), true);
  assert.equal(
    isIndexableNewsArticle({ ...valid, originalUrl: 'https://news.google.com/rss/articles/abc123' }),
    false
  );
  assert.equal(isIndexableNewsArticle({ ...valid, excerpt: 'عنوان فقط' }), false);
});

test('News without a known publish date is excluded from the latest section', () => {
  const result = processNewsBatch(
    [],
    [candidate({ publishedAt: null, publishedAtKnown: false, sourceItemId: 'no-date' })],
    emptyContext
  );
  assert.equal(result.stats.published, 1);
  assert.equal(getLatestNews(result.news, 20).length, 0);
  assert.equal(getPublishedNews(result.news).length, 1);
  assert.equal(result.news[0].cairoTimeLabel, 'تاريخ النشر غير معروف');
});

test('Sorting uses original publish dates, not fetch time', () => {
  const older = candidate({
    sourceItemId: 'old',
    publishedAt: '2026-10-10T12:00:00.000Z',
    link: 'https://www.almasryalyoum.com/sports/news/old',
    originalUrl: 'https://www.almasryalyoum.com/sports/news/old',
    title: 'خبر أقدم عن المصري البورسعيدي',
    fetchedAt: '2026-10-12T09:00:00.000Z',
  });
  const newer = candidate({
    sourceItemId: 'new',
    publishedAt: '2026-10-11T20:00:00.000Z',
    link: 'https://www.almasryalyoum.com/sports/news/new',
    originalUrl: 'https://www.almasryalyoum.com/sports/news/new',
    title: 'خبر أحدث عن بيراميدز',
    fetchedAt: '2026-10-12T08:00:00.000Z',
  });
  const result = processNewsBatch([], [older, newer], emptyContext);
  const published = getPublishedNews(result.news);
  assert.equal(published[0].sourceItemId, 'new');
  assert.ok(compareNewsByRealDate(published[0], published[1]) <= 0);
});

test('Seed search-URL items are migrated to rejected and never shown as live news', () => {
  const migrated = migrateNewsItem({
    id: 'news-gn-ar-1',
    title: 'جدول ترتيب الدوري المصري الممتاز بعد انتهاء مباريات الجولة السادسة',
    link: 'https://news.google.com/rss/search?q=test&hl=ar',
    publishedAt: '2026-10-11T21:30:00Z',
    publisherName: 'المصري اليوم',
    sourceId: 'google-news-rss',
  });
  assert.equal(migrated.publishStatus, 'rejected');
  assert.equal(migrated.rejectionReason, 'invalid_url');
});

test('Only Google News RSS is a news source among the five approved sources', () => {
  assert.equal(SOURCE_CAPABILITIES.sportscore.providesNews, false);
  assert.equal(SOURCE_CAPABILITIES['football-data'].providesNews, false);
  assert.equal(SOURCE_CAPABILITIES.thesportsdb.providesNews, false);
  assert.equal(SOURCE_CAPABILITIES['api-football'].providesNews, false);
  assert.equal(SOURCE_CAPABILITIES['google-news-rss'].providesNews, true);
});

test('News can link to NEMO Sports only when a verified related page exists', () => {
  const linked = linkNewsToMatches(
    'ملخص مباراة الأهلي ضد الزمالك في الدوري المصري',
    '2026-10-11T16:11:00.000Z',
    emptyContext
  );
  assert.ok(linked.relatedTeamIds.includes('team-al-ahly'));
  assert.ok(linked.relatedTeamIds.includes('team-zamalek'));
  assert.ok(
    !linked.nemoRelatedUrl || linked.nemoRelatedUrl.startsWith('https://nemo-sports.vercel.app/')
  );
});

test('A failed source does not wipe previously published news', () => {
  const first = processNewsBatch([], [candidate()], emptyContext);
  const afterFailure = processNewsBatch(first.news, [], emptyContext);
  assert.equal(getPublishedNews(afterFailure.news).length, 1);
});

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('Cron and admin routes stay protected and do not leak secrets in public files', () => {
  const cronNews = fs.readFileSync(
    path.join(repoRoot, 'app/api/cron/sync-news/route.ts'),
    'utf-8'
  );
  const cronSync = fs.readFileSync(
    path.join(repoRoot, 'app/api/cron/sync/route.ts'),
    'utf-8'
  );
  const publicSources = fs.readFileSync(
    path.join(repoRoot, 'app/api/sources/route.ts'),
    'utf-8'
  );
  assert.match(cronNews, /requireCronAuth/);
  assert.match(cronSync, /requireCronAuth/);
  assert.doesNotMatch(publicSources, /CRON_SECRET/);
  assert.doesNotMatch(publicSources, /process\.env/);
  const envExample = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf-8');
  assert.match(envExample, /CRON_SECRET=/);
  assert.doesNotMatch(envExample, /CRON_SECRET=.+/);
});

test('News pages, canonical paths, sitemap, and robots include news routes', () => {
  const root = repoRoot;
  assert.equal(fs.existsSync(path.join(root, 'app/news/page.tsx')), true);
  assert.equal(fs.existsSync(path.join(root, 'app/news/[slug]/page.tsx')), true);
  assert.equal(fs.existsSync(path.join(root, 'app/news/archive/page.tsx')), true);
  const article = fs.readFileSync(path.join(root, 'app/news/[slug]/page.tsx'), 'utf-8');
  assert.match(article, /canonical: `\/news\/\$\{item\.slug\}`/);
  assert.match(article, /NewsArticle/);
  assert.match(article, /datePublished/);
  const sitemap = fs.readFileSync(path.join(root, 'app/sitemap.ts'), 'utf-8');
  assert.match(sitemap, /\/news\/\$\{item\.slug\}/);
  const robots = fs.readFileSync(path.join(root, 'app/robots.ts'), 'utf-8');
  assert.match(robots, /sitemap/);
  assert.match(robots, /\/admin/);
  assert.doesNotMatch(robots, /disallow:.*\/news/i);
});

test('Existing match gateway files remain in place', () => {
  const root = repoRoot;
  for (const rel of [
    'app/page.tsx',
    'app/matches/[id]/page.tsx',
    'components/MatchCard.tsx',
    'lib/nemo-resolver.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
  }
});
