import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateStore } from '../lib/db/store';
import { processNewsBatch } from '../lib/news/ingest';
import { getLatestNews, getPublishedNews, getNewsListingItems } from '../lib/news/query';
import { isIndexableNewsArticle } from '../lib/news/validate';
import { generateMetadata } from '../app/news/page';
import sitemap from '../app/sitemap';
import { GATEWAY_SITE_URL } from '../lib/site-url';

// Synthetic data confined to this test process; never written to the real store.
test('news fallback articles keep listing metadata and sitemap consistent with displayed content', async () => {
  const db = await hydrateStore();
  const original = db.news;
  try {
    db.news = processNewsBatch([], [{
      sourceId: 'google-news-rss', sourceItemId: 'seo-fixture',
      title: 'Synthetic football article for listing regression testing only',
      link: 'https://www.theguardian.com/football/2020/jan/01/test-story',
      originalUrl: 'https://www.theguardian.com/football/2020/jan/01/test-story',
      publishedAt: '2020-01-01T12:00:00Z', publishedAtKnown: true,
      updatedAt: null, excerpt: 'Synthetic test excerpt only. '.repeat(20), imageUrl: null,
      publisherName: 'The Guardian', publisherUrl: 'https://www.theguardian.com',
      language: 'en', categoryAr: 'كرة القدم', fetchedAt: '2020-01-01T12:00:00Z',
    }], { matches: [], teams: [], competitions: [] }).news;
    assert.equal(getLatestNews(db.news, 24).length, 0);
    assert.equal(getPublishedNews(db.news).filter(isIndexableNewsArticle).length, 1);
    // Preserve the exact existing fallback, limit and ordering behavior.
    assert.deepEqual(getNewsListingItems(db.news), getPublishedNews(db.news).slice(0, 24));
    const fresh = { ...db.news[0], id: 'fresh-fixture', publishedAt: new Date().toISOString() };
    assert.deepEqual(getNewsListingItems([...db.news, fresh]), [fresh]);
    assert.deepEqual(getNewsListingItems([]), []);
    assert.deepEqual(getNewsListingItems([{ ...fresh, publishStatus: 'rejected' }]), []);
    const metadata = await generateMetadata();
    assert.equal(typeof metadata.robots === 'object' && metadata.robots?.index, true);
    assert.ok((await sitemap()).some(entry => entry.url === `${GATEWAY_SITE_URL}/news`));
  } finally {
    db.news = original;
  }
});
