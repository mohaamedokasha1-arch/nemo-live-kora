import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GET as getAdsTxt } from '../app/ads.txt/route';
import { generateMetadata as generateLiveMetadata } from '../app/live/[matchId]/page';
import { generateMetadata as generateMatchMetadata } from '../app/matches/[id]/page';
import sitemap from '../app/sitemap';
import {
  addMinutesToIso,
  getCairoOffsetMinutes,
  toCairoIsoWithOffset,
} from '../lib/cairo-time';
import { MATCH_CATALOG, MATCH_CATALOG_TEMPLATE } from '../data/matches';
import {
  buildMatchLandingPath,
  buildMatchLivePath,
  buildMatchLandingPathMap,
  findCatalogEntryById,
  findCatalogEntryForMatch,
  getFeaturedCatalogEntry,
} from '../lib/matches/match-links';
import {
  getCatalogSitemapItems,
  resolveAllMatchViews,
  resolveMatchView,
  validateMatchCatalog,
  validateMatchCatalogEntry,
} from '../lib/matches/match-catalog';
import {
  VALID_EVENT_STATUSES,
  buildMatchDescription,
  buildSportsEventNode,
  toSchemaEventStatus,
} from '../lib/seo/sports-event';
import { GATEWAY_SITE_URL } from '../lib/site-url';

/**
 * اختبارات محرّك المباريات التلقائي + البيانات المنظمة + الجاهزية للإعلانات.
 * الهدف: ضمان توليد صفحة وبيانات Search Console سليمة من أي خطأ بمجرد إضافة مباراة.
 */

const repoRoot = process.cwd();

test('1) كل مباريات الكتالوج تُجتاز التحقق الصارم (بدون حقول ناقصة)', () => {
  const errors = validateMatchCatalog();
  assert.deepEqual(errors, [], `أخطاء الكتالوج:\n${errors.join('\n')}`);
  assert.ok(MATCH_CATALOG.length >= 3, 'الكتالوج يحتوي نماذج المباريات المتوقعة');

  // النموذج التعليمي جاهز للنسخ لكنه ليس ضمن الكتالوج المنشور.
  assert.equal(
    MATCH_CATALOG.some((entry) => entry.id === MATCH_CATALOG_TEMPLATE.id),
    false,
    'النموذج التعليمي يجب ألا يُنشر'
  );
  assert.deepEqual(validateMatchCatalogEntry(MATCH_CATALOG_TEMPLATE), []);
});

