import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectChangedMatchIds,
  collectChangedPublishedNewsSlugs,
  matchLandingUrl,
  newsArticleUrl,
  normalizeGooglePrivateKey,
  notifyGoogleIndexing,
  toAbsoluteSiteUrl,
  type IndexingNotificationType,
} from '../lib/seo/google-indexing';
import { GATEWAY_SITE_URL } from '../lib/site-url';
import type { MatchRecord, NewsItemRecord } from '../lib/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  حراسة طبقة Google Indexing API (2026-10-19)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  طلب صاحب المنتج: «أول ما ماتش أو خبر جديد يتسيف أو يتحدث يتبعت رابط صفحته
 *  لجوجل أوتوماتيك في الخلفية بنوع URL_UPDATED». هذه الاختبارات تحوّل الطلب إلى
 *  شروط آلية على الطبقة نفسها (بلا أي اتصال شبكي — الإرسال يُحقن بدالة وهمية):
 *    ① المفتاح الخاص يُطبَّع من الصيغتين (أسطر حقيقية أو \n مهرّبة) إلى شكل واحد.
 *    ② بلا GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY لا تُجرى أي مكالمة إطلاقًا —
 *       حتى مع توفر روابط — ولا ينكسر مسار المزامنة (الدالة لا ترمي أبدًا).
 *    ③ الروابط تُطبَّع إلى عناوين مطلقة، ويُزال التكرار، والمدخلات المشوّهة تُرفض.
 *    ④ سقف الحصة يُحترم: لا يتجاوز الإرسال الحد مهما تضخّمت الجولة، والفائض يُحصى.
 *    ⑤ فشل رابط واحد لا يوقف الباقي، وسببه يُحفظ في الملخص ولا يرمي استثناءً.
 *    ⑥ المقارنة «قبل/بعد» لا تُبلِّغ إلا عمّا تغيّر فعلًا: نبضة التحديث الزمنية
 *       (lastUpdatedAt/lastSyncedAt) بلا تغيير محتوى لا تستهلك شيئًا من الحصة.
 */

/** تشغيل دالة (متزامنة أو غير متزامنة) مع متغيّرات بيئة مؤقتة ثم استعادة الحالة السابقة دائمًا. */
async function withEnv(overrides: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const CREDENTIAL_ENV = {
  GOOGLE_CLIENT_EMAIL: 'indexing-bot@example.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\\nMIIFakeTestKeyMaterialOnlyForUnitTests\\n-----END PRIVATE KEY-----\\n',
};

function makeMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 'match-1',
    competitionId: 'egy-premier',
    competitionCode: 'EGY1',
    competitionNameAr: 'الدوري المصري الممتاز',
    competitionNameEn: 'Egyptian Premier League',
    competitionLogo: null,
    countryAr: 'مصر',
    region: 'egypt',
    priority: 10,
    isEgyptianInterest: true,
    seasonLabel: '2026/2027',
    roundLabelAr: null,
    utcKickoff: '2026-10-19T18:00:00.000Z',
    cairoDate: '2026-10-19',
    cairoTime: '9:00 م',
    homeTeam: { id: 'ahly', nameAr: 'الأهلي', nameEn: 'Al Ahly', logoUrl: null, isEgyptian: true },
    awayTeam: { id: 'zamalek', nameAr: 'الزمالك', nameEn: 'Zamalek', logoUrl: null, isEgyptian: true },
    status: 'not_started',
    statusLabelAr: 'لم تبدأ بعد',
    statusNoteAr: null,
    liveMinute: null,
    score: { home: null, away: null },
    venue: null,
    primarySource: 'sportscore',
    contributingSources: ['sportscore'],
    externalIds: {},
    nemoLink: {
      url: null,
      linkType: 'unavailable',
      labelAr: 'شاهد مباشرة',
      subLabelAr: '',
      verified: false,
      matchedBy: [],
      competitionUrl: null,
      scheduleUrl: null,
    },
    lastUpdatedAt: '2026-10-19T08:00:00.000Z',
    ...overrides,
  };
}

/** مقتطف يدوي يتجاوز حد المحتوى الأصيل للفهرسة (200 حرف) حتى يكون الخبر قابلًا للفهرسة. */
const LONG_MANUAL_EXCERPT =
  'تقرير خاص من NEMO Sports: تحليل مفصل وموثق لأطول المواجهات المنتظرة في الدوري المصري هذا الموسم، ' +
  'مع قراءة في أرقام الفريقين والغيابات المؤثرة وحالة الملعب وكل ما يحتاجه المتابع قبل صافرة البداية ' +
  'من مواعيد وقنوات ناقلة وتشكيل متوقع وتحليل فني شامل.';

