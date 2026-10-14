import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { toCairoIsoWithOffset } from '../lib/cairo-time';
import { MATCH_CATALOG } from '../data/matches';
import { buildMatchOgImagePath, findCatalogEntryForMatch } from '../lib/matches/match-links';
import { getCatalogSitemapItems, resolveAllMatchViews, resolveMatchView } from '../lib/matches/match-catalog';
import { buildMatchLandingMetadata } from '../lib/seo/metadata';
import {
  FALLBACK_SOCIAL_IMAGE_PATH,
  buildMatchLandingJsonLd,
  buildSportsEventNode,
} from '../lib/seo/sports-event';
import { isRtlText } from '../lib/seo/og-text';
import { OG_IMAGE_SIZE, sanitizeOgText } from '../lib/seo/og-image';
import { GATEWAY_SITE_URL } from '../lib/site-url';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  اختبارات إغلاق أخطاء Google Search Console للبيانات المنظمة + بطاقة المشاركة
 * ═══════════════════════════════════════════════════════════════════════════════
 *  هذه الاختبارات تُثبّت الشروط التي تُسبب الأخطاء الفعلية في Search Console:
 *   • «Missing field image» / «Image too small» لصفحات الأحداث.
 *   • «Invalid enum value» في eventStatus.
 *   • «Invalid value» في offers.availability.
 *   • startDate/endDate بلا منطقة زمنية.
 *  وأي انحدار في هذه الشروط يُفشل الاختبارات قبل النشر.
 */

const repoRoot = path.resolve(import.meta.dirname, '..');

/** الحد الأدنى لعرض صورة الحدث كما تطلب Google (720 بكسل). */
const GOOGLE_MIN_EVENT_IMAGE_WIDTH = 720;

/** قيم Schema.org المعتمدة لـ Event.availability (ItemAvailability). */
const VALID_AVAILABILITY = new Set([
  'https://schema.org/InStock',
  'https://schema.org/OutOfStock',
  'https://schema.org/SoldOut',
  'https://schema.org/PreOrder',
  'https://schema.org/BackOrder',
  'https://schema.org/Discontinued',
  'https://schema.org/InStoreOnly',
  'https://schema.org/LimitedAvailability',
  'https://schema.org/OnlineOnly',
]);

const allIsoWithOffset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/;

function buildNodeFor(entryId: string) {
  const entry = MATCH_CATALOG.find((item) => item.id === entryId);
  assert.ok(entry, `سجل مفقود في الكتالوج: ${entryId}`);
  const view = resolveMatchView(entry!);
  const startIso = toCairoIsoWithOffset(view.kickoffUtc);
  const endIso = toCairoIsoWithOffset(view.endDateUtc);
  assert.ok(startIso && endIso, `تعذّر بناء توقيت صحيح لـ ${entryId}`);
  return { entry: entry!, view, node: buildSportsEventNode(view, { startIso: startIso!, endIso: endIso! }) };
}

/* ────────────────────────────────────────────────────────────────────────────
 *  1) الحقول الإلزامية والموصى بها التي تطلبها Google لحدث رياضي
 * ──────────────────────────────────────────────────────────────────────────── */