test('2) البيانات المنظمة تحتوي كل الحقول المطلوبة والموصى بها لكل مباراة', () => {
  const descriptions = new Set<string>();

  for (const entry of MATCH_CATALOG) {
    const view = resolveMatchView(entry);
    const startIso = toCairoIsoWithOffset(view.kickoffUtc);
    const endIso = toCairoIsoWithOffset(view.endDateUtc);
    assert.ok(startIso && endIso, entry.id);

    const node = buildSportsEventNode(view, { startIso: startIso!, endIso: endIso! });

    // —— الحقول الإلزامية في Google
    assert.equal(node['@type'], 'SportsEvent', entry.id);
    assert.ok(String(node.name).includes(entry.homeTeam.nameAr), entry.id);
    assert.ok(String(node.name).includes(entry.awayTeam.nameAr), entry.id);
    assert.equal(node.startDate, startIso);
    assert.equal(node.endDate, endIso);
    assert.ok(node.location, entry.id);

    // —— الوصف الديناميكي فريد لكل مباراة وبطول كافٍ
    const description = String(node.description);
    assert.ok(description.length >= 120, `${entry.id}: الوصف قصير جدًا`);
    assert.ok(description.includes(entry.awayTeam.nameAr), entry.id);
    descriptions.add(description);

    // —— location: Place باسم الاستاد + PostalAddress، أو VirtualLocation، أو الاثنان
    const locations = Array.isArray(node.location) ? node.location : [node.location];
    const place = locations.find((item) => (item as Record<string, unknown>)['@type'] === 'Place');
    const virtual = locations.find(
      (item) => (item as Record<string, unknown>)['@type'] === 'VirtualLocation'
    );
    if (entry.venue.kind === 'online') {
      assert.ok(virtual, `${entry.id}: المباراة أونلاين بدون VirtualLocation`);
    } else {
      assert.ok(place, `${entry.id}: لا يوجد Place`);
      const address = (place as Record<string, unknown>).address as Record<string, unknown>;
      assert.ok(address, `${entry.id}: Place بدون PostalAddress`);
      assert.ok(address.addressCountry, `${entry.id}: addressCountry مفقود`);
      assert.equal((place as Record<string, unknown>).name, view.venueName, entry.id);
    }
    if (entry.venue.kind === 'hybrid') {
      assert.ok(place && virtual, `${entry.id}: البث الهجين يحتاج Place و VirtualLocation معًا`);
      assert.equal(node.eventAttendanceMode, 'https://schema.org/MixedEventAttendanceMode');
    } else if (entry.venue.kind === 'stadium') {
      assert.equal(node.eventAttendanceMode, 'https://schema.org/OfflineEventAttendanceMode');
    }

    // —— performer / competitor: الفريقان (المستضيف والضيف)
    const performer = node.performer as Array<Record<string, unknown>>;
    const competitor = node.competitor as Array<Record<string, unknown>>;
    assert.equal(performer.length, 2, entry.id);
    assert.equal(competitor.length, 2, entry.id);
    for (const team of performer) assert.equal(team['@type'], 'SportsTeam', entry.id);
    assert.equal(performer[0].name, entry.homeTeam.nameAr, entry.id);
    assert.equal(performer[1].name, entry.awayTeam.nameAr, entry.id);
    assert.equal(performer[0].sport, 'Association football', entry.id);

    // —— organizer: البطولة/الرابطة
    const organizer = node.organizer as Record<string, unknown>;
    assert.equal(organizer['@type'], 'SportsOrganization', entry.id);
    assert.equal(organizer.name, entry.competition.nameAr, entry.id);

    // —— offers: رابط المشاهدة + سعر 0 + العملة + توفّر مطابق لحالة المباراة
    //    (مباراة منتهية/ملغاة ← SoldOut، وإلا ← InStock؛ وvalidFrom للمباريات القادمة فقط)
    const offers = node.offers as Record<string, unknown>;
    assert.equal(offers['@type'], 'Offer', entry.id);
    assert.equal(offers.price, '0', entry.id);
    assert.ok(['EGP', 'USD', 'SAR', 'AED', 'EUR'].includes(String(offers.priceCurrency)), entry.id);

    const soldOut = view.isFinished || view.status === 'cancelled';
    assert.equal(
      offers.availability,
      soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      entry.id
    );
    assert.equal(
      offers.url,
      soldOut
        ? view.canonicalUrl
        : view.verifiedBroadcastUrl || `${GATEWAY_SITE_URL}${buildMatchLivePath(entry.id)}`,
      entry.id
    );
    if (soldOut) {
      assert.equal(offers.validFrom, undefined, `${entry.id}: validFrom لا معنى له على عرض منتهٍ`);
    } else {
      assert.equal(offers.validFrom, entry.broadcast.availableFromUtc || startIso, entry.id);
    }

    // —— eventStatus ضمن القيم المعتمدة في Schema.org فقط (لا EventLive)
    const eventStatus = String(node.eventStatus).replace('https://schema.org/', '');
    assert.ok(
      (VALID_EVENT_STATUSES as readonly string[]).includes(eventStatus),
      `${entry.id}: قيمة eventStatus غير معتمدة (${node.eventStatus})`
    );
    assert.notEqual(eventStatus, 'EventLive', 'EventLive ليست قيمة معتمدة في Schema.org');

    // —— الصور والإثراءات
    assert.ok(Array.isArray(node.image) && (node.image as string[]).length >= 2, entry.id);
    assert.equal(node.inLanguage, 'ar', entry.id);
    assert.equal(node.sport, 'Association football', entry.id);
    assert.ok(node.superEvent, `${entry.id}: superEvent (البطولة والموسم) مفقود`);

    // —— لا خصائص غير صالحة على كائن Event (تجنّبًا لتحذيرات Search Console)
    for (const invalidProperty of ['keywords', 'dateModified', 'result', 'subjectOf']) {
      assert.equal(
        invalidProperty in node,
        false,
        `${entry.id}: الخاصية ${invalidProperty} ليست من خصائص Event في Schema.org`
      );
    }
  }

  assert.equal(descriptions.size, MATCH_CATALOG.length, 'الأوصاف يجب أن تكون فريدة لكل مباراة');
});

