import test from 'node:test';
import assert from 'node:assert/strict';
import { metadata as homeMetadata } from '../app/page';
import { generateMetadata as generateDateMetadata } from '../app/matches/[id]/page';
import { generateMetadata as generateNewsMetadata } from '../app/news/page';
import { generateMetadata as generateArchiveMetadata } from '../app/news/archive/page';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import {
  getTodayCairoDate,
  isValidDateParam,
  shiftDateString,
} from '../lib/cairo-time';
import { getGatewayDatabase, queryGatewayMatches } from '../lib/db/store';
import {
  buildMatchLandingPath,
  findCatalogEntryForMatch,
  getAllCatalogEntries,
} from '../lib/matches/match-links';
import { resolveMatchView } from '../lib/matches/match-catalog';
import { buildMatchLandingMetadata } from '../lib/seo/metadata';
import { createMatchScheduleStructuredData, serializeJsonLd } from '../lib/seo/match-structured-data';
import { getArchiveNews, getLatestNews, getPublishedNews } from '../lib/news/query';
import { isIndexableNewsArticle } from '../lib/news/validate';
import { GATEWAY_SITE_URL } from '../lib/site-url';

test('robots exposes the gateway sitemap without blocking public news', () => {
  const result = robots();
  assert.equal(result.sitemap, `${GATEWAY_SITE_URL}/sitemap.xml`);
  const rules = JSON.stringify(result.rules);
  assert.match(rules, /\/admin/);
  assert.match(rules, /\/api/);
  assert.doesNotMatch(rules, /\/news/);
});

test('sitemap contains only canonical, useful dates, match landing pages and indexable news', async () => {
  const entries = await sitemap();
  const today = getTodayCairoDate();
  const start = shiftDateString(today, -1);
  const end = shiftDateString(today, 7);
  const db = getGatewayDatabase();
  const { availableDates } = queryGatewayMatches({});
  const indexableNews = getPublishedNews(db.news).filter(isIndexableNewsArticle);
  const indexableIds = new Set(indexableNews.map((item) => item.id));

  assert.ok(entries.some((entry) => entry.url === `${GATEWAY_SITE_URL}/`));
  for (const entry of entries) {
    assert.ok(entry.url.startsWith(`${GATEWAY_SITE_URL}/`), entry.url);
    assert.equal(new URL(entry.url).search, '', entry.url);
    assert.ok(entry.lastModified instanceof Date, entry.url);
  }
  assert.equal(entries.some((entry) => entry.url === `${GATEWAY_SITE_URL}/matches/${today}`), false);

  // كل مباراة في الكتالوج يجب أن يكون لها رابط في خريطة الموقع مع توقيت تحديث.
  const catalogIds = new Set(getAllCatalogEntries().map((entry) => entry.id));
  const matchEntries = entries.filter((entry) => {
    const last = entry.url.split('/').at(-1) || '';
    return catalogIds.has(decodeURIComponent(last));
  });
  assert.equal(matchEntries.length, catalogIds.size);
  for (const entry of matchEntries) {
    // المباريات القادمة تُحدَّث يوميًا، والمنتهية أسبوعيًا، والجارية كل ساعة.
    assert.ok(['daily', 'weekly', 'hourly'].includes(String(entry.changeFrequency)), entry.url);
    assert.ok((entry.priority ?? 0) >= 0.7, entry.url);
  }
  for (const id of catalogIds) {
    assert.ok(
      matchEntries.some((entry) => entry.url === `${GATEWAY_SITE_URL}/matches/${id}`),
      `missing sitemap entry for ${id}`
    );
  }

  const dateEntries = entries.filter((entry) => {
    if (!entry.url.includes('/matches/')) return false;
    const last = entry.url.split('/').at(-1) || '';
    return isValidDateParam(last);
  });
  for (const entry of dateEntries) {
    const date = entry.url.split('/').at(-1) || '';
    assert.equal(isValidDateParam(date), true, entry.url);
    assert.ok(date >= start && date <= end, entry.url);
    assert.ok(availableDates.some((available) => available.date === date && available.total > 0));
  }

  const newsEntries = entries.filter(
    (entry) => entry.url.includes('/news/') && !entry.url.endsWith('/news/archive')
  );
  for (const entry of newsEntries) {
    const slug = entry.url.split('/').at(-1);
    assert.ok(indexableNews.some((item) => item.slug === slug && indexableIds.has(item.id)));
  }
  if (indexableNews.length === 0) {
    assert.equal(entries.some((entry) => entry.url.endsWith('/news')), false);
    assert.equal(entries.some((entry) => entry.url.endsWith('/news/archive')), false);
  }
});