test('1) كل مباراة تُنتج SportsEvent كامل الحقول الإلزامية التي تطلبها Google', () => {
  const views = resolveAllMatchViews();
  assert.ok(views.length > 0, 'الكتالوج فارغ');

  for (const view of views) {
    const startIso = toCairoIsoWithOffset(view.kickoffUtc)!;
    const endIso = toCairoIsoWithOffset(view.endDateUtc)!;
    const node = buildSportsEventNode(view, { startIso, endIso });
    const label = view.entry.id;

    // الحقل name إلزامي
    assert.equal(typeof node.name, 'string', label);
    assert.ok((node.name as string).trim().length > 0, `${label}: name فارغ`);

    // startDate إلزامي وبصيغة ISO 8601 مع منطقة زمنية
    assert.equal(typeof node.startDate, 'string', label);
    assert.match(node.startDate as string, allIsoWithOffset, `${label}: startDate بلا منطقة زمنية`);
    assert.ok(Number.isFinite(Date.parse(node.startDate as string)), label);

    // endDate موصى به، ويجب أن يكون بعد startDate (تطلبها Google صريحًا)
    assert.equal(typeof node.endDate, 'string', `${label}: endDate مفقود`);
    assert.match(node.endDate as string, allIsoWithOffset, `${label}: endDate بلا منطقة زمنية`);
    assert.ok(
      Date.parse(node.endDate as string) > Date.parse(node.startDate as string),
      `${label}: endDate ليس بعد startDate`
    );

    // location إلزامي (Place و/أو VirtualLocation)
    const location = node.location as Record<string, unknown> | Array<Record<string, unknown>>;
    assert.ok(location, `${label}: location مفقود`);
    const locations = Array.isArray(location) ? location : [location];
    assert.ok(locations.length >= 1, label);
    for (const place of locations) {
      assert.ok(
        ['Place', 'VirtualLocation', 'OnlineEventAttendanceMode'].includes(String(place['@type'])),
        `${label}: @type غير متوقع في location (${String(place['@type'])})`
      );
      assert.ok(String(place.name || '').trim().length > 0, `${label}: location.name فارغ`);
    }

    // performer = الفريقان (SportsTeam)
    const performer = node.performer as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(performer), `${label}: performer يجب أن يكون مصفوفة`);
    assert.equal(performer.length, 2, label);
    for (const team of performer) {
      assert.equal(team['@type'], 'SportsTeam', label);
      assert.ok(String(team.name || '').trim().length > 0, `${label}: performer.name فارغ`);
    }

    // organizer = البطولة (SportsOrganization) — حقل موصى به من Google
    const organizer = node.organizer as Record<string, unknown>;
    assert.equal(organizer['@type'], 'SportsOrganization', label);
    assert.equal(organizer.name, view.entry.competition.nameAr, label);

    // description ديناميكي غير مقتضب
    assert.equal(typeof node.description, 'string', label);
    assert.ok((node.description as string).length >= 80, `${label}: الوصف قصير جدًا`);
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 *  2) الصور: العرض ≥ 720 بكسل ومُستضافة على نطاق الموقع (وليس على CDN خارجي)
 * ──────────────────────────────────────────────────────────────────────────── */

test('2) صورة الحدث مُولَّدة على نطاق الموقع وليست شعار فريق صغير', () => {
  for (const view of resolveAllMatchViews()) {
    const startIso = toCairoIsoWithOffset(view.kickoffUtc)!;
    const endIso = toCairoIsoWithOffset(view.endDateUtc)!;
    const node = buildSportsEventNode(view, { startIso, endIso });
    const label = view.entry.id;

    const image = node.image;
    assert.ok(image, `${label}: حقل image مفقود (خطأ Missing field image في Search Console)`);
    const images = (Array.isArray(image) ? image : [image]).map(String);
    assert.ok(images.length >= 1, label);

    const primary = images[0];
    assert.ok(primary.startsWith(GATEWAY_SITE_URL), `${label}: الصورة الأساسية ليست على نطاق الموقع: ${primary}`);
    assert.ok(
      primary.startsWith(`${GATEWAY_SITE_URL}${buildMatchOgImagePath(view.entry.id)}`),
      `${label}: الصورة الأساسية ليست بطاقة المباراة المُولَّدة: ${primary}`
    );

    // لا يجوز أن تشير صورة الحدث إلى شعار فريق (مربّع/صغير → تحذير Image too small)
    for (const team of [view.entry.homeTeam, view.entry.awayTeam]) {
      if (!team.logoUrl) continue;
      assert.equal(
        images.includes(team.logoUrl),
        false,
        `${label}: شعار الفريق مستخدم كصورة حدث (${team.logoUrl})`
      );
    }

    // وجود صورة احتياطية على النطاق يمنع السقوط في صورة خارجية
    assert.ok(
      images.some((url) => url.endsWith(FALLBACK_SOCIAL_IMAGE_PATH)) ||
        view.entry.seo?.imageUrl !== undefined,
      `${label}: لا توجد شبكة أمان للصورة`
    );
  }
});

test('3) بطاقة المشاركة تُبنى بمقاس 1200×675 ومحتواها متجانس مع البيانات المنظمة', async () => {
  const routePath = path.join(repoRoot, 'app', 'matches', '[id]', 'opengraph-image.tsx');
  assert.equal(fs.existsSync(routePath), true, 'مسار توليد صورة المشاركة مفقود');

  const source = fs.readFileSync(routePath, 'utf-8');

  // المقاس يجب أن يكون 1200×675 (النسبة 16:9 الموصى بها) وليس المقياس الافتراضي
  assert.equal(OG_IMAGE_SIZE.width, 1200);
  assert.equal(OG_IMAGE_SIZE.height, 675);
  assert.ok(OG_IMAGE_SIZE.width >= GOOGLE_MIN_EVENT_IMAGE_WIDTH, 'العرض أقل من حد Google');
  assert.match(source, /runtime = 'nodejs'/);
  assert.match(source, /export default async function Image/);

  // البيانات المنظمة وصفحة الهبوط يجب أن تشيرا إلى نفس الصورة
  for (const view of resolveAllMatchViews()) {
    const metadata = buildMatchLandingMetadata(view);
    const ogImages = metadata.openGraph?.images;
    const first = Array.isArray(ogImages)
      ? (ogImages[0] as { url: string; width?: number; height?: number })
      : undefined;
    assert.ok(first, `${view.entry.id}: openGraph.images مفقود`);
    assert.equal(
      first!.url,
      `${GATEWAY_SITE_URL}${buildMatchOgImagePath(view.entry.id)}`,
      `${view.entry.id}: صورة المشاركة لا تطابق بطاقة المباراة المُولَّدة`
    );
    assert.equal(first!.width, 1200, view.entry.id);
    assert.equal(first!.height, 675, view.entry.id);
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 *  4) eventStatus و offers.availability: قيم معتمدة فقط في Schema.org
 * ──────────────────────────────────────────────────────────────────────────── */

test('4) eventStatus و offers.availability بقيم معتمدة ومتوافقة مع حالة المباراة', () => {
  const validStatuses = new Set([
    'EventScheduled',
    'EventCancelled',
    'EventMovedOnline',
    'EventPostponed',
    'EventRescheduled',
  ]);

  for (const { entry, view, node } of MATCH_CATALOG.map((item) => buildNodeFor(item.id))) {
    const label = entry.id;

    // eventStatus: قيمة enum معتمدة (EventLive ليست قيمة معتمدة وتُنتج Invalid enum value)
    const status = String(node.eventStatus);
    assert.ok(status.startsWith('https://schema.org/'), `${label}: eventStatus بلا نطاق Schema.org`);
    assert.ok(
      validStatuses.has(status.replace('https://schema.org/', '')),
      `${label}: eventStatus غير معتمد: ${status}`
    );

    // offers: كل الحقول الإلزامية التي تطلبها Google في كائن العرض
    const offers = node.offers as Record<string, unknown>;
    assert.equal(offers['@type'], 'Offer', label);
    assert.equal(typeof offers.price, 'string', `${label}: offers.price يجب أن يكون نصًا`);
    assert.match(String(offers.price), /^\d+(\.\d+)?$/, `${label}: offers.price ليس رقمًا`);
    assert.equal(typeof offers.priceCurrency, 'string', `${label}: offers.priceCurrency مفقود`);
    assert.match(String(offers.priceCurrency), /^[A-Z]{3}$/, `${label}: priceCurrency غير صالح`);
    assert.ok(String(offers.url).startsWith('https://'), `${label}: offers.url ليس رابطًا مطلقًا`);
    assert.ok(
      VALID_AVAILABILITY.has(String(offers.availability)),
      `${label}: offers.availability غير معتمد: ${String(offers.availability)}`
    );

    // حالة المباراة يجب أن تنعكس على توفّر العرض
    if (view.isFinished || view.status === 'cancelled') {
      assert.equal(
        offers.availability,
        'https://schema.org/SoldOut',
        `${label}: مباراة منتهية/ملغاة يجب أن يكون عرضها SoldOut`
      );
      assert.equal(offers.validFrom, undefined, `${label}: validFrom لا معنى له على عرض منتهٍ`);
    } else {
      assert.equal(
        offers.availability,
        'https://schema.org/InStock',
        `${label}: مباراة قادمة/جارية يجب أن يكون عرضها InStock`
      );
    }

    // المشاركون: competitor يعكس performer بالكامل
    assert.deepEqual(node.competitor, node.performer, `${label}: competitor لا يطابق performer`);
  }
});

test('5) البطاقة المُولَّدة تُقدَّم كصورة PNG وتتطلب خطًا عربيًا بصيغة TTF', () => {
  const fontsDir = path.join(repoRoot, 'assets', 'fonts');
  assert.equal(fs.existsSync(fontsDir), true, 'مجلد الخطوط مفقود');

  const fontFiles = fs.readdirSync(fontsDir);
  // Satori لا يدعم WOFF/WOFF2 — وجود ملف woff يعني بطاقة بمربعات فارغة
  assert.equal(
    fontFiles.some((file) => file.endsWith('.woff') || file.endsWith('.woff2')),
    false,
    'Satori لا يدعم WOFF: يجب استخدام TTF فقط'
  );
  for (const weight of ['400', '700']) {
    assert.ok(fontFiles.includes(`cairo-${weight}.ttf`), `خط مفقود: cairo-${weight}.ttf`);
  }

  // حزمة Vercel يجب أن تتضمن الخطوط وإلا فشلت القراءة في الإنتاج فقط
  const config = fs.readFileSync(path.join(repoRoot, 'next.config.mjs'), 'utf-8');
  assert.match(config, /outputFileTracingIncludes/);
  assert.match(config, /assets\/fonts/);
});

/* ────────────────────────────────────────────────────────────────────────────
 *  6) أدوات عرض النص العربي في البطاقة (منع انحدار تباعد الكلمات وترتيبها)
 * ──────────────────────────────────────────────────────────────────────────── */

test('6) أدوات النص تُفرّق بين العربية واللاتينية وتُعقّم المدخلات', () => {
  assert.equal(isRtlText('الثلاثاء أكتوبر'), true);
  assert.equal(isRtlText('NEMO Sports'), false);
  assert.equal(isRtlText('٠٨:٠٠ م'), true, 'الأرقام العربية الهندية نص عربي الاتجاه');
  // نص مختلط يبدأ بعربي يُعامل كعربي
  assert.equal(isRtlText('مباراة Zamalek'), true);

  // إزالة محارف التحكم وعلامات الاتجاه التي تُفسد تشكيل الحروف
  assert.equal(sanitizeOgText('نيمو\u200f كورة'), 'نيمو كورة');
  assert.equal(sanitizeOgText('  مسافات   متعددة  '), 'مسافات متعددة');
  assert.equal(sanitizeOgText('أ\u0000ب'), 'أ ب');
  // الاقتصاص بحد أقصى حتى لا يتجاوز النص عرض البطاقة
  const clipped = sanitizeOgText('كلمة '.repeat(50), 20);
  assert.ok(clipped.length <= 20, `الاقتصاص لم يعمل: ${clipped.length}`);
});

/* ────────────────────────────────────────────────────────────────────────────
 *  7) خريطة الموقع: صفحات الهبوط فقط، بلا سجلات مصادر خام
 * ──────────────────────────────────────────────────────────────────────────── */

test('7) خريطة الموقع تستثني سجلات المصادر الخام وتُبقي صفحات الهبوط', async () => {
  const sitemap = (await import('../app/sitemap')).default;
  const entries = await sitemap();
  const urls = new Set(entries.map((entry) => entry.url));

  // كل مباراة في الكتالوج لها رابط معلن
  for (const item of getCatalogSitemapItems()) {
    assert.ok(urls.has(`${GATEWAY_SITE_URL}${item.path}`), `رابط مفقود: ${item.path}`);
  }

  // سجلات المصادر الخام (معرّفاتها match-api-football-*) ليست وجهات معلنة
  const rawSourceUrls = entries.filter((entry) => /\/matches\/match-api-football-/.test(entry.url));
  assert.equal(rawSourceUrls.length, 0, `سجلات مصدر خام في الخريطة: ${rawSourceUrls.length}`);

  // ولا نُعلن سجلاً موجوداً فعلاً في المخزن مقابل مسار كتالوج
  const { getGatewayDatabase } = await import('../lib/db/store');
  for (const match of getGatewayDatabase().matches) {
    const catalogEntry = findCatalogEntryForMatch(match);
    if (catalogEntry) continue;
    assert.equal(urls.has(`${GATEWAY_SITE_URL}/matches/${match.id}`), false, match.id);
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 *  8) الرسم الكامل للبيانات المنظمة (@graph) متسق
 * ──────────────────────────────────────────────────────────────────────────── */

test('8) رسم صفحة الهبوط يضم SportsEvent + BreadcrumbList داخل @graph واحد', () => {
  for (const view of resolveAllMatchViews()) {
    const startIso = toCairoIsoWithOffset(view.kickoffUtc)!;
    const endIso = toCairoIsoWithOffset(view.endDateUtc)!;
    const graph = buildMatchLandingJsonLd(view, { startIso, endIso });

    assert.equal(graph['@context'], 'https://schema.org', view.entry.id);
    const nodes = graph['@graph'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(nodes) && nodes.length >= 2, view.entry.id);

    const event = nodes.find((node) => node['@type'] === 'SportsEvent');
    const breadcrumb = nodes.find((node) => node['@type'] === 'BreadcrumbList');
    assert.ok(event, `${view.entry.id}: عقدة SportsEvent مفقودة`);
    assert.ok(breadcrumb, `${view.entry.id}: عقدة BreadcrumbList مفقودة`);

    // كل عناصر المسار لها position متتالٍ واسم ورابط
    const items = breadcrumb!.itemListElement as Array<Record<string, unknown>>;
    items.forEach((item, index) => {
      assert.equal(item['@type'], 'ListItem', view.entry.id);
      assert.equal(item.position, index + 1, `${view.entry.id}: position غير متسلسل`);
      assert.ok(String(item.name || '').trim().length > 0, view.entry.id);
      assert.ok(String(item.item).startsWith(GATEWAY_SITE_URL), view.entry.id);
    });
    assert.equal(items.at(-1)!.item, view.canonicalUrl, `${view.entry.id}: آخر عنصر ليس صفحة المباراة`);
  }
});
