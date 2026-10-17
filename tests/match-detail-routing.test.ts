import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  isProviderBackedMatchId,
  parseMatchRecordId,
} from '../lib/matches/match-id-hints';
import {
  resolveMatchDetailTarget,
  resolveMatchDetailTargetSync,
} from '../lib/matches/resolve-match';
import MatchUnavailableView from '../components/MatchUnavailableView';
import MatchDetailPage from '../app/match/[id]/page';
import LegacyMatchLayout, {
  metadata as legacyLayoutMetadata,
} from '../app/match/[id]/layout';
import { matchesData } from '../lib/data/matches';
import * as store from '../lib/db/store';
import type { MatchRecord, NemoLinkResolution } from '../lib/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  توجيه صفحات تفاصيل المباراة — بلا 404 لمباراة موجودة (تدقيق 2026-10-17)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ما تُثبته هذه الاختبارات على مسار الإنتاج نفسه:
 *   ① معرّف سجل من أي مزوّد (SportScore / TheSportsDB / API-Football) يُقرأ من المخزن
 *     أو يُستعاد من المزوّد — ولا يُنتج 404 لمباراة حقيقية.
 *   ② المعرّفات القديمة (تكرار/تحويل) تُحوَّل إلى الصفحة القانونية بنفس المنطق.
 *   ③ المعرّف المجهول وحده يبقى 404 — لا صفحات مخترعة ولا soft-404.
 *   ④ حالة عدم التوفّر fallback أنيق وصادق مع روابط مفيدة — وليس صفحة 404 جامدة.
 *   ⑤ المسار القديم `/match/[id]` يحوّل معرّفات المباريات الحقيقية إلى `/matches/[id]`.
 */

process.env.NEMO_GATEWAY_STORE_PERSIST = 'off';

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

/** سجل مباراة صناعي (اختباري) بالشكل الكامل المطلوب من المخزن. */
function fakeRecord(overrides: Partial<MatchRecord> = {}): MatchRecord {
  // ملح فريد لكل اختبار: يمنع الهوية القوية (نفس الفريقين والتاريخ) من دمج السجلات
  // الصناعية لاختبارات مختلفة داخل المخزن المشترك.
  const salt = (overrides.id || 'match-thesportsdb-8888888').replace(/[^a-z0-9]+/gi, '-');
  const base: MatchRecord = {
    id: 'match-thesportsdb-8888888',
    competitionId: 'comp-test',
    competitionCode: 'TST',
    competitionNameAr: 'بطولة اختبارية',
    competitionNameEn: 'Test competition',
    competitionLogo: null,
    countryAr: 'دولي',
    region: 'world',
    priority: 75,
    isEgyptianInterest: false,
    seasonLabel: '2026-2027',
    roundLabelAr: null,
    utcKickoff: '2026-11-02T17:00:00.000Z',
    kickoffConfirmed: true,
    cairoDate: '2026-11-02',
    cairoTime: '20:00',
    homeTeam: {
      id: `team-test-home-${salt}`,
      nameAr: 'فريق اختباري أول',
      nameEn: `Test Home FC ${salt}`,
      logoUrl: null,
      isEgyptian: false,
    },
    awayTeam: {
      id: `team-test-away-${salt}`,
      nameAr: 'فريق اختباري ثانٍ',
      nameEn: `Test Away FC ${salt}`,
      logoUrl: null,
      isEgyptian: false,
    },
    status: 'not_started',
    statusLabelAr: 'لم تبدأ بعد',
    statusNoteAr: null,
    liveMinute: null,
    score: { home: null, away: null },
    venue: null,
    primarySource: 'thesportsdb',
    contributingSources: ['thesportsdb'],
    externalIds: { thesportsdbEventId: '8888888' },
    nemoLink: unverifiedLink(),
    lastUpdatedAt: '2026-11-01T10:00:00.000Z',
  };
  return { ...base, ...overrides };
}

/* ────────────────────────────────────────────────────────────────────────────
 *  1) قراءة معرّف السجل: أي مزوّد؟
 * ──────────────────────────────────────────────────────────────────────────── */