function makeNews(overrides: Partial<NewsItemRecord> = {}): NewsItemRecord {
  return {
    id: 'news-1',
    origin: 'manual',
    sourceItemId: null,
    sourceId: 'publisher-rss',
    title: 'تعرف على موعد مباراة القمة وقائمة الغيابات المؤكدة',
    slug: 'match-preview-article',
    link: `${GATEWAY_SITE_URL}/news/match-preview-article`,
    originalUrl: null,
    publishedAt: '2026-10-19T09:00:00.000Z',
    publishedAtKnown: true,
    updatedAt: null,
    fetchedAt: '2026-10-19T09:00:00.000Z',
    lastSyncedAt: '2026-10-19T09:00:00.000Z',
    cairoDate: '2026-10-19',
    cairoTimeLabel: '12:00 م',
    excerpt: LONG_MANUAL_EXCERPT,
    imageUrl: null,
    publisherName: 'NEMO Sports',
    publisherUrl: null,
    language: 'ar',
    categoryAr: 'أخبار الكرة',
    publishStatus: 'published',
    rejectionReason: null,
    rejectionReasonAr: null,
    duplicateOfId: null,
    relatedMatchIds: [],
    relatedTeamIds: [],
    relatedCompetitionCodes: [],
    nemoRelatedUrl: null,
    nemoRelatedLabelAr: null,
    ...overrides,
  };
}

test('تطبيع المفتاح الخاص: التحويلات النصية \\n تتحول إلى أسطر حقيقية', () => {
  const escaped = '-----BEGIN-----\\nLINE1\\nLINE2\\n-----END-----\\n';
  const normalized = normalizeGooglePrivateKey(escaped);
  assert.equal(normalized.includes('\\n'), false);
  assert.equal(normalized.split('\n').length >= 4, true);

  const realLines = '-----BEGIN-----\nX\n-----END-----';
  assert.equal(normalizeGooglePrivateKey(realLines), realLines);
});

test('تطبيع الروابط: المسار النسبي يصبح رابطًا مطلقًا للموقع والمشوّه يُرفض', () => {
  assert.equal(toAbsoluteSiteUrl('/matches/ahly-vs-zamalek'), `${GATEWAY_SITE_URL}/matches/ahly-vs-zamalek`);
  assert.equal(toAbsoluteSiteUrl('https://example.com/x?y=1'), 'https://example.com/x?y=1');
  assert.equal(toAbsoluteSiteUrl('javascript:alert(1)'), null);
  assert.equal(toAbsoluteSiteUrl('   '), null);
  assert.equal(toAbsoluteSiteUrl(''), null);
  assert.equal(toAbsoluteSiteUrl(null), null);
});

test('بنّاءا الروابط القانونية يطابقان مسارات الموقع الفعلية', () => {
  assert.equal(matchLandingUrl('egy-derby-2026'), `${GATEWAY_SITE_URL}/matches/egy-derby-2026`);
  assert.equal(newsArticleUrl('match-preview-article'), `${GATEWAY_SITE_URL}/news/match-preview-article`);
});

test('بلا متغيرات البيئة لا يُرسل أي شيء إطلاقًا حتى مع وجود روابط', async () => {
  await withEnv(
    { GOOGLE_CLIENT_EMAIL: undefined, GOOGLE_PRIVATE_KEY: undefined, GOOGLE_INDEXING_ENABLED: undefined },
    async () => {
      const calls: string[] = [];
      const summary = await notifyGoogleIndexing([`${GATEWAY_SITE_URL}/matches/x`], {
        publish: async (url) => {
          calls.push(url);
        },
      });
      assert.equal(summary.configured, false);
      assert.equal(summary.attempted, 0);
      assert.equal(calls.length, 0);
    }
  );
});

test('مفتاح الإيقاف GOOGLE_INDEXING_ENABLED=off يوقف الإرسال كليًا', async () => {
  await withEnv({ ...CREDENTIAL_ENV, GOOGLE_INDEXING_ENABLED: 'off' }, async () => {
    const calls: string[] = [];
    const summary = await notifyGoogleIndexing([`${GATEWAY_SITE_URL}/matches/x`], {
      publish: async (url) => {
        calls.push(url);
      },
    });
    assert.equal(summary.configured, false);
    assert.equal(calls.length, 0);
  });
});

test('الإرسال: تطبيع + إزالة تكرار + إرسال نسبي كمطلق بنوع URL_UPDATED', async () => {
  await withEnv({ ...CREDENTIAL_ENV, GOOGLE_INDEXING_ENABLED: undefined }, async () => {
    const calls: Array<{ url: string; type: IndexingNotificationType }> = [];
    const summary = await notifyGoogleIndexing(
      [
        '/matches/ahly-vs-zamalek',
        `${GATEWAY_SITE_URL}/matches/ahly-vs-zamalek`, // مكرر للمسار نفسه
        '/news/match-preview-article',
        '   ',
        'not-a-url',
      ],
      {
        publish: async (url, type) => {
          calls.push({ url, type });
        },
      }
    );
    assert.equal(summary.configured, true);
    assert.equal(summary.attempted, 2);
    assert.equal(summary.succeeded, 2);
    assert.equal(summary.failed, 0);
    assert.equal(summary.invalid, 1);
    assert.deepEqual(calls, [
      { url: `${GATEWAY_SITE_URL}/matches/ahly-vs-zamalek`, type: 'URL_UPDATED' },
      { url: `${GATEWAY_SITE_URL}/news/match-preview-article`, type: 'URL_UPDATED' },
    ]);
  });
});