test('listing pages emit an ItemList that links to the canonical match landing pages', () => {
  const verifiedDate = '2026-10-11';
  const matches = queryGatewayMatches({ cairoDate: verifiedDate }).matches;
  const structured = createMatchScheduleStructuredData(verifiedDate, matches);
  assert.ok(structured);
  const elements = structured.itemListElement as Array<Record<string, unknown>>;
  assert.ok(elements.length > 0);

  // صفحة الجدول قائمة (ItemList) وليست صفحة حدث: لا SportsEvent ناقص الحقول هنا،
  // والبيانات المنظمة الكاملة موجودة في /matches/[id] الخاصة بكل مباراة.
  for (const item of elements) {
    assert.equal(item['@type'], 'ListItem');
    if ('url' in item) {
      const entry = findCatalogEntryForMatch(
        matches.find(
          (match) =>
            item.name === `${match.homeTeam.nameAr} ضد ${match.awayTeam.nameAr} — ${match.competitionNameAr}`
        )!
      );
      assert.ok(entry, 'URL present without a catalog entry');
      assert.equal(item.url, `${GATEWAY_SITE_URL}${buildMatchLandingPath(entry!.id)}`);
    }
  }
  // Structured data doesn't claim an outbound URL; cards link only to exact verified pages.
  for (const match of matches) {
    if (match.nemoLink.verified) {
      assert.equal(match.nemoLink.linkType, 'direct_match');
      assert.match(match.nemoLink.url || '', /^https:\/\/nemo-sports\.vercel\.app\/matches\/.+#live-stream$/);
    } else {
      assert.equal(match.nemoLink.url, null);
      assert.equal(match.nemoLink.linkType, 'unavailable');
    }
  }
  assert.match(serializeJsonLd({ text: '</script>&' }), /\\u003c\/script\\u003e\\u0026/);
});

test('date and news metadata use the same indexability rules as their rendered content', async () => {
  const today = getTodayCairoDate();
  const todayMetadata = await generateDateMetadata({
    params: Promise.resolve({ id: today }),
  });
  assert.equal(todayMetadata.alternates?.canonical, '/');

  const yesterday = shiftDateString(today, -1);
  const yesterdayMetadata = await generateDateMetadata({
    params: Promise.resolve({ id: yesterday }),
  });
  assert.equal(yesterdayMetadata.alternates?.canonical, `/matches/${yesterday}`);
  assert.equal(
    typeof yesterdayMetadata.robots === 'object' && yesterdayMetadata.robots !== null
      ? yesterdayMetadata.robots.index
      : undefined,
    queryGatewayMatches({ cairoDate: yesterday }).matches.length > 0
  );

  assert.equal(homeMetadata.alternates?.canonical, '/');

  const db = getGatewayDatabase();
  const currentNews = getLatestNews(db.news, 24);
  const archiveNews = getArchiveNews(db.news);
  const newsMetadata = await generateNewsMetadata();
  const archiveMetadata = await generateArchiveMetadata();
  assert.equal(
    typeof newsMetadata.robots === 'object' && newsMetadata.robots !== null
      ? newsMetadata.robots.index
      : undefined,
    currentNews.some(isIndexableNewsArticle)
  );
  assert.equal(
    typeof archiveMetadata.robots === 'object' && archiveMetadata.robots !== null
      ? archiveMetadata.robots.index
      : undefined,
    archiveNews.some(isIndexableNewsArticle)
  );
});

test('match landing metadata pins one canonical URL per match and stays indexable', async () => {
  for (const entry of getAllCatalogEntries()) {
    const metadata = await generateDateMetadata({ params: Promise.resolve({ id: entry.id }) });
    assert.equal(metadata.alternates?.canonical, buildMatchLandingPath(entry.id));
    const robotsMeta = typeof metadata.robots === 'object' && metadata.robots !== null ? metadata.robots : null;
    assert.equal(robotsMeta?.index, true, entry.id);
    assert.equal(robotsMeta?.follow, true, entry.id);
    assert.ok(typeof metadata.description === 'string' && metadata.description.length > 80, entry.id);

    const view = resolveMatchView(entry);
    const built = buildMatchLandingMetadata(view);
    assert.equal(built.alternates?.canonical, view.canonicalPath);
    assert.equal(built.openGraph?.url, view.canonicalUrl);
  }
});
