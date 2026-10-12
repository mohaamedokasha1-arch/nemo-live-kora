import test from 'node:test';
import assert from 'node:assert/strict';
import { metadata as homeMetadata } from '../app/page';
import { generateMetadata as generateDateMetadata } from '../app/matches/[date]/page';
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

test('sitemap contains only canonical, useful dates and indexable news', () => {
  const entries = sitemap();
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
  }
  assert.equal(entries.some((entry) => entry.url === `${GATEWAY_SITE_URL}/matches/${today}`), false);

  const dateEntries = entries.filter((entry) => entry.url.includes('/matches/'));
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

test('sports-event JSON-LD carries no per-match URL and matches the visible card content', () => {
  const verifiedDate = '2026-10-11';
  const matches = queryGatewayMatches({ cairoDate: verifiedDate }).matches;
  const structured = createMatchScheduleStructuredData(verifiedDate, matches);
  assert.ok(structured);
  const elements = structured.itemListElement as Array<{
    item: Record<string, unknown>;
  }>;
  assert.ok(elements.length > 0);
  // No per-match page exists for the gateway to point at, so no SportsEvent gets a url.
  for (const { item } of elements) {
    assert.equal('url' in item, false);
  }
  // Every visible card's CTA is the general broadcast section, so nothing else is claimed.
  for (const match of matches) {
    assert.equal(match.nemoLink.url, 'https://nemo-sports.vercel.app/watch');
  }
  assert.match(serializeJsonLd({ text: '</script>&' }), /\\u003c\/script\\u003e\\u0026/);
});

test('date and news metadata use the same indexability rules as their rendered content', async () => {
  const today = getTodayCairoDate();
  const todayMetadata = await generateDateMetadata({
    params: Promise.resolve({ date: today }),
  });
  assert.equal(todayMetadata.alternates?.canonical, '/');

  const yesterday = shiftDateString(today, -1);
  const yesterdayMetadata = await generateDateMetadata({
    params: Promise.resolve({ date: yesterday }),
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
