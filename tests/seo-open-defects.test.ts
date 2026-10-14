import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchScheduleStructuredData } from '../lib/seo/match-structured-data';
import { VALID_EVENT_STATUSES, buildSportsEventNode, toSchemaEventStatus } from '../lib/seo/sports-event';
import { findCatalogEntryForMatch } from '../lib/matches/match-links';
import { getGatewayDatabase } from '../lib/db/store';
import { resolveAllMatchViews } from '../lib/matches/match-catalog';
import { toCairoIsoWithOffset } from '../lib/cairo-time';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  إغلاق الثغرتين SEO المعلّقتين (2026-10-14)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ① `ItemList` في صفحات الجدول: كل `ListItem` يحمل `url` داخليًا بلا استثناء.
 *  ② `eventStatus`: لا تخرج قيمة خارج enum المعتمد في Schema.org أبدًا، ولا تُقبل
 *     `EventLive` (وهي ليست قيمة معتمدة) حتى لو طُلبت يدويًا من البيانات.
 */

/* ────────────────────────────────────────────────────────────────────────────
 *  ① كل عنصر في ItemList له رابط
 * ──────────────────────────────────────────────────────────────────────────── */

test('1) كل ListItem في بيانات الجدول يحمل url داخليًا — بلا استثناء', () => {
  const { matches } = getGatewayDatabase();
  assert.ok(matches.length > 0, 'المخزن لا يحتوي مباريات');

  // نفحص المجموعة كاملة، ثم ندقق على أنواع مختلفة من السجلات
  const data = createMatchScheduleStructuredData('2026-10-14', matches);
  assert.ok(data, 'بيانات الجدول لم تُبنَ');
  assert.equal(data!['@type'], 'ItemList');

  const items = data!.itemListElement as Array<Record<string, unknown>>;
  assert.equal(items.length, Math.min(matches.length, 20));

  for (const item of items) {
    assert.equal(item['@type'], 'ListItem');
    assert.ok(typeof item.name === 'string' && (item.name as string).length > 0, 'اسم العنصر مفقود');
    const url = item.url;
    assert.ok(typeof url === 'string' && (url as string).length > 0, `عنصر بلا رابط: ${item.name}`);
    assert.ok(
      (url as string).startsWith('https://'),
      `رابط غير مطلق: ${url}`
    );
    // الرابط داخلي: صفحة تفاصيل المباراة على البوابة نفسها، لا منصة خارجية
    assert.ok(
      /\/matches\/[^/]+$/.test(url as string),
      `وجهة غير متوقعة في ItemList: ${url}`
    );
    assert.ok(
      !(url as string).includes('nemo-sports.vercel.app'),
      `رابط خارجي داخل ItemList: ${url}`
    );
  }

  // الترتيب متسلسل من ١
  items.forEach((item, index) => assert.equal(item.position, index + 1));

  // قائمة فارغة → لا بيانات منظمة ناقصة (بدل عقدة بلا عناصر)
  assert.equal(createMatchScheduleStructuredData('2026-10-14', []), null);
});

