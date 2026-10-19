import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateMetadata as generateMatchMetadata } from '../app/matches/[id]/page';
import sitemap from '../app/sitemap';
import { buildCatalogEntryFromManual } from '../lib/admin/manual-document';
import type { ManualMatchRecord } from '../lib/admin/manual-document';
import { findServedCatalogEntryById } from '../lib/admin/served-catalog';
import {
  getCatalogSitemapItems,
  isIndexableCatalogEntry,
  resolveMatchView,
  validateMatchCatalog,
  validateMatchCatalogEntry,
} from '../lib/matches/match-catalog';
import { resolveMatchDetailTargetSync } from '../lib/matches/resolve-match';
import { buildMatchLandingMetadata } from '../lib/seo/metadata';
import { GATEWAY_SITE_URL } from '../lib/site-url';
import { MATCH_CATALOG } from '../data/matches';
import type { MatchCatalogEntry } from '../lib/matches/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  فهرسة صفحات المباريات — التغطية الإلزامية (2026-10-19)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  الهدف المُثبت من الفحص: مباراة جديدة تُضاف من لوحة الإدارة كانت تحصل على
 *  `robots: noindex` رغم أنها مُعلنة في خريطة الموقع — فلن تُفهرسها محركات البحث
 *  أبدًا، مع تعارض صريح بين إشارة الخريطة وإشارة الصفحة. وحقل «قابل للفهرسة»
 *  (`ManualMatchRecord.indexable`) كان يُحفظ ثم يُتجاهل.
 *
 *  الاختبارات هنا تفرض:
 *   ① مباراة جديدة (المسار الحقيقي: `createManualMatch`) → صفحة مفهرسة + رابط في
 *      `/sitemap.xml` تلقائيًا، بلا أي تدخل يدوي في ملف الخريطة.
 *   ② حقل «قابل للفهرسة» يعمل فعليًا في الاتجاهين.
 *   ③ ثابت عدم التعارض: كل رابط مباراة في الخريطة تقول صفحته `index: true`،
 *      وlastmod تاريخ حقيقي صالح — بلا روابط مكررة أو وهمية أو غير صالحة.
 *   ④ التدقيق الصارم لجودة `data/matches.ts` يبقى كما هو (لم يُخفَّض لحل الخلل).
 *   ⑤ صفحة مباراة حقيقية تُفتح مباشرة ببياناتها الصحيحة وترتيب فريقيها كما هو.
 */

/* ── بيئة تخزين الإدارة: قرص مؤقت — نفس نمط tests/admin-console.test.ts ────────── */

let dataDir = '';
const environmentKeys = [
  'NEMO_DATA_DIR',
  'NEMO_GATEWAY_STORE_PERSIST',
  'NEMO_MANUAL_FILE_DURABLE',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'VERCEL',
  'VERCEL_ENV',
] as const;

let service: typeof import('../lib/admin/service');
let store: typeof import('../lib/db/store');

const OWNER = { username: 'admin', role: 'owner' as const };

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nemo-match-indexing-'));
  process.env.NEMO_DATA_DIR = dataDir;
  store = await import('../lib/db/store');
  service = await import('../lib/admin/service');
});

beforeEach(() => {
  for (const key of environmentKeys) delete process.env[key];
  process.env.NEMO_DATA_DIR = dataDir;
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  // تخزين ملف محلي على قرص قابل للكتابة = تخزين دائم حقيقي (وهو ما تحتاجه الكتابة).
  process.env.NEMO_MANUAL_FILE_DURABLE = 'true';
});

function manualMatchForm(overrides: Record<string, unknown> = {}) {
  return {
    homeNameAr: 'الإسماعيلي',
    homeNameEn: 'Ismaily',
    awayNameAr: 'المصري البورسعيدي',
    awayNameEn: 'Al Masry',
    competitionCode: 'EGY',
    kickoffUtc: '2026-10-25T17:00:00Z',
    status: 'scheduled' as const,
    ...overrides,
  };
}

