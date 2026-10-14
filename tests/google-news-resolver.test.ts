import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeGoogleNewsArticleToken,
  extractBatchExecuteParams,
  extractGoogleNewsArticleId,
  extractUrlFromInterstitialHtml,
  isGoogleNewsRelayUrl,
  parseBatchExecuteResponse,
  resolveGoogleNewsRelayUrl,
} from '../lib/news/google-news-resolver';
import {
  isTrustedPublisherArticleUrl,
  registrableDomain,
  samePublisherHost,
} from '../lib/news/publisher-domains';
import { enrichArticleFromPublisher, extractBodyExcerpt } from '../lib/news/article-enrichment';
import { isMatchScoreHeadline, validateNewsCandidate } from '../lib/news/validate';
import { parseGoogleNewsRssXml, resolveFeedArticleUrls } from '../lib/sources/google-news-rss';
import type { RawNewsCandidate } from '../lib/types';

/** Builds a real classic Google News token: `\x08\x13\x22` + length byte + publisher URL. */
function buildClassicToken(publisherUrl: string): string {
  const lengthByte = Buffer.from([publisherUrl.length]);
  const payload = Buffer.concat([
    Buffer.from([0x08, 0x13, 0x22]),
    lengthByte,
    Buffer.from(publisherUrl, 'utf-8'),
  ]);
  return payload.toString('base64url');
}

function relayUrlFor(token: string): string {
  return `https://news.google.com/rss/articles/${token}?oc=5`;
}

// ---------------------------------------------------------------------------------------------
// 1. Offline protobuf decoding — the cheap path that needs no network at all.
// ---------------------------------------------------------------------------------------------
test('a classic CBMi token decodes to the publisher URL without any network call', () => {
  const publisherUrl = 'https://www.youm7.com/story/2026/10/12/zamalek-ahly/1234567';
  const relay = relayUrlFor(buildClassicToken(publisherUrl));

  assert.equal(isGoogleNewsRelayUrl(relay), true);
  assert.equal(extractGoogleNewsArticleId(relay), buildClassicToken(publisherUrl));

  const decoded = decodeGoogleNewsArticleToken(relay);
  assert.equal(decoded.error, null);
  assert.equal(decoded.url, publisherUrl);
});

test('an opaque AU_yqL token is reported as opaque instead of being silently dropped', () => {
  const opaque = Buffer.from('\x08\x13\x22\x02AU_yqLODQivyBsop0D9Hn8b2q9ShQbvOcwDGHqKFzzRNUy', 'latin1').toString('base64url');
  const decoded = decodeGoogleNewsArticleToken(relayUrlFor(opaque));
  assert.equal(decoded.url, null);
  assert.ok(decoded.opaqueToken?.startsWith('AU_yqL'));
  assert.equal(decoded.error, 'opaque_token');
});

test('a token that is not a relay URL is rejected, not guessed at', () => {
  assert.equal(decodeGoogleNewsArticleToken('https://www.youm7.com/story/1').error, 'not_a_relay_url');
  assert.equal(decodeGoogleNewsArticleToken('not a url').error, 'not_a_relay_url');
});

// ---------------------------------------------------------------------------------------------
// 2. batchexecute decoding parameters and response parsing.
// ---------------------------------------------------------------------------------------------
test('decoding parameters are lifted out of the relay page bootstrap script', () => {
  const html = `<html><script>AF_initDataCallback({key: 'ds:0', hash: '9', data:[null,null,"AF+dg7QSIGNATURE0xYz","1728740000000000"], sideChannel: {}});</script></html>`;
  const params = extractBatchExecuteParams(html);
  assert.ok(params);
  assert.equal(params.signature, 'AF+dg7QSIGNATURE0xYz');
  assert.equal(params.timestamp, '1728740000000000');
  assert.equal(extractBatchExecuteParams('<html>nothing</html>'), null);
});

test('a batchexecute reply yields the publisher URL', () => {
  const reply = `)]}'\n[[["wrb.fr","Fbv4je","[null,\\"https://www.almasryalyoum.com/sports/news/abc123\\"]",null,null,null,"generic"]]]`;
  assert.equal(parseBatchExecuteResponse(reply), 'https://www.almasryalyoum.com/sports/news/abc123');
  assert.equal(parseBatchExecuteResponse(')]}\'\n[[["wrb.fr","Fbv4je","[null,null]"]]]'), null);
  assert.equal(parseBatchExecuteResponse('not json'), null);
});