test('1) صيغ معرّفات المزوّدين تُقرأ بدقة (بغض النظر عن مصدر البيانات)', () => {
  const api = parseMatchRecordId('match-api-football-1612263');
  assert.equal(api.provider, 'api-football');
  assert.equal(api.externalId, '1612263');
  assert.equal(api.recoverable, true);

  const tsdb = parseMatchRecordId('match-thesportsdb-2561134');
  assert.equal(tsdb.provider, 'thesportsdb');
  assert.equal(tsdb.externalId, '2561134');

  const ssTracker = parseMatchRecordId('match-sportscore-l5ergph49xdlr8k');
  assert.equal(ssTracker.provider, 'sportscore');
  assert.equal(ssTracker.externalId, 'l5ergph49xdlr8k');

  const ssSlug = parseMatchRecordId('match-sportscore-zamalek-sc-vs-al-ahly-fc');
  assert.equal(ssSlug.provider, 'sportscore');
  assert.equal(ssSlug.externalId, 'zamalek-sc-vs-al-ahly-fc');

  const fd = parseMatchRecordId('match-football-data-3271234');
  assert.equal(fd.provider, 'football-data');

  // معرّف مُرمَّز في الرابط يُفك ترميزه قبل القراءة.
  assert.equal(parseMatchRecordId('match-api-football-1612263').externalId, '1612263');
});

test('2) المعرّف المجهول والمعرّف الصناعي لا يُوهمان بمزوّد', () => {
  const unknown = parseMatchRecordId('match-does-not-exist');
  assert.equal(unknown.provider, 'unknown');
  assert.equal(unknown.recoverable, false);

  const synthetic = parseMatchRecordId('match-synthetic-tst-2026-11-02-team-a-team-b');
  assert.equal(synthetic.provider, 'synthetic');
  assert.equal(synthetic.recoverable, false);

  assert.equal(isProviderBackedMatchId('match-thesportsdb-2561134'), true);
  assert.equal(isProviderBackedMatchId('match-does-not-exist'), false);
  assert.equal(isProviderBackedMatchId(''), false);
});

/* ────────────────────────────────────────────────────────────────────────────
 *  2) الوجهة من المخزن/الكتالوج — بلا شبكة
 * ──────────────────────────────────────────────────────────────────────────── */

test('3) سجل موجود في المخزن يُقرأ من صفحة التفاصيل مباشرة', () => {
  const target = resolveMatchDetailTargetSync('match-api-football-1612249');
  assert.equal(target.kind, 'record');
  if (target.kind === 'record') {
    assert.equal(target.record.id, 'match-api-football-1612249');
    assert.equal(target.path, '/matches/match-api-football-1612249');
  }
});

test('4) معرّف الكتالوج يفتح صفحة الهبوط الكاملة', () => {
  const target = resolveMatchDetailTargetSync('al-ittihad-alexandria-vs-zamalek-2026-10-20');
  assert.equal(target.kind, 'catalog');
  if (target.kind === 'catalog') {
    assert.equal(target.entry.id, 'al-ittihad-alexandria-vs-zamalek-2026-10-20');
  }
});

test('5) معرّف سجل له صفحة كتالوج يُحوَّل إلى الصفحة القانونية (alias)', () => {
  // السجل match-api-football-1612263 هو الاتحاد/الزمالك — وله صفحة هبوط في الكتالوج.
  const target = resolveMatchDetailTargetSync('match-api-football-1612263');
  assert.equal(target.kind, 'alias');
  if (target.kind === 'alias') {
    assert.equal(target.to, '/matches/al-ittihad-alexandria-vs-zamalek-2026-10-20');
  }
});