test('2) رابط كل عنصر يطابق صفحة التفاصيل الحقيقية لذلك السجل', () => {
  const { matches } = getGatewayDatabase();
  const data = createMatchScheduleStructuredData('2026-10-14', matches)!;
  const items = data.itemListElement as Array<Record<string, unknown>>;

  // لكل سجل في المخزن: الرابط يخصّ السجل فعلًا — إما صفحته الخاصة، أو صفحة الكتالوج
  // المعيارية المطابقة له (وهي الأفضل SEO عند وجودها).
  // المطابقة بالفهرس: نفس ترتيب السجلات المُدخلة (لا بالاسم، لأن الفريق قد يلعب أكثر من مباراة)
  for (const [index, match] of matches.slice(0, 20).entries()) {
    const url = items[index]?.url as string;
    assert.ok(url, `لا رابط للمباراة ${match.id}`);
    const catalogEntry = findCatalogEntryForMatch(match);
    const expectedId = catalogEntry ? catalogEntry.id : match.id;
    assert.ok(
      url.endsWith(`/matches/${expectedId}`),
      `الرابط لا يخصّ السجل: ${url} — المتوقع ${expectedId} (سجل ${match.id})`
    );
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 *  ② eventStatus: قيم معتمدة فقط
 * ──────────────────────────────────────────────────────────────────────────── */

test('3) eventStatus لا يخرج قيمة غير معتمدة لأي حالة — وEventLive مرفوضة دائمًا', () => {
  const statuses = ['not_started', 'live', 'finished', 'postponed', 'cancelled', 'suspended', 'unconfirmed'] as const;

  for (const status of statuses) {
    const value = toSchemaEventStatus(status).replace('https://schema.org/', '');
    assert.ok(
      (VALID_EVENT_STATUSES as readonly string[]).includes(value),
      `${status}: قيمة غير معتمدة ${value}`
    );
  }

  // الطلب الصريح من صاحب المنتج: EventLive — مرفوضة لأنها تُنتج Invalid enum value،
  // فيُعاد الاشتقاق من الحالة الفعلية بدل إنتاج بيانات منظمة خاطئة.
  assert.equal(
    toSchemaEventStatus('live', 'EventLive').replace('https://schema.org/', ''),
    'EventScheduled'
  );
  assert.equal(
    toSchemaEventStatus('finished', 'EventLive').replace('https://schema.org/', ''),
    'EventScheduled'
  );

  // القيم المعتمدة تُحترم عند طلبها يدويًا (مع أو بدون نطاق Schema.org)
  assert.equal(
    toSchemaEventStatus('not_started', 'EventPostponed'),
    'https://schema.org/EventPostponed'
  );
  assert.equal(
    toSchemaEventStatus('not_started', 'https://schema.org/EventCancelled'),
    'https://schema.org/EventCancelled'
  );
  // وأي نص غريب يُتجاهل (لا خطأ في البيانات المنظمة)
  assert.equal(
    toSchemaEventStatus('not_started', 'SomethingMadeUp'),
    'https://schema.org/EventScheduled'
  );
});

test('4) المباراة المنتهية تبقى مكتملة الحقول: EventScheduled + startDate/endDate/location', () => {
  const finished = resolveAllMatchViews().filter((view) => view.status === 'finished');
  assert.ok(finished.length > 0, 'لا توجد مباريات منتهية في الكتالوج للفحص');

  for (const view of finished) {
    const startIso = toCairoIsoWithOffset(view.kickoffUtc);
    const endIsoValue = toCairoIsoWithOffset(view.endDateUtc);
    assert.ok(startIso && endIsoValue, `${view.entry.id}: تعذّر بناء توقيت صحيح`);
    const node = buildSportsEventNode(view, { startIso: startIso!, endIso: endIsoValue! });

    // لا قيمة enum مخترعة: «منتهية» لا مقابل لها في Schema.org، والتمثيل الصحيح هو
    // أن الحدث أُقيم كما خُطط له (EventScheduled) مع نهاية في الماضي.
    assert.equal(node.eventStatus, 'https://schema.org/EventScheduled', view.entry.id);

    // ولا تُحذف الحقول الأساسية أبدًا عند تغيّر الحالة (ملاحظة Google الصريحة)
    assert.equal(typeof node.startDate, 'string', `${view.entry.id}: startDate مفقود`);
    assert.equal(typeof node.endDate, 'string', `${view.entry.id}: endDate مفقود`);
    assert.ok(node.location, `${view.entry.id}: location مفقود`);

    // والنهاية فعلًا في الماضي بالنسبة للمباراة المنتهية
    assert.ok(
      Date.parse(endIsoValue!) < Date.now(),
      `${view.entry.id}: مباراة «منتهية» ونهايتها في المستقبل`
    );
  }
});