/** سجل يدوي كما يبنيه الخدمة فعلًا — لاختبار طبقة الكتالوج بلا كتابة على القرص. */
function manualCatalogEntry(overrides: Partial<ManualMatchRecord> = {}): MatchCatalogEntry {
  const record = {
    id: 'smouha-vs-ceramica-2026-10-26',
    status: 'scheduled',
    kickoffUtc: '2026-10-26T17:00:00.000Z',
    kickoffConfirmed: true,
    timezone: 'Africa/Cairo',
    cairoDate: '2026-10-26',
    homeTeam: { id: null, nameAr: 'سموحة', nameEn: 'Smouha', logoUrl: null, countryAr: 'مصر' },
    awayTeam: {
      id: null,
      nameAr: 'سيراميكا كليوباترا',
      nameEn: 'Ceramica Cleopatra',
      logoUrl: null,
      countryAr: 'مصر',
    },
    competitionCode: 'EGY',
    competitionNameAr: 'الدوري المصري الممتاز',
    competitionNameEn: 'Egyptian Premier League',
    competitionCountryAr: 'مصر',
    region: 'egypt',
    seasonLabel: '2026-2027',
    roundLabelAr: null,
    venue: null,
    cityAr: null,
    score: { home: null, away: null },
    incidents: [],
    statusNoteAr: null,
    channelAr: null,
    broadcast: {
      status: 'unverified',
      url: null,
      labelAr: 'مشاهدة التغطية المباشرة',
      notesAr: null,
    },
    keywords: [],
    indexable: true,
    sourceLabelAr: 'إدخال يدوي من لوحة التحكم',
    createdAt: '2026-10-19T00:00:00.000Z',
    createdBy: 'admin',
    updatedAt: '2026-10-19T00:00:00.000Z',
    updatedBy: 'admin',
    ...overrides,
  } as unknown as ManualMatchRecord;
  return buildCatalogEntryFromManual(record);
}

