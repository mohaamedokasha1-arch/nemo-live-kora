import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../lib/db/store';
import { generateMetadata as matchPageMetadata } from '../app/matches/[id]/page';
import { auditMatchLinkIntegrity, blockingLinkIssues, findDuplicateFixtureGroups } from '../lib/match-identity';
import type { GatewayDatabase, MatchRecord, NemoLinkResolution } from '../lib/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  التكرار عبر المصادر من منظور المخزن والقراءة العامة (تدقيق 2026-10-15)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ما تُثبته هذه الاختبارات على نفس مسار الإنتاج: رفع سجلين لنفس المباراة من مصدرين
 *  مختلفين لا ينتج مباراة معروضة مرتين، ولا يحذف سجلًا، ولا ينكسر أي رابط قديم:
 *   • الجدول/PII يستبعد السجل المُعلَّم كتكرار ويحتفظ بالسجل الأساسي فقط.
 *   • المعرّف القديم (الذي كان رابطًا حقيقيًا على الموقع) يبقى يعمل ويُحال إلى الأساسي.
 *   • مزامنة ثانية بنفس السجلات لا تُنشئ سجلًا ثالثًا ولا تُغيّر المعرّفات.
 */

const environmentKeys = ['NEMO_GATEWAY_STORE_PERSIST', 'NEMO_DATA_DIR', 'VERCEL', 'VERCEL_ENV'] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
let dataDir: string;

function unverifiedLink(): NemoLinkResolution {
  return {
    url: null,
    linkType: 'unavailable',
    labelAr: 'شاهد مباشرة على NEMO Sports',
    subLabelAr: 'شاهد المباراة عبر منصة NEMO Sports، واختر المباراة من صفحة المشاهدة.',
    verified: false,
    matchedBy: [],
    competitionUrl: null,
    scheduleUrl: null,
  };
}

function liveRecords(): MatchRecord[] {
  const file = path.join(process.cwd(), 'tests/fixtures/live/duplicate-fixtures-2026-10-15.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { records: Array<Partial<MatchRecord>> };
  return parsed.records.map(
    (record) =>
      ({
        statusNoteAr: null,
        liveMinute: null,
        region: 'world',
        priority: 75,
        isEgyptianInterest: false,
        competitionLogo: null,
        nemoLink: unverifiedLink(),
        contributingSources: [record.primarySource ?? 'sportscore'],
        ...record,
      }) as MatchRecord
  );
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nemo-dup-store-'));
});

beforeEach(async () => {
  for (const key of environmentKeys) delete process.env[key];
  process.env.NEMO_DATA_DIR = dataDir;
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  store.resetStoreStateForTests();
  await store.hydrateGatewayDatabase();
  // مخزن اختباري معزول: لا نلمس اللقطة المُودَعة في data/.
  store.persistGatewayDatabase({
    ...store.getGatewayDatabase(),
    matches: [],
    news: [],
  });
});