test('سقف الحصة يُحترم: لا يُرسل أكثر من الحد والفائض يُحصى في skippedByQuota', async () => {
  await withEnv({ ...CREDENTIAL_ENV, GOOGLE_INDEXING_ENABLED: undefined }, async () => {
    const urls = Array.from({ length: 10 }, (_, index) => `${GATEWAY_SITE_URL}/matches/m${index}`);
    const calls: string[] = [];
    const summary = await notifyGoogleIndexing(urls, {
      maxUrls: 3,
      publish: async (url) => {
        calls.push(url);
      },
    });
    assert.equal(summary.attempted, 3);
    assert.equal(summary.succeeded, 3);
    assert.equal(summary.skippedByQuota, 7);
    assert.equal(calls.length, 3);
  });
});

test('فشل رابط واحد لا يوقف الباقي وسببه يُحفظ بلا رمي استثناء', async () => {
  await withEnv({ ...CREDENTIAL_ENV, GOOGLE_INDEXING_ENABLED: undefined }, async () => {
    const summary = await notifyGoogleIndexing(
      [`${GATEWAY_SITE_URL}/matches/ok-1`, `${GATEWAY_SITE_URL}/matches/broken`, `${GATEWAY_SITE_URL}/matches/ok-2`],
      {
        publish: async (url) => {
          if (url.includes('broken')) {
            const error = new Error('Permission denied') as Error & { response?: { status?: number } };
            error.response = { status: 403 };
            throw error;
          }
        },
      }
    );
    assert.equal(summary.attempted, 3);
    assert.equal(summary.succeeded, 2);
    assert.equal(summary.failed, 1);
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0].url.endsWith('/matches/broken'), true);
    assert.equal(summary.failures[0].error.startsWith('403: '), true);
  });
});

test('كشف تغيّر المباريات: الجديد والمتغيّر يُبلَّغان، ونبضة الوقت وحدها لا', () => {
  const base = makeMatch({ id: 'stay-same' });
  const updated = makeMatch({ id: 'score-changed' });

  const before = [
    base,
    updated,
    makeMatch({ id: 'duplicate-record', duplicateOfId: 'base-winner' }),
  ];
  const after = [
    // نفس المحتوى حرفيًا مع تحديث النبضة فقط ⇒ لا إشعار (منطق المخزن نفسه).
    makeMatch({ id: 'stay-same', lastUpdatedAt: '2026-10-19T12:00:00.000Z' }),
    // تغيير حقيقي: النتيجة ⇒ إشعار.
    makeMatch({ id: 'score-changed', score: { home: 2, away: 1 }, status: 'finished' }),
    // سجل تكرار لا تُدفع صفحته إلى Google حتى لو تغيّر.
    makeMatch({ id: 'duplicate-record', duplicateOfId: 'base-winner', score: { home: 9, away: 9 } }),
    // مباراة ظهرت في هذه الجولة فقط ⇒ إشعار إدراج.
    makeMatch({ id: 'brand-new' }),
  ];

  const changed = collectChangedMatchIds(before, after);
  assert.deepEqual(changed.sort(), ['brand-new', 'score-changed']);
});

test('كشف تغيّر الأخبار: القابل للفهرسة الجديد/المتغيّر فقط، ونبضة المزامنة وحدها لا', () => {
  const before = [
    makeNews({ id: 'same' }),
    makeNews({ id: 'text-changed' }),
    makeNews({ id: 'not-indexable', origin: 'source', excerpt: 'قصير', link: 'https://news.google.com/rss/articles/x' }),
  ];
  const after = [
    // lastSyncedAt/fetchedAt تتجددان كل جولة — وحدهما لا يجوز أن يكلفا طلبًا من الحصة.
    makeNews({ id: 'same', lastSyncedAt: '2026-10-19T13:00:00.000Z', fetchedAt: '2026-10-19T13:00:00.000Z' }),
    makeNews({ id: 'text-changed', title: 'عنوان جديد كليًا بعد التعديل اليدوي من اللوحة' }),
    makeNews({ id: 'not-indexable', origin: 'source', excerpt: 'قصير', link: 'https://news.google.com/rss/articles/x' }),
    // خبر جديد اكتمل فيه شرط الفهرسة في هذه الجولة.
    makeNews({ id: 'new-indexable', slug: 'fresh-article' }),
  ];

  const slugs = collectChangedPublishedNewsSlugs(before, after);
  assert.deepEqual(slugs.sort(), ['fresh-article', 'match-preview-article']);
});