test('an opaque token is resolved through the batchexecute RPC end to end', async () => {
  const opaque = Buffer.from('\x08\x13\x22\x02AU_yqLODQivyBsop0D9Hn8b2q9ShQbvOcwDGHqKFzzRNUy', 'latin1').toString('base64url');
  const relay = relayUrlFor(opaque);
  const article = 'https://www.yallakora.com/egypt/2026/10/12/ahly-news/998877';

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('batchexecute')) {
      assert.equal(init?.method, 'POST');
      assert.match(String(init?.body), /f\.req=/);
      assert.match(String(init?.body), /Fbv4je/);
      // The RPC is called with the article id itself, plus the page's signature and timestamp.
      const body = decodeURIComponent(String(init?.body));
      assert.match(body, /CBMi[A-Za-z0-9_-]+/);
      assert.match(body, /AF\+sig/);
      assert.match(body, /1728740000000000/);
      return new Response(
        `)]}'\n[[["wrb.fr","Fbv4je","[null,\\"${article}\\"]",null,null,null,"generic"]]]`,
        { status: 200 }
      );
    }
    // The relay page carrying the decoding parameters.
    return new Response(
      `<html><script>AF_initDataCallback({key: 'ds:0', data:[null,null,"AF+sig","1728740000000000"]});</script></html>`,
      { status: 200 }
    );
  }) as typeof fetch;

  const resolved = await resolveGoogleNewsRelayUrl(relay, { fetchImpl, timeoutMs: 2000 });
  assert.equal(resolved.strategy, 'batchexecute');
  assert.equal(resolved.url, article);
});

// ---------------------------------------------------------------------------------------------
// 3. Redirect chain and JS interstitial.
// ---------------------------------------------------------------------------------------------
test('a relay that 302s to the publisher resolves on the first hop', async () => {
  const token = buildClassicToken('https://news.google.com/never-used');
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: 'https://www.almasryalyoum.com/sports/news/abc123' },
    });
  }) as typeof fetch;

  // Force the network path by using a token the offline decoder cannot read.
  const opaqueRelay = relayUrlFor(Buffer.from('\x08\x13\x22\x02not-a-url-token', 'latin1').toString('base64url'));
  const resolved = await resolveGoogleNewsRelayUrl(opaqueRelay, { fetchImpl, timeoutMs: 2000 });
  assert.equal(resolved.strategy, 'redirect');
  assert.equal(resolved.url, 'https://www.almasryalyoum.com/sports/news/abc123');
  assert.equal(calls, 1);
  void token;
});

test('a JS-only interstitial page has its destination extracted from the HTML', () => {
  assert.equal(
    extractUrlFromInterstitialHtml('<a data-n-au="https://www.youm7.com/story/2026/10/12/x/1">click</a>'),
    'https://www.youm7.com/story/2026/10/12/x/1'
  );
  assert.equal(
    extractUrlFromInterstitialHtml('<script>window.location.replace("https://www.dostor.org/1234567")</script>'),
    'https://www.dostor.org/1234567'
  );
  assert.equal(
    extractUrlFromInterstitialHtml('<a href="https://news.google.com/other">google</a>'),
    null
  );
  assert.equal(extractUrlFromInterstitialHtml('<html>redirecting…</html>'), null);
});

test('an interstitial with no destination resolves to null, never to the relay itself', async () => {
  const relay = relayUrlFor(Buffer.from('\x08\x13\x22\x02not-a-url-token', 'latin1').toString('base64url'));
  const fetchImpl = (async () => new Response('<html>redirecting…</html>', { status: 200 })) as typeof fetch;
  const resolved = await resolveGoogleNewsRelayUrl(relay, { fetchImpl, timeoutMs: 2000 });
  assert.equal(resolved.url, null);
  assert.equal(resolved.error, 'interstitial_without_destination');
});

test('a redirect to a social or Google property is refused', () => {
  assert.equal(isTrustedPublisherArticleUrl('https://www.facebook.com/yallakora/posts/1', null).reason, 'blocked_host');
  assert.equal(isTrustedPublisherArticleUrl('https://news.google.com/rss/articles/abc', null).reason, 'blocked_host');
  assert.equal(isTrustedPublisherArticleUrl('https://youm7.com/', null).reason, 'no_path');
  assert.equal(isTrustedPublisherArticleUrl('ftp://youm7.com/a/b', null).reason, 'not_https');
  assert.equal(isTrustedPublisherArticleUrl('https://user:pass@youm7.com/a/b', null).reason, 'credentials');
});