test('3) startDate/endDate بصيغة ISO 8601 مع إزاحة توقيت القاهرة الفعلية (توقيت صيفي/شتوي)', () => {
  // أكتوبر 2026 داخل التوقيت الصيفي المصري (+03:00)
  assert.equal(toCairoIsoWithOffset('2026-10-20T17:00:00.000Z'), '2026-10-20T20:00:00+03:00');
  assert.equal(getCairoOffsetMinutes(new Date('2026-10-20T17:00:00.000Z')), 180);
  // ديسمبر 2026 خارج التوقيت الصيفي (+02:00)
  assert.equal(toCairoIsoWithOffset('2026-12-01T17:00:00.000Z'), '2026-12-01T19:00:00+02:00');
  assert.equal(getCairoOffsetMinutes(new Date('2026-12-01T17:00:00.000Z')), 120);
  assert.equal(toCairoIsoWithOffset('ليست تاريخًا'), null);

  // النص الناتج يمثل نفس اللحظة الزمنية تمامًا
  const iso = toCairoIsoWithOffset('2026-10-20T17:00:00.000Z')!;
  assert.equal(new Date(iso).toISOString(), '2026-10-20T17:00:00.000Z');

  // endDate = kickoff + المدة المتوقعة
  assert.equal(addMinutesToIso('2026-10-20T17:00:00.000Z', 120), '2026-10-20T19:00:00.000Z');
  assert.equal(addMinutesToIso('ليست تاريخًا', 120), null);
});