after(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('رفع المباراة نفسها من مصدرين ينتج مباراة معروضة واحدة ويحفظ السجل الثاني ببياناته', async () => {
  const records = liveRecords();
  const stats = store.upsertMatchesInStoreWithStats(records);
  assert.equal(stats.processed, 4);

  const db = store.getGatewayDatabase();
  assert.equal(db.matches.length, 4, 'لا سجل حُذف: الأربعة موجودون في المخزن');
  const active = store.getActiveMatches(db);
  assert.equal(active.length, 2, 'المعروض مباراتان (واحدة لكل لقاء) لا أربعة');

  const chicago = active.find((match) => match.homeTeam.nameEn === 'Chicago Fire') as MatchRecord;
  assert.ok(chicago, 'السجل الأساسي لمباراة Chicago موجود');
  assert.equal(chicago.externalIds.sportscoreTrackerId, '1l4rjnh9lgo0m7v');
  assert.equal(chicago.externalIds.thesportsdbEventId, '2407135');
  assert.equal(chicago.externalIds.apiFootballFixtureId, '1490533');
  assert.deepEqual([...chicago.contributingSources].sort(), ['sportscore', 'thesportsdb']);
  assert.equal(chicago.venue, 'Soldier Field', 'الملعب الغائب عن أحد المصدرين يُملأ من الآخر');

  const marked = db.matches.filter((match) => match.duplicateOfId);
  assert.equal(marked.length, 2);
  assert.ok(marked.every((match) => match.duplicateEvidence?.survivorId === match.duplicateOfId));
  // دليل الدمج مسجَّل في meta ليراه المشغّل في /api/sources وفي اللوحة.
  assert.equal(db.meta.lastFixtureConsolidation?.markedDuplicates, 2);
  assert.equal(db.meta.lastFixtureConsolidation?.requiresReview, 0);
});

test('القراءة العامة تعرض المباراة مرة واحدة، وعدّادات المخزن لا تُضخَّم بالتكرار', async () => {
  store.upsertMatchesInStoreWithStats(liveRecords());

  const result = store.queryGatewayMatches({ cairoDate: '2026-10-15' });
  assert.equal(result.matches.length, 2);
  assert.equal(result.totalOnDate, 2);
  assert.equal(result.totalInStore, 2, 'العدّ المعروض يستثني السجل المُعلَّم كتكرار');
  assert.equal(result.totalInStoreIncludingDuplicates, 4, 'والعدد الخام يبقى مرئيًا للمراجعة');
  assert.equal(result.availableCompetitions.length, 1, 'البطولة الواحدة لا تظهر كخيارين في التصفية');

  const chicagoHits = result.matches.filter((match) => match.homeTeam.nameEn === 'Chicago Fire');
  assert.equal(chicagoHits.length, 1);

  const search = store.queryGatewayMatches({ cairoDate: '2026-10-15', searchQuery: 'philadelphia' });
  assert.equal(search.matches.length, 1, 'البحث لا يُرجع المباراة مرتين');

  const dates = result.availableDates.find((entry) => entry.date === '2026-10-15');
  assert.equal(dates?.total, 2, 'تاريخ اليوم لا يُعدّ فيه التكرار');

  // وخريطة الموقع تُبنى من السجلات المعروضة نفسها (لا صفحات تكرار إضافية).
  assert.equal(store.getActiveMatches(store.getGatewayDatabase()).length, 2);
});

test('المعرّف القديم (رابط كان يعمل) يبقى يعمل ويُقرأ من السجل الأساسي', async () => {
  store.upsertMatchesInStoreWithStats(liveRecords());
  const db = store.getGatewayDatabase();
  const survivor = db.matches.find(
    (match) => !match.duplicateOfId && match.homeTeam.nameEn === 'Chicago Fire'
  ) as MatchRecord;
  const aliasId = 'match-api-football-1490533';
  assert.notEqual(survivor.id, aliasId);

  const viaAlias = store.findMatchRecordById(aliasId);
  assert.ok(viaAlias, 'المعرّف القديم لم يُصبح 404');
  assert.equal(viaAlias.id, survivor.id, 'يُقرأ من السجل الأساسي نفسه (Canonical)');
  assert.equal(viaAlias.nemoLink.verified, survivor.nemoLink.verified);

  // والمعرّف الأساسي يبقى كما هو، والمعرّف المجهول يبقى غير موجود (لا اختراع صفحات).
  assert.equal(store.findMatchRecordById(survivor.id)?.id, survivor.id);
  assert.equal(store.findMatchRecordById('match-does-not-exist'), null);
});

test('مزامنة ثانية بنفس السجلات: لا سجل جديد ولا تغيير في المعرّفات', async () => {
  store.upsertMatchesInStoreWithStats(liveRecords());
  const before = store.getActiveMatches(store.getGatewayDatabase()).map((match) => match.id).sort();
  const second = store.upsertMatchesInStoreWithStats(liveRecords());
  assert.equal(second.inserted, 0, 'لم يُنشأ أي سجل جديد في المزامنة الثانية');
  const after = store.getActiveMatches(store.getGatewayDatabase()).map((match) => match.id).sort();
  assert.deepEqual(after, before);
  assert.equal(store.getGatewayDatabase().matches.length, 4);
});

test('سجل مُعلَّم كتكرار يمكن الكتابة عليه من مصدره بلا أن يظهر للزائر', async () => {
  store.upsertMatchesInStoreWithStats(liveRecords());
  const db = store.getGatewayDatabase();
  const markedBefore = db.matches.find((match) => match.id === 'match-api-football-1490533') as MatchRecord;
  assert.equal(markedBefore.duplicateOfId, 'match-sportscore-1l4rjnh9lgo0m7v');

  // تحديث قادم من TheSportsDB لنفس المباراة: يُدمج في السجل الأساسي ويبقى التكرار معلَّمًا.
  store.upsertMatchesInStoreWithStats([
    { ...markedBefore, status: 'finished', score: { home: 1, away: 3 }, lastUpdatedAt: new Date().toISOString() },
  ]);
  const after = store.getGatewayDatabase();
  const markedAfter = after.matches.find((match) => match.id === 'match-api-football-1490533') as MatchRecord;
  assert.equal(markedAfter.duplicateOfId, 'match-sportscore-1l4rjnh9lgo0m7v');
  assert.equal(store.getActiveMatches(after).length, 2);
  assert.equal(after.matches.length, 4);
});

test('انقطاع المصادر لا يمس السجلات المكررة المحفوظة ولا الأساسية', async () => {
  store.upsertMatchesInStoreWithStats(liveRecords());
  const before = structuredClone(store.getGatewayDatabase().matches);
  store.upsertMatchesInStoreWithStats([]);
  const after = store.getGatewayDatabase().matches;
  assert.equal(after.length, before.length);
  assert.deepEqual(
    after.map((match) => [match.id, match.duplicateOfId ?? null]).sort(),
    before.map((match) => [match.id, match.duplicateOfId ?? null]).sort()
  );
});

test('فحص سلامة الروابط: التكرار المُعلَّم يُحتسب كمعالَج، وغير المُعلَّم يُبلَّغ كخطأ', async () => {
  const records = liveRecords();
  const mergedOnly = records.map((record) => ({ ...record }));

  // قبل التوحيد: الفحص يعتبر المباراة نفسها مكررة في سجلين (خطأ يجب أن يظهر).
  const beforeReport = auditMatchLinkIntegrity(mergedOnly);
  assert.equal(beforeReport.unresolvedDuplicateGroups.length, 2);
  assert.equal(beforeReport.mergedDuplicates, 0);
  assert.ok(
    blockingLinkIssues(beforeReport).some((issue) => issue.code === 'duplicate_fixture_across_sources')
  );

  store.upsertMatchesInStoreWithStats(records);
  const afterReport = auditMatchLinkIntegrity(store.getActiveMatches(store.getGatewayDatabase()));
  assert.equal(afterReport.unresolvedDuplicateGroups.length, 0);
  assert.equal(afterReport.checked, 2);
  assert.equal(findDuplicateFixtureGroups(store.getActiveMatches(store.getGatewayDatabase())).length, 0);

  // والفحص الشامل للمخزن يرى السجلات المحفوظة كتكرارات معالَجة لا كأخطاء مفتوحة.
  const wholeStoreReport = auditMatchLinkIntegrity(store.getGatewayDatabase().matches);
  assert.equal(wholeStoreReport.mergedDuplicates, 2);
  assert.equal(
    blockingLinkIssues(wholeStoreReport).filter(
      (issue) => issue.code === 'duplicate_fixture_across_sources'
    ).length,
    0
  );
});

test('اللقطة المكتوبة على القرص تحفظ السجلين المكررين (لا حذف صامت عند الاستعادة)', async () => {
  store.upsertMatchesInStoreWithStats(liveRecords());
  const flush = await store.flushDurableStore({ force: true });
  assert.equal(flush.ok, true, flush.error ?? '');

  store.resetStoreStateForTests();
  const restored = await store.hydrateStore();
  const persisted: GatewayDatabase = restored;
  assert.equal(persisted.matches.length, 4, 'الأربعة سجلات موجودة في اللقطة المستعادة');
  assert.equal(store.getActiveMatches(persisted).length, 2);
});

test('صفحة المعرّف القديم: تعمل بلا 404، ومحتواها للسجل الأساسي، وcanonical إلى الصفحة الأساسية', async () => {
  store.upsertMatchesInStoreWithStats(liveRecords());
  const db = store.getGatewayDatabase();
  const marked = db.matches.find((match) => match.id === 'match-api-football-1490533') as MatchRecord;
  const survivorId = marked.duplicateOfId as string;
  assert.equal(survivorId, 'match-sportscore-1l4rjnh9lgo0m7v');

  // ① الرابط القديم (كان يعمل على الموقع قبل الإصلاح) لا يصبح 404، ويشير إلى الصفحة الأساسية.
  const legacy = await matchPageMetadata({ params: Promise.resolve({ id: marked.id }) });
  assert.equal(legacy.alternates?.canonical, `/matches/${survivorId}`);
  assert.ok(!('title' in legacy) || !String(legacy.title).includes('غير متاحة'), 'الصفحة ليست حالة عدم وجود');

  // ② الصفحة الأساسية تشير إلى نفسها.
  const canonical = await matchPageMetadata({ params: Promise.resolve({ id: survivorId }) });
  assert.equal(canonical.alternates?.canonical, `/matches/${survivorId}`);

  // ③ ومعرّف غير موجود يبقى غير موجود (لا تُخترع صفحات).
  const missing = await matchPageMetadata({ params: Promise.resolve({ id: 'match-does-not-exist' }) });
  assert.equal(String(missing.title).includes('غير متاحة') || missing.robots !== undefined, true);

  // ④ ولا يُضاف أي من السجلين إلى خريطة الموقع: صفحات سجلات المصادر الخام خارج الخريطة عن قصد.
  const sitemapModule = await import('../app/sitemap');
  const entries = await sitemapModule.default();
  const urls = entries.map((entry) => entry.url);
  assert.equal(urls.some((url) => url.endsWith(`/matches/${marked.id}`)), false);
  assert.equal(urls.some((url) => url.endsWith(`/matches/${survivorId}`)), false);
});