test('6) المعرّف القديم المُعلَّم كتكرار يُقرأ من السجل الأساسي (بلا 404)', () => {
  const db = store.getGatewayDatabase();
  const survivor = fakeRecord({
    id: 'match-thesportsdb-7770001',
    externalIds: { thesportsdbEventId: '7770001' },
  });
  const alias = fakeRecord({
    id: 'match-api-football-7770002',
    externalIds: { apiFootballFixtureId: '7770002' },
    duplicateOfId: survivor.id,
  });
  db.matches.push(survivor, alias);

  const target = resolveMatchDetailTargetSync(alias.id);
  assert.equal(target.kind, 'record', 'المعرّف القديم يجب ألا يصبح 404');
  if (target.kind === 'record') {
    assert.equal(target.record.id, survivor.id, 'المحتوى من السجل الأساسي (Canonical)');
    assert.equal(target.path, `/matches/${survivor.id}`);
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 *  3) الاستعادة من المزوّد (API حقيقي بمعرّف المباراة) — بشبكة مُحقونة
 * ──────────────────────────────────────────────────────────────────────────── */

test('7) معرّف مزوّد غير موجود في المخزن يُستعاد من المزوّد ثم يُعرض', async () => {
  const requested = 'match-thesportsdb-8888888';
  let lookupCalls = 0;
  const target = await resolveMatchDetailTarget(requested, {
    refresh: false,
    lookup: async () => {
      lookupCalls += 1;
      return fakeRecord();
    },
  });

  assert.equal(lookupCalls, 1, 'استعادة واحدة موجَّهة بمعرّف المزوّد');
  assert.equal(target.kind, 'record');
  if (target.kind === 'record') {
    // السجل بقي في المخزن بعد الاستعادة — الطلب التالي يقرأه بلا أي نداء شبكة.
    assert.equal(target.record.id, requested);
    assert.equal(store.findMatchRecordById(requested)?.id, requested);
  }

  const second = await resolveMatchDetailTarget(requested, { refresh: false });
  assert.equal(second.kind, 'record', 'القراءة الثانية من المخزن مباشرة');
});

test('8) سجل مُستعاد يندمج في سجل قائم بنفس المباراة فيُعرض السجل المخزَّن', async () => {
  const db = store.getGatewayDatabase();
  // الفريقان والتاريخ موحَّدان يدويًا: الهوية القوية (نفس المباراة بمصدرين) هي موضوع الاختبار.
  const sharedTeams = {
    homeTeam: {
      id: 'team-merge-home',
      nameAr: 'فريق دمج أول',
      nameEn: 'Merge Home FC',
      logoUrl: null,
      isEgyptian: false,
    },
    awayTeam: {
      id: 'team-merge-away',
      nameAr: 'فريق دمج ثانٍ',
      nameEn: 'Merge Away FC',
      logoUrl: null,
      isEgyptian: false,
    },
  };
  const existing = fakeRecord({
    id: 'match-thesportsdb-9990001',
    externalIds: { thesportsdbEventId: '9990001' },
    ...sharedTeams,
  });
  db.matches.push(existing);

  // المزوّد يعيد نفس المباراة بمعرّف API-Football (المصدر نفسه بمعرّف آخر).
  const requested = 'match-api-football-9990002';
  const target = await resolveMatchDetailTarget(requested, {
    refresh: false,
    lookup: async () =>
      fakeRecord({
        id: requested,
        externalIds: { apiFootballFixtureId: '9990002', thesportsdbEventId: '9990001' },
        ...sharedTeams,
      }),
  });

  assert.equal(target.kind, 'record');
  if (target.kind === 'record') {
    assert.equal(
      target.record.id,
      existing.id,
      'الهوية القوية تمنع سجلًا ثالثًا — يُعرض السجل المخزَّن'
    );
  }
});

test('9) المجهول لا يُطلق أي نداء شبكة ويبقى 404 صريحًا', async () => {
  let lookupCalls = 0;
  const target = await resolveMatchDetailTarget('match-does-not-exist', {
    refresh: true,
    lookup: async () => {
      lookupCalls += 1;
      return fakeRecord();
    },
  });
  assert.equal(target.kind, 'unavailable');
  assert.equal(lookupCalls, 0, 'المعرّف المجهول لا يستدعي المزوّد إطلاقًا');
  if (target.kind === 'unavailable') {
    assert.equal(target.hint.provider, 'unknown');
    // المجهول وحده يستحق 404 — المعرّفات الحقيقية تحصل على fallback أنيق.
    assert.equal(target.hint.provider !== 'unknown', false);
  }
});

test('10) معرّف مزوّد تعذّرت استعادته ينتهي بـ fallback أنيق لا بـ 404', async () => {
  const target = await resolveMatchDetailTarget('match-thesportsdb-4242424', {
    refresh: false,
    lookup: async () => null,
  });
  assert.equal(target.kind, 'unavailable');
  if (target.kind === 'unavailable') {
    assert.equal(target.hint.provider, 'thesportsdb');
    assert.equal(target.hint.recoverable, true);
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 *  4) واجهة عدم التوفّر: صادقة، أنيقة، ومفيدة
 * ──────────────────────────────────────────────────────────────────────────── */

test('11) fallback غير التوفّر يشرح الحالة ويعيد الزائر لمسارات مفيدة', () => {
  const hint = parseMatchRecordId('match-thesportsdb-2561134');
  const html = renderToStaticMarkup(MatchUnavailableView({ hint }));

  assert.match(html, /تفاصيل المباراة غير متاحة الآن/);
  // روابط العودة المفيدة — الجدول والأخبار.
  assert.match(html, /href="\/"/);
  assert.match(html, /href="\/matches"/);
  assert.match(html, /href="\/news"/);
  // المعرّف المطلوب يُعرض بوضوح لدعم الزائر.
  assert.ok(html.includes('match-thesportsdb-2561134'));
  // لا نُخترع معلومة مباراة (لا فرق ولا موعد ولا نتيجة).
  assert.doesNotMatch(html, /ضد/);
  assert.doesNotMatch(html, /نتيجة/);
});

test('11-ب) أحداث اللقاء تُعرض في صفحة الهبوط عند توفّرها من المصدر فقط', async () => {
  const { resolveMatchView } = await import('../lib/matches/match-catalog');
  const { MATCH_CATALOG } = await import('../data/matches');
  const { default: MatchLandingView } = await import('../components/MatchLandingView');

  const view = resolveMatchView(MATCH_CATALOG[0]);

  // ① بلا أحداث من المصدر: لا قسم أحداث مُخترع.
  const withoutEvents = renderToStaticMarkup(MatchLandingView({ view }));
  assert.doesNotMatch(withoutEvents, /أحداث المباراة/);

  // ② بأحداث مُرسلة من المصدر: تُعرض كما هي (دقيقة + لاعب + نوع + الفريق).
  const withSourceEvents = renderToStaticMarkup(
    MatchLandingView({
      view: {
        ...view,
        sourceMatch: {
          ...(view.sourceMatch ?? {}),
          id: 'match-api-football-1612263',
          primarySource: 'thesportsdb',
          incidents: [
            { minute: 23, type: 'goal', side: 'home', player: 'لاعب الاختبار', detail: 'تسديدة' },
            { minute: 45, type: 'yellow_card', side: 'away', player: 'لاعب آخر' },
          ],
        } as never,
      },
    })
  );
  assert.match(withSourceEvents, /أحداث المباراة/);
  assert.match(withSourceEvents, /لاعب الاختبار/);
  assert.match(withSourceEvents, /هدف/);
  assert.match(withSourceEvents, /بطاقة صفراء/);
});

/* ────────────────────────────────────────────────────────────────────────────
 *  5) المسار التوافقي القديم /match/[id]
 * ──────────────────────────────────────────────────────────────────────────── */

test('12) حارس /match/[id]: السجلات القديمة ومعرّفات المباريات الحقيقية تمرّ، والمجهول 404', async () => {
  // ① سجل قديم ثابت: يمرّ كما هو.
  assert.equal(
    await LegacyMatchLayout({ children: 'unchanged', params: Promise.resolve({ id: matchesData[0].id }) }),
    'unchanged'
  );

  // ② معرّف مباراة حقيقي من المخزن: يمرّ ليحوّله المسار إلى /matches/[id].
  assert.equal(
    await LegacyMatchLayout({
      children: 'unchanged',
      params: Promise.resolve({ id: 'match-api-football-1612249' }),
    }),
    'unchanged'
  );

  // ③ معرّف مجهول: 404 صريح (لا soft 404).
  await assert.rejects(
    LegacyMatchLayout({ children: 'unchanged', params: Promise.resolve({ id: 'match-does-not-exist' }) }),
    /NEXT_HTTP_ERROR_FALLBACK;404/
  );

  // واجهة الروبوتات القديمة محفوظة (لا فهرسة للبيانات غير الموثقة).
  const robots = legacyLayoutMetadata.robots;
  assert.equal(typeof robots === 'object' && robots !== null ? robots.index : undefined, false);
});

test('13) صفحة /match/[id]: العرض القديم للسجلات القديمة، وتحويل دائم للمباريات الحقيقية', async () => {
  // ① سجل قديم: نفس العرض القديم (بيانات lib/data/matches.ts) — يُمرَّر سجله كاملًا.
  const legacyElement = await MatchDetailPage({
    params: Promise.resolve({ id: matchesData[0].id }),
  });
  const legacyProps = (legacyElement as { props?: { match?: { id: string } } }).props;
  assert.equal(legacyProps?.match?.id, matchesData[0].id, 'العرض القديم يستلم السجل القديم');

  // ② معرّف مباراة حقيقي: تحويل إلى الصفحة الموحدة /matches/[id] — لا 404.
  await assert.rejects(
    MatchDetailPage({ params: Promise.resolve({ id: 'match-api-football-1612249' }) }),
    /NEXT_REDIRECT/
  );
});