function robotsIndex(metadata: Awaited<ReturnType<typeof generateMatchMetadata>>): unknown {
  return typeof metadata.robots === 'object' && metadata.robots !== null
    ? metadata.robots.index
    : undefined;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  ① مباراة جديدة من لوحة الإدارة: صفحة مفهرسة + رابط في الخريطة تلقائيًا
 * ──────────────────────────────────────────────────────────────────────────── */

test('1) مباراة جديدة من لوحة الإدارة تُفهرس ويُدرج رابطها في خريطة الموقع تلقائيًا', async () => {
  const created = await service.createManualMatch(manualMatchForm(), OWNER);
  assert.equal(created.ok, true, created.messageAr);
  const id = created.data!.id;
  assert.equal(id, 'ismaily-vs-al-masry-2026-10-25');

  // (أ) الصفحة مباشرة بمعرّفها: تُفتح على صفحة الهبوط نفسها، بلا 404 ولا تحويل.
  const target = resolveMatchDetailTargetSync(id);
  assert.equal(target.kind, 'catalog', `معرّف المباراة اليدوية لا يفتح صفحة هبوط: ${target.kind}`);

  // (ب) وصف الصفحة: عنوان ووصف وcanonical صحيحان + الفهرسة مفعّلة (لا noindex مقصود).
  const metadata = await generateMatchMetadata({ params: Promise.resolve({ id }) });
  assert.equal(robotsIndex(metadata), true, 'noindex غير مقصود على مباراة جديدة من اللوحة');
  assert.ok(String(metadata.title).includes('الإسماعيلي'), String(metadata.title));
  assert.ok(String(metadata.title).includes('المصري'), String(metadata.title));
  assert.ok(String(metadata.description || '').length > 40, 'الوصف مفقود أو قصير جدًا');
  assert.equal(metadata.alternates?.canonical, `/matches/${id}`);

  // (ج) خريطة الموقع: الرابط يُضاف تلقائيًا بمجرد إضافة المباراة — بلا تعديل يدوي.
  const entries = await sitemap();
  const found = entries.find((entry) => entry.url === `${GATEWAY_SITE_URL}/matches/${id}`);
  assert.ok(found, `رابط المباراة الجديدة لم يُدرج في خريطة الموقع: ${id}`);
  assert.ok(found!.lastModified instanceof Date, 'lastmod يجب أن يكون تاريخًا حقيقيًا');
  assert.equal(Number.isNaN(found!.lastModified!.getTime()), false, 'lastmod غير صالح');
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ② حقل «قابل للفهرسة» من اللوحة يعمل فعليًا (كان يُحفظ ويُتجاهل)
 * ──────────────────────────────────────────────────────────────────────────── */

test('2) حقل «قابل للفهرسة» يحكم الصفحة والخريطة معًا في الاتجاهين', async () => {
  const created = await service.createManualMatch(
    manualMatchForm({
      homeNameAr: 'فاركو',
      homeNameEn: 'Farco',
      awayNameAr: 'إنبي',
      awayNameEn: 'ENPPI',
      kickoffUtc: '2026-10-26T17:00:00Z',
      indexable: false,
    }),
    OWNER
  );
  assert.equal(created.ok, true, created.messageAr);
  const id = created.data!.id;

  // الطلب الصريح بعدم الفهرسة → noindex + خارج خريطة الموقع (وهو معنى الحقل الموثّق).
  const metadata = await generateMatchMetadata({ params: Promise.resolve({ id }) });
  assert.equal(robotsIndex(metadata), false, 'المباراة المعلَّمة «غير قابلة للفهرسة» يجب أن تقول noindex');
  const entries = await sitemap();
  assert.equal(
    entries.some((entry) => entry.url === `${GATEWAY_SITE_URL}/matches/${id}`),
    false,
    'المباراة غير القابلة للفهرسة لا تدخل خريطة الموقع'
  );

  // والاتجاه المعاكس يبقى صحيحًا: المباراة القابلة للفهرسة (الافتراضي) تدخل الخريطة.
  const defaultEntry = manualCatalogEntry();
  assert.equal(isIndexableCatalogEntry(defaultEntry), true, 'الافتراضي: قابلة للفهرسة');
  const optedOut = manualCatalogEntry({ indexable: false } as Partial<ManualMatchRecord>);
  assert.equal(isIndexableCatalogEntry(optedOut), false, 'الرفض الصريح يُحترم');
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ③ ثابت عدم التعارض: الخريطة والصفحات تتفقان حرفيًا
 * ──────────────────────────────────────────────────────────────────────────── */

test('3) كل رابط مباراة في الخريطة يقول robots.index=true وlastmod صالح — بلا تعارض', async () => {
  const created = await service.createManualMatch(
    manualMatchForm({
      homeNameAr: 'بيراميدز',
      homeNameEn: 'Pyramids',
      awayNameAr: 'زد إف سي',
      awayNameEn: 'ZED FC',
      kickoffUtc: '2026-10-27T17:00:00Z',
    }),
    OWNER
  );
  assert.equal(created.ok, true, created.messageAr);
  const items = getCatalogSitemapItems();

  assert.ok(items.length > 0, 'خريطة الموقع بلا صفحات مباريات');
  for (const item of items) {
    const id = decodeURIComponent(item.path.split('/').pop() || '');
    const entry = findServedCatalogEntryById(id);
    assert.ok(entry, `رابط في الخريطة بلا سجل كتالوج: ${item.path}`);

    // نفس بوابة الوسوم حرفيًا: ما يُدرج في الخريطة يجب أن تكون صفحته قابلة للفهرسة.
    const metadata = buildMatchLandingMetadata(resolveMatchView(entry!));
    const robots =
      typeof metadata.robots === 'object' && metadata.robots !== null ? metadata.robots.index : undefined;
    assert.equal(robots, true, `تعارض: ${item.path} في الخريطة وصفحتها تقول noindex`);

    // lastmod تاريخ حقيقي (لا قيم مصطنعة أو غير صالحة تُفسد XML).
    assert.ok(item.lastModified instanceof Date, item.path);
    assert.equal(Number.isNaN(item.lastModified.getTime()), false, `${item.path}: lastmod غير صالح`);
  }

  // روابط فريدة: لا تكرار للمباراة الواحدة، ولا مباراة وهمية، ولا رابط بمسار إداري.
  const urls = items.map((item) => `${GATEWAY_SITE_URL}${item.path}`);
  assert.equal(new Set(urls).size, urls.length, 'روابط مكررة في خريطة الموقع');
  assert.equal(
    urls.some((url) => url.includes('example-home-team-vs-away-team')),
    false,
    'المباراة الوهمية (النموذج التعليمي) يجب ألا تُدرج أبدًا'
  );
  for (const url of urls) {
    assert.ok(url.startsWith(`${GATEWAY_SITE_URL}/matches/`), `وجهة غير متوقعة: ${url}`);
    assert.equal(/[\s?#]/.test(url.slice(GATEWAY_SITE_URL.length)), false, `رابط غير صالح: ${url}`);
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ④ التدقيق الصارم لجودة الكتالوج يبقى كما هو — بلا تخفيف مُقنَّع
 * ──────────────────────────────────────────────────────────────────────────── */

test('4) التدقيق الصارم يبقى يرفض النواقص، وبوابة الفهرسة تبقى أوسع منه بوعي', () => {
  const entry = manualCatalogEntry();

  // نفس السجل: التدقيق الصارم يطلب حقولًا محسّنة (venue.countryCode مثلًا)…
  const errors = validateMatchCatalogEntry(entry);
  assert.ok(
    errors.some((error) => error.includes('venue.countryCode')),
    'التدقيق الصارم يجب أن يظل يطلب venue.countryCode (لم يُخفَّض)'
  );

  // …لكن صفحة حقيقية كاملة المحتوى تبقى مؤهلة للفهرسة رغم نقص الحقول المحسّنة.
  assert.equal(isIndexableCatalogEntry(entry), true, 'نقص الحقول المحسّنة لا يمنع فهرسة صفحة حقيقية');

  // كتالوج `data/matches.ts` نفسه يبقى سليمًا تحت التدقيق الصارم (بلا مباريات اللوحة).
  assert.deepEqual(validateMatchCatalog(MATCH_CATALOG), [], 'أخطاء في كتالوج data/matches.ts');

  // والمعرّف التالف أو التاريخ المتناقض يُرفض فهرسته — أسباب الرفض الحقيقية تعمل.
  assert.equal(isIndexableCatalogEntry({ ...entry, id: 'BAD ID!' }), false);
  assert.equal(isIndexableCatalogEntry({ ...entry, kickoffUtc: 'not-a-date' }), false);
  assert.equal(
    isIndexableCatalogEntry({ ...entry, cairoDate: '2026-10-27' }),
    false,
    'تاريخ لا يطابق الانطلاق = بيانات منظمة خاطئة'
  );
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ⑤ مباراة حقيقية قائمة: تُفتح مباشرة ببياناتها الصحيحة وترتيب فريقيها كما هو
 * ──────────────────────────────────────────────────────────────────────────── */

test('5) روابط المباريات الحالية تبقى صالحة وتفتح بياناتها الصحيحة بلا قلب للفرق', async () => {
  // (أ) صفحة هبوط كتالوج حقيقية من data/matches.ts.
  const landing = resolveMatchDetailTargetSync('al-ittihad-alexandria-vs-zamalek-2026-10-20');
  assert.equal(landing.kind, 'catalog');
  if (landing.kind === 'catalog') {
    assert.equal(landing.entry.homeTeam.nameAr, 'الاتحاد السكندري', 'الفريق المستضيف تغيّر!');
    assert.equal(landing.entry.awayTeam.nameAr, 'الزمالك', 'الفريق الضيف تغيّر!');
  }
  const landingMeta = await generateMatchMetadata({
    params: Promise.resolve({ id: 'al-ittihad-alexandria-vs-zamalek-2026-10-20' }),
  });
  assert.equal(robotsIndex(landingMeta), true);
  assert.equal(landingMeta.alternates?.canonical, '/matches/al-ittihad-alexandria-vs-zamalek-2026-10-20');

  // (ب) معرّف سجل مصدر لمباراة لها صفحة كتالوج → تحويل إلى الصفحة القانونية (لا صفحة ثانية).
  const alias = resolveMatchDetailTargetSync('match-api-football-1612250');
  assert.equal(alias.kind, 'alias', 'معرّف سجل له صفحة كتالوج يجب أن يتحول إليها');
  if (alias.kind === 'alias') {
    assert.equal(alias.to, '/matches/zamalek-vs-al-ahly-2026-10-11');
  }

  // (ج) صفحة الهبوط تعرض H1 واضحًا (العنوان الوحيد للمباراة).
  const viewSource = fs.readFileSync(
    path.join(process.cwd(), 'components/MatchLandingView.tsx'),
    'utf-8'
  );
  assert.match(viewSource, /<h1[^>]*>/, 'صفحة الهبوط بلا عنوان H1');

  // (د) الصفحة الرئيسية وقوائم المباريات لا تعتمد على شيء هنا — وروابط البطاقات
  //     تبقى `/matches/[id]` (اختبارات watch-routing/match-detail-routing تحرسها).
  assert.ok(store.getGatewayDatabase().matches.length > 0, 'مخزن المباريات الحيّ لم يتضرر');
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ⑦ خريطة الموقع XML: المحتوى المتوقع موجود وصالح
 * ──────────────────────────────────────────────────────────────────────────── */

test('6) خريطة الموقع نفسها: روابط المباريات الحالية فيها، وسجلات المصادر الخام خارجها كما هو مقصود', async () => {
  const entries = await sitemap();
  const urls = new Set(entries.map((entry) => entry.url));

  // كل مباريات الكتالوج المنشورة معلنة (كما تفرضه اختبارات المحرك الحالية).
  for (const item of getCatalogSitemapItems()) {
    assert.ok(urls.has(`${GATEWAY_SITE_URL}${item.path}`), `رابط مفقود: ${item.path}`);
  }

  // سجلات المصادر الخام تبقى خارج الخريطة عن قصد (سياسة المحتوى الرقيق الموثّقة).
  assert.equal(
    entries.some((entry) => /\/matches\/match-/.test(entry.url)),
    false,
    'سجلات المصادر الخام عادت إلى الخريطة'
  );

  // الصفحة الرئيسية والصفحات الثابتة لم تتضرر.
  assert.ok(urls.has(`${GATEWAY_SITE_URL}/`), 'الرئيسية مفقودة من الخريطة');
  for (const staticPath of ['/about', '/contact', '/privacy-policy', '/terms']) {
    assert.ok(urls.has(`${GATEWAY_SITE_URL}${staticPath}`), `${staticPath} مفقود من الخريطة`);
  }
});
