import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { metadata, default as LegacyLayout } from '../app/match/[id]/layout';
import { matchesData } from '../lib/data/matches';
import { metadata as scheduleMetadata } from '../app/matches/page';

test('legacy records retain their children without UI replacement', async () => {
  for (const match of matchesData) {
    assert.equal(await LegacyLayout({ children: 'unchanged', params: Promise.resolve({ id: match.id }) }), 'unchanged');
  }
});
test('unknown legacy identifiers throw Next not-found instead of serving a soft 404', async () => {
  await assert.rejects(LegacyLayout({ children: 'unchanged', params: Promise.resolve({ id: 'does-not-exist-xyz' }) }), /NEXT_HTTP_ERROR_FALLBACK;404/);
});
test('unverified legacy fixtures are explicitly noindex for general and Google crawlers', () => {
  assert.deepEqual(metadata.robots, { index: false, follow: true, googleBot: { index: false, follow: true } });
});
test('schedule has its own canonical, not the homepage or a child match', () => {
  assert.equal(scheduleMetadata.alternates?.canonical, '/matches');
  assert.equal(scheduleMetadata.openGraph?.url, 'https://nemo-live-kora.vercel.app/matches');
});
test('static sitemap entries do not invent modification dates at request time', () => {
  const source = readFileSync('app/sitemap.ts', 'utf8');
  for (const path of ['/about', '/contact', '/privacy-policy', '/terms']) {
    const start = source.indexOf('url: `${GATEWAY_SITE_URL}' + path + '`');
    assert.ok(start >= 0);
    const entry = source.slice(start).split('    },')[0];
    assert.doesNotMatch(entry, /lastModified/);
  }
});