// ---------------------------------------------------------------------------------------------
// 4. Publisher domain matching (mobile/AMP mirrors belong to the same publisher).
// ---------------------------------------------------------------------------------------------
test('registrable domains group a publisher’s mirrors together', () => {
  assert.equal(registrableDomain('news.youm7.com'), 'youm7.com');
  assert.equal(registrableDomain('www.almasryalyoum.com'), 'almasryalyoum.com');
  assert.equal(registrableDomain('sport.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(registrableDomain('kooora.com'), 'kooora.com');
  assert.equal(samePublisherHost('m.youm7.com', 'www.youm7.com'), true);
  assert.equal(samePublisherHost('www.yallakora.com', 'www.youm7.com'), false);
  assert.equal(samePublisherHost('evil.com', 'com'), false);
});

test('an article on another publisher’s domain is not accepted for this item', () => {
  const article = 'https://www.yallakora.com/egypt/2026/10/12/news/1';
  assert.equal(isTrustedPublisherArticleUrl(article, 'https://www.almasryalyoum.com/').ok, false);
  assert.equal(isTrustedPublisherArticleUrl(article, 'https://www.yallakora.com/').ok, true);
});

// ---------------------------------------------------------------------------------------------
// 5. Feed-level resolution: real items get real publisher links, unresolved ones stay visible.
// ---------------------------------------------------------------------------------------------
function candidate(overrides: Partial<RawNewsCandidate> = {}): RawNewsCandidate {
  return {
    sourceId: 'google-news-rss',
    sourceItemId: 'item-1',
    title: 'الزمالك يستعد لمواجهة الأهلي في قمة الدوري المصري الممتاز',
    link: relayUrlFor(buildClassicToken('https://www.youm7.com/story/2026/10/12/zamalek/1')),
    originalUrl: relayUrlFor(buildClassicToken('https://www.youm7.com/story/2026/10/12/zamalek/1')),
    publishedAt: '2026-10-12T10:00:00.000Z',
    publishedAtKnown: true,
    updatedAt: null,
    excerpt: null,
    imageUrl: null,
    publisherName: 'اليوم السابع',
    publisherUrl: 'https://www.youm7.com/',
    language: 'ar',
    categoryAr: 'الدوري المصري الممتاز',
    fetchedAt: '2026-10-12T12:00:00.000Z',
    ...overrides,
  };
}

test('feed resolution converts relay links into publisher articles and reports every outcome', async () => {
  const good = candidate();
  const mismatched = candidate({
    sourceItemId: 'item-2',
    title: 'الأهلي يعلن قائمته للمباراة المقبلة في الدوري',
    link: relayUrlFor(buildClassicToken('https://www.yallakora.com/egypt/2026/10/12/ahly/2')),
    originalUrl: relayUrlFor(buildClassicToken('https://www.yallakora.com/egypt/2026/10/12/ahly/2')),
  });

  const { candidates, report } = await resolveFeedArticleUrls([good, mismatched], { maxResolved: 2 });

  assert.equal(report.attempted, 2);
  assert.equal(report.resolved, 1);
  assert.equal(report.unresolved, 1);
  assert.equal(report.strategies.decode, 1);
  assert.ok(Object.keys(report.errors).some((key) => key.startsWith('publisher_mismatch')));

  const resolvedGood = candidates.find((item) => item.sourceItemId === 'item-1');
  assert.equal(resolvedGood?.link, 'https://www.youm7.com/story/2026/10/12/zamalek/1');
  assert.equal(validateNewsCandidate({ ...resolvedGood!, excerpt: null }).code, null);

  // The mismatched item keeps its relay link, so it is rejected visibly instead of vanishing.
  const kept = candidates.find((item) => item.sourceItemId === 'item-2');
  assert.match(kept!.link, /^https:\/\/news\.google\.com/);
  assert.equal(validateNewsCandidate(kept!).ok, false);
});

// ---------------------------------------------------------------------------------------------
// 6. Score-only headlines are match data, not news.
// ---------------------------------------------------------------------------------------------
test('bare scoreboard headlines are rejected; real reporting about a result is not', () => {
  assert.equal(isMatchScoreHeadline('الأهلي 2 - 1 الزمالك'), true);
  assert.equal(isMatchScoreHeadline('Result: 3-0'), true);
  assert.equal(
    isMatchScoreHeadline(
      'ملخص وأهداف مباراة الأهلي ضد الزمالك (2-0) في الدوري المصري الممتاز وحديث المدير الفني عن التحكيم'
    ),
    false
  );
  assert.equal(isMatchScoreHeadline('الزمالك يعلن تعاقده مع مدرب جديد استعدادًا للموسم'), false);
});

test('a score-only item is rejected with its own code', () => {
  const result = validateNewsCandidate(
    candidate({ title: 'الأهلي 2 - 1 الزمالك', link: 'https://www.youm7.com/story/2026/10/12/x/1', originalUrl: 'https://www.youm7.com/story/2026/10/12/x/1' })
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'match_score_only');
});

// ---------------------------------------------------------------------------------------------
// 7. Article enrichment: the publisher’s own summary becomes the excerpt.
// ---------------------------------------------------------------------------------------------
const ARTICLE_HTML = `<!doctype html><html lang="ar"><head>
<title>الزمالك يستعد لقمة الأهلي - اليوم السابع</title>
<meta property="og:title" content="الزمالك يستعد لقمة الأهلي في الدوري المصري">
<meta property="og:description" content="يستعد فريق الزمالك لمواجهة الأهلي في قمة مباريات الجولة السادسة من الدوري المصري الممتاز، حيث أعلن الجهاز الفني قائمة الفريق المختارة للمباراة وخطة التعامل مع الغيابات والإصابات قبل المواجهة المرتقبة على استاد القاهرة الدولي.">
<meta property="og:image" content="/images/zamalek.jpg">
<meta property="og:site_name" content="اليوم السابع">
<meta property="article:published_time" content="2026-10-12T09:30:00Z">
</head><body>
<nav>القائمة الرئيسية</nav>
<p>سطر قصير</p>
<p>يستعد فريق الزمالك لمواجهة الأهلي في قمة مباريات الجولة السادسة من الدوري المصري الممتاز، حيث أعلن الجهاز الفني قائمة الفريق المختارة للمباراة وخطة التعامل مع الغيابات والإصابات.</p>
</body></html>`;

test('enrichment extracts the publisher summary, image, site name and publish date', async () => {
  const fetchImpl = (async () =>
    new Response(ARTICLE_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })) as typeof fetch;

  const enriched = await enrichArticleFromPublisher('https://www.youm7.com/story/2026/10/12/zamalek/1', {
    fetchImpl,
  });
  assert.equal(enriched.ok, true);
  assert.equal(enriched.httpStatus, 200);
  assert.ok(enriched.excerpt && enriched.excerpt.length >= 160, 'a substantive excerpt, not a headline echo');
  assert.match(enriched.excerpt || '', /الجولة السادسة/);
  assert.equal(enriched.imageUrl, 'https://www.youm7.com/images/zamalek.jpg');
  assert.equal(enriched.publisherName, 'اليوم السابع');
  assert.equal(enriched.publishedAt, '2026-10-12T09:30:00.000Z');
});

test('enrichment falls back to body paragraphs when the publisher exposes no description', () => {
  const html = `<html><body><script>var x=1;</script><nav>nav</nav>
  <p>${'فقرة طويلة تحتوي على تفاصيل كافية عن المباراة والفرق والبطولة والسياق المطلوب لاستخراج مقتطف مفيد للقارئ. '.repeat(4)}</p>
  </body></html>`;
  const excerpt = extractBodyExcerpt(html);
  assert.ok(excerpt);
  assert.ok(excerpt.length >= 160);
  assert.equal(excerpt.includes('var x=1'), false);
});

test('a failed enrichment never breaks the pipeline', async () => {
  const fetchImpl = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  const enriched = await enrichArticleFromPublisher('https://www.youm7.com/story/1', { fetchImpl });
  assert.equal(enriched.ok, false);
  assert.match(enriched.error || '', /network down/);
});

// ---------------------------------------------------------------------------------------------
// 8. The RSS parser keeps real publish dates and never invents one.
// ---------------------------------------------------------------------------------------------
test('the RSS parser keeps the feed publish date and never substitutes the fetch time', () => {
  const fetchedAt = '2026-10-12T06:00:00.000Z';
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item>
    <title>الزمالك يعلن قائمته لمواجهة الأهلي - اليوم السابع</title>
    <link>https://news.google.com/rss/articles/${buildClassicToken('https://www.youm7.com/story/2026/10/12/z/1')}?oc=5</link>
    <guid>guid-1</guid>
    <pubDate>Sun, 12 Oct 2026 05:10:00 GMT</pubDate>
    <source url="https://www.youm7.com">اليوم السابع</source>
  </item>
  <item>
    <title>خبر بدون تاريخ - يلا كورة</title>
    <link>https://news.google.com/rss/articles/${buildClassicToken('https://www.yallakora.com/e/2026/10/12/y/2')}?oc=5</link>
    <source url="https://www.yallakora.com/">يلا كورة</source>
  </item>
  </channel></rss>`;

  const parsed = parseGoogleNewsRssXml(xml, 'ar', 'الدوري المصري الممتاز', fetchedAt);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].publishedAt, '2026-10-12T05:10:00.000Z');
  assert.equal(parsed[0].publishedAtKnown, true);
  assert.equal(parsed[1].publishedAtKnown, false);
  assert.equal(parsed[1].publishedAt, null);
  assert.notEqual(parsed[1].publishedAt, fetchedAt);
});