test('4) حالة المباراة والنتيجة تُدمجان من سجل المصدر الحقيقي', () => {
  const finished = findCatalogEntryById('zamalek-vs-al-ahly-2026-10-11');
  assert.ok(finished);
  const finishedView = resolveMatchView(finished!);
  assert.equal(finishedView.hasLiveSourceRecord, true);
  assert.equal(finishedView.status, 'finished');
  assert.equal(finishedView.score?.home, 0);
  assert.equal(finishedView.score?.away, 2);
  assert.match(finishedView.verifiedNemoMatchUrl || '', /^https:\/\/nemo-sports\.vercel\.app\/matches\/.+#live-stream$/);

  const upcoming = findCatalogEntryById('al-ittihad-alexandria-vs-zamalek-2026-10-20');
  assert.ok(upcoming);
  const upcomingView = resolveMatchView(upcoming!);
  assert.equal(upcomingView.hasLiveSourceRecord, true);
  assert.equal(upcomingView.status, 'not_started');
  assert.equal(upcomingView.kickoffUtc, upcoming!.kickoffUtc);
  assert.equal(upcomingView.verifiedBroadcastUrl, null);

  // مباراة بلا سجل مصدر: الحالة لا تدّعي «جارية» أبدًا وتُظهر سببًا واضحًا للزائر.
  const orphan = resolveMatchView({
    ...upcoming!,
    id: 'demo-orphan-match-2026-10-20',
    source: { ...upcoming!.source, matchId: null, thesportsdbEventId: '999999999', apiFootballFixtureId: null, homeTeamId: 'team-unknown', awayTeamId: 'team-unknown-2' },
  });
  assert.equal(orphan.hasLiveSourceRecord, false);
  assert.notEqual(orphan.status, 'live');
});

test('5) ترجمة eventStatus لا تُنتج قيمًا مرفوضة وتجتاز الحالات المؤجلة والملغاة', () => {
  assert.equal(toSchemaEventStatus('not_started'), 'https://schema.org/EventScheduled');
  assert.equal(toSchemaEventStatus('live'), 'https://schema.org/EventScheduled');
  assert.equal(toSchemaEventStatus('finished'), 'https://schema.org/EventScheduled');
  assert.equal(toSchemaEventStatus('postponed'), 'https://schema.org/EventPostponed');
  assert.equal(toSchemaEventStatus('cancelled'), 'https://schema.org/EventCancelled');
  assert.equal(toSchemaEventStatus('live', 'EventMovedOnline'), 'https://schema.org/EventMovedOnline');
  // أي تجاوز غير صالح يُتجاهل بدلًا من نشره
  assert.equal(toSchemaEventStatus('postponed', 'EventLive'), 'https://schema.org/EventPostponed');
});

test('6) التحقق يمنع أي رابط بث غير مُتحقَّق منه أو أي تاريخ غير متسق', () => {
  const base = findCatalogEntryById('zed-vs-azam-2026-10-16')!;

  const unverifiedWithUrl = validateMatchCatalogEntry({
    ...base,
    broadcast: { ...base.broadcast, status: 'unverified', url: 'https://example.com/stream' },
  });
  assert.ok(
    unverifiedWithUrl.some((error) => error.includes('broadcast.url')),
    'يجب رفض رابط بث غير مُتحقَّق منه'
  );

  const verifiedWithoutUrl = validateMatchCatalogEntry({
    ...base,
    broadcast: { ...base.broadcast, status: 'verified_free', url: null },
  });
  assert.ok(verifiedWithoutUrl.some((error) => error.includes('broadcast.url')));

  const wrongCairoDate = validateMatchCatalogEntry({ ...base, cairoDate: '2026-10-15' });
  assert.ok(
    wrongCairoDate.some((error) => error.includes('cairoDate')),
    'يجب رفض تاريخ لا يطابق kickoffUtc بتوقيت القاهرة'
  );

  const badStatus = validateMatchCatalogEntry({
    ...base,
    kickoffUtc: 'غير صالح',
  });
  assert.ok(badStatus.some((error) => error.includes('kickoffUtc')));

  for (const entry of MATCH_CATALOG) {
    if (!entry.broadcast.status.startsWith('verified')) {
      assert.equal(entry.broadcast.url, null, `${entry.id}: رابط بث غير مُتحقَّق منه`);
    }
  }
});

test('7) خريطة الموقع تضم كل مباراة فورًا + صفحة البث غير مفهرسة', async () => {
  const entries = await sitemap();
  for (const item of getCatalogSitemapItems()) {
    const url = `${GATEWAY_SITE_URL}${item.path}`;
    const found = entries.find((entry) => entry.url === url);
    assert.ok(found, `خريطة الموقع لا تحتوي ${url}`);
    assert.ok(found!.lastModified instanceof Date);
    assert.ok((found!.priority ?? 0) >= 0.7);
  }
  assert.equal(getCatalogSitemapItems().length, MATCH_CATALOG.length);

  for (const entry of MATCH_CATALOG) {
    const live = await generateLiveMetadata({ params: Promise.resolve({ matchId: entry.id }) });
    assert.equal(live.alternates?.canonical, buildMatchLivePath(entry.id));
    const robotsMeta = typeof live.robots === 'object' && live.robots !== null ? live.robots : null;
    assert.equal(robotsMeta?.index, false, `${entry.id}: صفحة البث يجب أن تكون noindex`);
    assert.equal(robotsMeta?.follow, true, entry.id);

    const landing = await generateMatchMetadata({ params: Promise.resolve({ id: entry.id }) });
    assert.equal(landing.alternates?.canonical, buildMatchLandingPath(entry.id));
    const landingRobots =
      typeof landing.robots === 'object' && landing.robots !== null ? landing.robots : null;
    assert.equal(landingRobots?.index, true, entry.id);
  }
});

test('8) ads.txt يُبنى تلقائيًا من متغيّرات البيئة ويستبعد الأسطر المكسورة', async () => {
  const previousClient = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  const previousLines = process.env.ADS_TXT_LINES;

  try {
    delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
    delete process.env.ADS_TXT_LINES;
    const empty = await getAdsTxt().text();
    assert.equal(empty.includes('google.com,'), false);
    assert.match(empty, /NEXT_PUBLIC_ADSENSE_CLIENT/);

    process.env.NEXT_PUBLIC_ADSENSE_CLIENT = 'ca-pub-1234567890123456';
    process.env.ADS_TXT_LINES = 'example.com, 12345, DIRECT; سطر-غير-صالح';
    const response = await getAdsTxt();
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    const body = await response.text();
    assert.match(body, /google\.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0/);
    assert.match(body, /example\.com, 12345, DIRECT/);
    assert.match(body, /سطر مرفوض ولم يُنشر/);
    assert.equal(/\nسطر-غير-صالح/.test(body), false);
  } finally {
    if (previousClient === undefined) delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
    else process.env.NEXT_PUBLIC_ADSENSE_CLIENT = previousClient;
    if (previousLines === undefined) delete process.env.ADS_TXT_LINES;
    else process.env.ADS_TXT_LINES = previousLines;
  }
});

test('9) البنية الفنية: ملفات SEO والإعلانات والصفحات القانونية في مكانها', () => {
  for (const rel of [
    'app/robots.ts',
    'app/sitemap.ts',
    'app/ads.txt/route.ts',
    'app/matches/[id]/page.tsx',
    'app/live/[matchId]/page.tsx',
    'app/privacy-policy/page.tsx',
    'app/terms/page.tsx',
    'app/about/page.tsx',
    'app/contact/page.tsx',
    'components/SportsEventJsonLd.tsx',
    'data/matches.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, rel)), true, `ملف مفقود: ${rel}`);
  }
  // مسار التاريخ القديم أُدمج داخل [id] لتفادي تعارض المسارات في App Router
  assert.equal(fs.existsSync(path.join(repoRoot, 'app/matches/[date]')), false);
});

test('10) ربط بطاقات الجدول بصفحات الهبوط يتم بمعرّفات المصادر الدقيقة فقط', () => {
  const views = resolveAllMatchViews();
  assert.equal(views.length, MATCH_CATALOG.length);

  for (const entry of MATCH_CATALOG) {
    const view = views.find((item) => item.entry.id === entry.id)!;
    if (!view.sourceMatch) continue;
    const entryForMatch = findCatalogEntryForMatch(view.sourceMatch);
    assert.equal(entryForMatch?.id, entry.id, `${entry.id}: الربط بالمصدر غير دقيق`);
    const linkMap = buildMatchLandingPathMap([view.sourceMatch]);
    assert.equal(linkMap[view.sourceMatch.id], buildMatchLandingPath(entry.id));
  }

  const featured = getFeaturedCatalogEntry();
  assert.ok(featured);
  assert.equal(featured!.id, MATCH_CATALOG[0].id);
});

test('11) وصف الصفحة الديناميكي يذكر الفريقين والموعد والملعب وحالة المباراة', () => {
  const view = resolveMatchView(MATCH_CATALOG[0]);
  const description = buildMatchDescription(view);
  assert.ok(description.includes(view.entry.homeTeam.nameAr));
  assert.ok(description.includes(view.entry.awayTeam.nameAr));
  assert.ok(description.includes(view.entry.competition.nameAr));
  assert.ok(description.includes(view.cairoDateLabelAr));
  assert.ok(description.includes(view.venueName));
  assert.ok(description.length <= 400, 'الوصف يجب أن يبقى في الطول المناسب لمحركات البحث');
});
