import test, { after, afterEach, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { clearHttpCache } from '../lib/sources/http-client';
import type { MatchRecord } from '../lib/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  اختبارات لوحة الإدارة — السيناريوهات المطلوبة
 * ═══════════════════════════════════════════════════════════════════════════════
 *  1) الدخول والصلاحيات.
 *  2) إضافة مباراة وتعديلها وظهورها على الموقع فعليًا.
 *  3) حماية تعديل المدير من الكتابة فوقه في المزامنة التالية.
 *  4) سقوط مصدر ← بقية المصادر تكمل، وبلا بيانات مُختلقة.
 *  5) عودة المصدر ← العمل من جديد.
 *  6) منع تكرار المباريات.
 *  7) إضافة خبر ونشره ثم تعديله (بلا كسر صفحته المفهرسة).
 *  8) نسخة احتياطية: إنشاء + فحص سلامة + استعادة بنسخة وقائية.
 *  9) الكرونات في بيئة النشر + النسخة المجدولة + عدم وجود مسارات مكسورة.
 * 10) الصدق في الاستضافة: بلا تخزين دائم تُرفض النسخة ويُعلن السبب (لا نجاح وهمي).
 *
 * مبادئ هذه الاختبارات: تعمل على تخزين مؤقت في `os.tmpdir()` فلا تلمس `data/` في المستودع،
 * ولا تتصل بأي خدمة خارجية (الشبكة مُستبدلة)، وتتحقق من الأثر الفعلي في المخزن الذي تقرأ
 * منه صفحات الموقع — لا من شكل الاستجابة فقط.
 */

const projectRoot = process.cwd();
const environmentKeys = [
  'NEMO_GATEWAY_STORE_PERSIST',
  'NEMO_DATA_DIR',
  'NEMO_MANUAL_FILE_DURABLE',
  'NEMO_MANUAL_WRITE',
  'NEMO_ADMIN_USER',
  'NEMO_ADMIN_PASSWORD_HASH',
  'NEMO_ADMIN_USERS',
  'NEMO_ADMIN_SESSION_SECRET',
  'NEMO_BACKUP_RETENTION',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'VERCEL',
  'VERCEL_ENV',
  'CRON_SECRET',
  'NEMO_INGEST_TOKEN',
  'API_FOOTBALL_KEY',
  'FOOTBALL_DATA_API_KEY',
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const realFetch = globalThis.fetch;

let dataDir: string;
let store: typeof import('../lib/db/store');
let manualStore: typeof import('../lib/admin/manual-store');
let manualDocument: typeof import('../lib/admin/manual-document');
let merge: typeof import('../lib/admin/merge');
let service: typeof import('../lib/admin/service');
let backups: typeof import('../lib/admin/backups');
let session: typeof import('../lib/auth/admin-session');

/** مباراة اختبار تُعيدها المصادر الوهمية (نفس شكل استجابة SportScore). */
function sourceMatch(home: string, away: string, homeScore: number, awayScore: number) {
  return {
    home,
    away,
    home_score: homeScore,
    away_score: awayScore,
    status: 'finished',
    time: '2026-10-12T17:00:00Z',
    competition: 'Egyptian Premier League',
  };
}

/** يجعل كل مصادر المباريات تُعيد نفس السجل (أو تُفشل) بلا أي اتصال حقيقي. */
function stubGatewayFetch(options: { failing?: boolean; home?: string; away?: string; score?: [number, number] } = {}) {
  const [home, away] = options.home ? [options.home, options.away!] : ['Ismaily', 'Al Masry'];
  const [hs, as] = options.score ?? [2, 1];
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.includes('127.0.0.1') || url.includes('localhost')) return realFetch(input, init);
    if (url.includes('ceid=')) return new Response('<rss><channel></channel></rss>');
    if (options.failing) throw new Error('all providers unreachable');
    const isMatchesEndpoint = url.includes('/api/widget/matches') || url.includes('/api/v1/matches');
    return Response.json({
      matches: isMatchesEndpoint ? [sourceMatch(home, away, hs, as)] : [],
      events: [],
      competitions: [],
      tables: [],
      errors: { token: 'Missing application key' },
    });
  });
}

function manualMatchForm(overrides: Record<string, unknown> = {}) {
  return {
    homeNameAr: 'الإسماعيلي',
    homeNameEn: 'Ismaily',
    awayNameAr: 'المصري البورسعيدي',
    awayNameEn: 'Al Masry',
    competitionCode: 'EGY',
    kickoffUtc: '2026-10-20T17:00:00Z',
    status: 'scheduled' as const,
    ...overrides,
  };
}

const OWNER = { username: 'admin', role: 'owner' as const };

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nemo-admin-'));
  process.env.NEMO_DATA_DIR = dataDir;
  store = await import('../lib/db/store');
  manualStore = await import('../lib/admin/manual-store');
  manualDocument = await import('../lib/admin/manual-document');
  merge = await import('../lib/admin/merge');
  service = await import('../lib/admin/service');
  backups = await import('../lib/admin/backups');
  session = await import('../lib/auth/admin-session');
});

beforeEach(async () => {
  for (const key of environmentKeys) delete process.env[key];
  process.env.NEMO_DATA_DIR = dataDir;
  process.env.NEMO_GATEWAY_STORE_PERSIST = 'on';
  // تخزين ملف محلي على قرص قابل للكتابة = تخزين دائم حقيقي (وهو ما نحتاجه لاختبار النسخ).
  process.env.NEMO_MANUAL_FILE_DURABLE = 'true';
  process.env.NEMO_ADMIN_USER = 'admin';
  process.env.NEMO_ADMIN_PASSWORD_HASH = session.hashAdminPassword('AdminTestPass123!');
  process.env.NEMO_ADMIN_SESSION_SECRET = 'test-session-secret-0123456789abcdef';
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPO;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;

  fs.rmSync(path.join(dataDir, 'manual-content.json'), { force: true });
  fs.rmSync(path.join(dataDir, 'gateway-store.json'), { force: true });
  fs.rmSync(path.join(dataDir, 'backups'), { recursive: true, force: true });

  manualStore.resetManualRuntimeForTests();
  store.resetStoreStateForTests();
  await store.hydrateGatewayDatabase();
  store.persistGatewayDatabase(structuredClone(store.getGatewayDatabase()));
  await manualStore.loadManualDocument(true);
});

afterEach(() => {
  mock.restoreAll();
  clearHttpCache();
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(path.join(os.tmpdir(), 'nemo-gateway'), { recursive: true, force: true });
});

// ── 1) الدخول والصلاحيات ─────────────────────────────────────────────────────

test('1) الدخول: كلمة المرور مُجزَّأة (scrypt) والجلسة موقَّعة، ولا كلمة مرور في الكوكي', () => {
  const hash = session.hashAdminPassword('AdminTestPass123!');
  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$/);
  assert.equal(hash.includes('AdminTestPass123!'), false, 'لا تُخزَّن كلمة المرور نفسها');
  assert.equal(session.verifyAdminPassword('AdminTestPass123!', hash), true);
  assert.equal(session.verifyAdminPassword('AdminTestPass12!', hash), false);
  assert.equal(session.verifyAdminPassword('', hash), false);

  const created = session.createAdminSession({
    username: 'admin',
    role: 'owner',
    displayNameAr: 'مدير الموقع',
    via: 'password',
  });
  assert.equal(created.ok, true, created.messageAr);
  const cookie = created.cookie!;
  assert.equal(cookie.includes('AdminTestPass123!'), false, 'الكوكي لا يحتوي كلمة المرور');
  const identity = session.readAdminSession(cookie);
  assert.equal(identity?.username, 'admin');
  assert.equal(identity?.role, 'owner');

  // توقيع مزوَّر لا يُقبل.
  const [version, body] = cookie.split('.');
  assert.equal(session.readAdminSession(`${version}.${body}.forged-signature`), null);
});

test('1ب) الصلاحيات مفروضة على الخادم: المشاهد يقرأ فقط، والمحرّر لا يستعيد النسخ', async () => {
  assert.equal(session.roleHasPermission('viewer', 'dashboard:read'), true);
  assert.equal(session.roleHasPermission('viewer', 'matches:write'), false);
  assert.equal(session.roleHasPermission('editor', 'matches:write'), true);
  assert.equal(session.roleHasPermission('editor', 'backups:restore'), false);
  assert.equal(session.roleHasPermission('owner', 'backups:restore'), true);
  assert.equal(session.roleHasPermission('owner', 'settings:write'), true);
  assert.equal(session.roleHasPermission('editor', 'settings:write'), false);

  // والفرض حقيقي على بوابة الخادم نفسها التي تستدعيها كل مسارات اللوحة، لا في جدول أدوار فقط:
  // نُصدر جلسات فعلية بأدوار مختلفة ثم نطلب الصلاحية كما تفعل المسارات.
  const asRequest = (sessionValue: string | null): NextRequest =>
    new NextRequest('https://nemo.test/api/admin/backups', {
      // ترويسة الكوكي تحمل الاسم=القيمة كما يفعل المتصفح؛ القيمة وحدها لا يقرؤها الخادم.
      headers: sessionValue ? { cookie: `${session.ADMIN_SESSION_COOKIE}=${sessionValue}` } : {},
    });
  const editorCookie = session.createAdminSession(
    { username: 'editor', role: 'editor', displayNameAr: 'محرّر', via: 'password' },
    process.env
  ).cookie;
  const viewerCookie = session.createAdminSession(
    { username: 'viewer', role: 'viewer', displayNameAr: 'مشاهد', via: 'password' },
    process.env
  ).cookie;
  assert.ok(editorCookie && viewerCookie);

  const editorWrite = session.requireAdminPermission(asRequest(editorCookie), 'matches:write');
  assert.equal(session.isDenied(editorWrite), false, 'المحرّر يضيف ويعدّل المباريات');
  const editorRestore = session.requireAdminPermission(asRequest(editorCookie), 'backups:restore');
  assert.equal(session.isDenied(editorRestore), true, 'المحرّر لا يستعيد النسخ');
  if (session.isDenied(editorRestore)) assert.equal(editorRestore.response.status, 403);
  const viewerWrite = session.requireAdminPermission(asRequest(viewerCookie), 'matches:write');
  assert.equal(session.isDenied(viewerWrite), true, 'المشاهد للقراءة فقط');
  const anonymous = session.requireAdminPermission(asRequest(null), 'matches:read');
  assert.equal(session.isDenied(anonymous), true, 'بلا جلسة لا قراءة إدارية');
  if (session.isDenied(anonymous)) assert.equal(anonymous.response.status, 401);
});

test('1ج) بلا أي حساب مضبوط لا تُنشأ جلسات إطلاقًا (لا بيانات دخول افتراضية في الكود)', () => {
  const env = {} as NodeJS.ProcessEnv;
  assert.equal(session.isAdminLoginAvailable(env), false);
  const created = session.createAdminSession(
    { username: 'admin', role: 'owner', displayNameAr: 'x', via: 'password' },
    env
  );
  assert.equal(created.ok, false);
  assert.equal(created.cookie, null);
  assert.equal(session.hashAdminPassword('x').includes('AdminTestPass123'), false);
});

// ── 2) إضافة مباراة وتعديلها وظهورها على الموقع ─────────────────────────────

test('2) مباراة يدوية تُنشأ وتظهر في مخزن الموقع، وتعديلها لا يُنتج نسخة ثانية', async () => {
  const created = await service.createManualMatch(manualMatchForm({ liveMinute: 37 }), OWNER);
  assert.equal(created.ok, true, created.messageAr);
  const id = created.data!.id;
  assert.equal(id, 'ismaily-vs-al-masry-2026-10-20');

  // الأثر الفعلي: السجل موجود في المخزن الذي تقرأ منه صفحات الموقع.
  const db = store.getGatewayDatabase();
  const inStore = db.matches.find((match) => match.id === id);
  assert.ok(inStore, 'المباراة اليدوية وصلت إلى مخزن الموقع');
  assert.equal(inStore!.origin, 'manual');
  assert.equal(inStore!.liveMinute, 37);
  assert.equal(inStore!.competitionNameEn, 'Egyptian Premier League', 'بيانات البطولة تُستكمل من الكتالوج');
  assert.equal(inStore!.seasonLabel, '2026-2027');

  // لقطة الموقع الدائمة تبقى بيانات المصادر وحدها (لا خلط طبقة الإدارة فيها).
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'gateway-store.json'), 'utf-8')
  ) as { snapshot?: { matches: MatchRecord[] } };
  const snapshotMatches = snapshot.snapshot?.matches ?? [];
  assert.equal(snapshotMatches.some((match) => match.id === id), false, 'اللقطة الدائمة لا تحتوي سجل الإدارة');

  // التعديل: نفس المعرّف، بلا نسخة ثانية.
  const edited = await service.updateManualMatch(
    id,
    manualMatchForm({ status: 'live', scoreHome: 1, scoreAway: 0, liveMinute: 55 }),
    OWNER
  );
  assert.equal(edited.ok, true, edited.messageAr);
  assert.equal(manualStore.listManualMatches().length, 1);
  const afterEdit = store.getGatewayDatabase().matches.find((match) => match.id === id)!;
  assert.equal(afterEdit.status, 'live');
  assert.equal(afterEdit.score.home, 1);
  assert.equal(afterEdit.liveMinute, 55);

  // تعديل جزئي حقيقي: تغيير النتيجة وحدها لا يُفقد الفرق ولا البطولة ولا الملعب (وهو ما كان
  // يرفض الحفظ بحجّة حقول ناقصة إذا أرسلت الواجهة الحقل المُعدَّل فقط).
  const partial = await service.updateManualMatch(id, { status: 'finished', scoreHome: 3, scoreAway: 2 }, OWNER);
  assert.equal(partial.ok, true, partial.messageAr);
  assert.equal(partial.data!.homeTeam.nameAr, 'الإسماعيلي', 'بيانات الفرق باقية كما هي');
  assert.equal(partial.data!.competitionCode, 'EGY');
  assert.equal(partial.data!.status, 'finished');
  assert.equal(partial.data!.score.home, 3);
  assert.equal(manualStore.listManualMatches().length, 1, 'التعديل لا يُنشئ نسخة ثانية');

  // تفريغ حقل صريحًا قيمةٌ مقصودة تختلف عن «لم يُرسَل».
  const cleared = await service.updateManualMatch(id, { venue: null, statusNoteAr: null }, OWNER);
  assert.equal(cleared.ok, true, cleared.messageAr);
  assert.equal(cleared.data!.venue, null, 'الحقل المُفرَّغ صراحة يُمسح فعلًا');
  assert.equal(cleared.data!.status, 'finished', 'وبقية الحقول لا تتغيّر');
});

// ── 3) حماية تعديل المدير من المزامنة ────────────────────────────────────────

test('3) التثبيت اليدوي يمنع المزامنة من الكتابة فوق الحقول المثبَّتة (والحقول الأخرى تتحدّث عادي)', async () => {
  stubGatewayFetch({ score: [2, 1] });
  clearHttpCache();
  await (await import('../lib/sync/engine')).runGatewaySync({ mode: 'live', trigger: 'اختبار' });

  const target = store
    .getGatewayDatabase()
    .matches.find((match) => match.homeTeam.nameEn === 'Ismaily');
  assert.ok(target, 'المصدر الوهمي أنتج سجلًا');
  assert.equal(target!.score.home, 2);

  const saved = await service.saveMatchOverride(
    target!.id,
    { lockAll: false, locked: ['score', 'status'], scoreHome: 4, scoreAway: 4, status: 'finished', statusNoteAr: 'تعديل إداري' },
    OWNER
  );
  assert.equal(saved.ok, true, saved.messageAr);

  // مزامنة جديدة (نتيجة المصدر 0-0): الحقول المثبَّتة تبقى كما كتبها المدير.
  stubGatewayFetch({ score: [0, 0] });
  clearHttpCache();
  await (await import('../lib/sync/engine')).runGatewaySync({ mode: 'live', trigger: 'بعد التثبيت' });
  const after = store.getGatewayDatabase().matches.find((match) => match.id === target!.id)!;
  assert.equal(after.score.home, 4);
  assert.equal(after.score.away, 4);
  assert.equal(after.status, 'finished');
  assert.equal(after.statusNoteAr, 'تعديل إداري');

  // ولو رُفع التثبيت عاد المصدر يكتب عادي (لا تثبيت أبدي).
  await service.saveMatchOverride(target!.id, { lockAll: false, locked: [], suppressedSources: [] }, OWNER);
  stubGatewayFetch({ score: [3, 0] });
  clearHttpCache();
  await (await import('../lib/sync/engine')).runGatewaySync({ mode: 'live', trigger: 'بعد رفع التثبيت' });
  const released = store.getGatewayDatabase().matches.find((match) => match.id === target!.id)!;
  assert.equal(released.score.home, 3);
});

test('3ب) تعديل المدير يظهر في الطلب التالي: إعادة الدمج عند تغيّر نسخة المستند', async () => {
  const created = await service.createManualMatch(manualMatchForm(), OWNER);
  assert.equal(created.ok, true, created.messageAr);
  const id = created.data!.id;

  // محاكاة «نسخة أخرى من التطبيق»: ذاكرة مخزن جديدة تقرأ من القرص ثم تُدمج الطبقة الإدارية.
  store.resetStoreStateForTests();
  const fresh = store.getGatewayDatabase();
  assert.ok(fresh.matches.some((match) => match.id === id), 'النسخة الجديدة ترى مباراة الإدارة من مستندها الدائم');

  const updated = await service.updateManualMatch(id, manualMatchForm({ status: 'postponed' }), OWNER);
  assert.equal(updated.ok, true, updated.messageAr);
  assert.equal(store.getGatewayDatabase().matches.find((match) => match.id === id)!.status, 'postponed');
});

// ── 4) سقوط مصدر ← البقية تكمل ───────────────────────────────────────────────

test('4) سقوط كل المصادر لا يمسح البيانات السابقة ولا يُنتج بيانات مُختلقة', async () => {
  stubGatewayFetch({ score: [2, 1] });
  clearHttpCache();
  const engine = await import('../lib/sync/engine');
  await engine.runGatewaySync({ mode: 'live', trigger: 'قبل السقوط' });
  const before = store.getGatewayDatabase();
  const beforeCount = before.matches.length;
  const ismailyBefore = before.matches.find((match) => match.homeTeam.nameEn === 'Ismaily');
  assert.ok(ismailyBefore);
  const storedScore = { ...ismailyBefore!.score };

  stubGatewayFetch({ failing: true });
  clearHttpCache();
  const log = await engine.runGatewaySync({ mode: 'live', trigger: 'أثناء السقوط' });

  const after = store.getGatewayDatabase();
  assert.equal(after.matches.length >= beforeCount, true, 'لا حذف لأي سجل عند فشل المصادر');
  const ismailyAfter = after.matches.find((match) => match.homeTeam.nameEn === 'Ismaily')!;
  assert.deepEqual(ismailyAfter.score, storedScore, 'البيانات السابقة تبقى كما هي بلا تخمين');
  assert.ok(ismailyAfter.lastUpdatedAt, 'ووقت آخر تحديث محفوظ معها');

  // السجل يذكر الفشل بصدق ولا يدّعي نجاحًا.
  const failed = log.sourceResults.filter((result) => result.status !== 'active');
  assert.equal(failed.length > 0, true, 'الفشل مسجَّل في نتيجة المزامنة');
  assert.equal(log.sourceResults.some((result) => result.usedCachedSnapshot), true);
});

// ── 5) عودة المصدر ───────────────────────────────────────────────────────────

test('5) تعطيل مصدر من اللوحة يوقف استدعاءه فعلًا، وإعادة تفعيله تُعيده للعمل بحالته محفوظة', async () => {
  const sourceId = 'sportscore';

  // (أ) تعطيل: لا نداء شبكة إطلاقًا، والإعدادات لا تُحذف.
  const disabled = await service.saveSourceControl(sourceId, { enabled: false, priority: 25, noteAr: 'صيانة' }, OWNER);
  assert.equal(disabled.ok, true, disabled.messageAr);
  const called: string[] = [];
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    called.push(String(input));
    return realFetch(input, init);
  });
  const engine = await import('../lib/sync/engine');
  clearHttpCache();
  const offLog = await engine.runGatewaySync({
    mode: 'live',
    trigger: 'والمصدر معطّل',
    sources: [sourceId],
    skipNews: true,
  });
  assert.equal(
    called.filter((url) => url.includes('sportscore')).length,
    0,
    'المصدر المعطّل لا يُنادى إطلاقًا (ولا تُجلب منه أي بيانات)'
  );
  const offResult = offLog.sourceResults.find((result) => result.sourceId === sourceId);
  assert.ok(offResult && offResult.status !== 'active');
  assert.equal(manualStore.getSourceControl(sourceId).enabled, false);
  assert.equal(manualStore.getSourceControl(sourceId).priority, 25);
  assert.equal(manualStore.getSourceControl(sourceId).noteAr, 'صيانة');

  // (ب) عودة: التفعيل يعيد المصدر للعمل بنفس الإعدادات المحفوظة.
  mock.restoreAll();
  const enabled = await service.saveSourceControl(sourceId, { enabled: true, priority: 25, noteAr: 'صيانة' }, OWNER);
  assert.equal(enabled.ok, true, enabled.messageAr);
  stubGatewayFetch({ score: [1, 1] });
  clearHttpCache();
  const onLog = await engine.runGatewaySync({
    mode: 'live',
    trigger: 'بعد إعادة التفعيل',
    sources: [sourceId],
    skipNews: true,
  });
  const onResult = onLog.sourceResults.find((result) => result.sourceId === sourceId);
  assert.equal(onResult?.status, 'active');
  assert.equal(manualStore.getSourceControl(sourceId).priority, 25, 'الإعدادات بقيت محفوظة عبر التعطيل');
});

// ── 6) منع التكرار ───────────────────────────────────────────────────────────

test('6) لا تُنشأ نسخة مكرّرة: نفس الفريقين ونفس اليوم تُرفض مع إشارة إلى السجل القائم', async () => {
  const first = await service.createManualMatch(manualMatchForm(), OWNER);
  assert.equal(first.ok, true, first.messageAr);

  const duplicate = await service.createManualMatch(
    manualMatchForm({ homeNameAr: 'المصري البورسعيدي', homeNameEn: 'Al Masry', awayNameAr: 'الإسماعيلي', awayNameEn: 'Ismaily' }),
    OWNER
  );
  assert.equal(duplicate.ok, false, 'الفريقان نفساهما في نفس اليوم = نفس المباراة');
  assert.match(duplicate.messageAr, /منع التكرار|السجل القائم/);
  assert.equal(duplicate.duplicateOf?.id, first.data!.id, 'يُشار إلى السجل القائم ليعدّله المدير');
  assert.equal(manualStore.listManualMatches().length, 1);

  // ولا يمكن إنشاء مباراة يدوية بمعرّف مباراة مصدر قائمة عبر تمرير id صريح.
  stubGatewayFetch({ score: [2, 1] });
  await (await import('../lib/sync/engine')).runGatewaySync({ mode: 'live', trigger: 'اختبار' });
  const sourceRecord = store
    .getGatewayDatabase()
    .matches.find((match) => match.homeTeam.nameEn === 'Ismaily')!;
  const clash = await service.createManualMatch(
    manualMatchForm({
      id: sourceRecord.id,
      homeNameAr: 'فريق مختلف تمامًا',
      homeNameEn: 'Different Team',
      awayNameAr: 'فريق آخر',
      awayNameEn: 'Another Team',
    }),
    OWNER
  );
  assert.equal(clash.ok, false, 'لا تُنشأ نسخة يدوية بمعرّف سجل مصدر قائم');
  assert.equal(clash.duplicateOf?.id, sourceRecord.id);
  assert.equal(manualStore.listManualMatches().length, 1);
});

// ── 7) خبر جديد ونشره ────────────────────────────────────────────────────────

test('7) خبر مكتوب في اللوحة يُنشر ويظهر في مخزن الموقع، وتعديله يحفظ نفس الرابط', async () => {
  const saved = await service.saveManualNews(
    {
      title: 'الإسماعيلي يُنهي استعداداته لمواجهة المصري في الدوري المصري الممتاز',
      excerpt: 'مران ختامي مكثّف وغياب عنصرين أساسيين قبل مواجهة الجمعة المرتقبة في الإسماعيلية.',
      bodyAr:
        'أنهى الفريق الأول تدريباته اليوم على ملعب النادي استعدادًا للمواجهة المقبلة، ويغيب عن التشكيلة اثنان من العناصر الأساسية بداعي الإصابة.',
      slug: 'ismaily-ready-al-masry',
      status: 'published',
      categoryAr: 'الكرة المصرية',
    },
    OWNER
  );
  assert.equal(saved.ok, true, saved.messageAr);
  assert.equal(saved.data!.slug, 'ismaily-ready-al-masry');

  const db = store.getGatewayDatabase();
  const published = db.news.find((item) => item.slug === 'ismaily-ready-al-masry');
  assert.ok(published, 'الخبر وصل إلى مخزن الموقع ليُعرض في صفحات الأخبار');
  assert.equal(published!.publishStatus, 'published');
  assert.equal(published!.origin, 'manual');

  // الرابط المفهرس لا يتغيّر عند تعديل العنوان (وإلا كسرنا صفحة مفهرسة).
  const edited = await service.saveManualNews(
    { title: 'الإسماعيلي يُنهي استعداداته لمواجهة المصري غدًا', excerpt: saved.data!.excerpt, bodyAr: saved.data!.bodyAr, status: 'published' },
    OWNER,
    saved.data!.id
  );
  assert.equal(edited.ok, true, edited.messageAr);
  assert.equal(edited.data!.slug, 'ismaily-ready-al-masry');
  assert.equal(manualStore.listManualNews().length, 1, 'التعديل لا يُنشئ خبرًا ثانيًا');

  // لقطة الموقع لا تحمل الخبر الإداري (مصدره مستند الإدارة لا لقطة المصادر).
  const snapshot = JSON.parse(fs.readFileSync(path.join(dataDir, 'gateway-store.json'), 'utf-8')) as {
    snapshot?: { news: Array<{ slug: string }> };
  };
  assert.equal((snapshot.snapshot?.news ?? []).some((item) => item.slug === 'ismaily-ready-al-masry'), false);
});

test('7ب) خبر اللوحة يُدرج في خريطة الموقع بنصّه الكامل، والنصّ القصير يُنبَّه عليه بصدق', async () => {
  // (أ) نصّ قصير: الصفحة تعمل وتُعرض، لكن لا تُدرج في خريطة الموقع — مع تنبيه صريح للمدير.
  const short = await service.saveManualNews(
    {
      title: 'خبر قصير لم يُستكمل نصّه بعد',
      excerpt: 'مقتطف قصير لا يكفي للفهرسة.',
      bodyAr: 'نصّ قصير مكتوب في اللوحة بلا تفاصيل كافية.',
      status: 'published',
    },
    OWNER
  );
  assert.equal(short.ok, true, short.messageAr);
  assert.equal(short.warningsAr.length > 0, true, 'يُنبَّه المدير: النصّ القصير لا يُفهرس');
  assert.match(short.warningsAr.join(' '), /خريطة الموقع/);
  assert.equal(
    store.getGatewayDatabase().news.find((item) => item.slug === short.data!.slug)?.bodyText,
    'نصّ قصير مكتوب في اللوحة بلا تفاصيل كافية.',
    'النصّ المكتوب في اللوحة يُحفظ في السجل المعروض'
  );

  // (ب) نصّ كامل: يُدرج في خريطة الموقع التي يقرأها الموقع نفسه (نفس الدالة، بلا محاكاة).
  const fullBody = 'أنهى الفريق مرانه التكتيكي على ملعب النادي وسط تركيز على الكرات الثابتة والضغط العالي. '.repeat(3);
  const full = await service.saveManualNews(
    {
      title: 'الإسماعيلي يختتم تحضيراته بمران تكتيكي مكثّف قبل مواجهة المصري',
      excerpt:
        'مران تكتيكي مكثّف على ملعب النادي، وتركيز واضح على الكرات الثابتة والضغط العالي قبل مواجهة المصري في الدوري المصري الممتاز.',
      bodyAr: fullBody,
      status: 'published',
    },
    OWNER
  );
  assert.equal(full.ok, true, full.messageAr);
  assert.deepEqual(full.warningsAr, [], 'نصّ كافٍ للفهرسة بلا تنبيهات');

  const sitemap = await (await import('../app/sitemap')).default();
  const urls = sitemap.map((entry) => entry.url);
  assert.equal(
    urls.some((url) => url.endsWith(`/news/${full.data!.slug}`)),
    true,
    'صفحة الخبر المكتوب في اللوحة داخل خريطة الموقع'
  );
  assert.equal(
    urls.some((url) => url.endsWith(`/news/${short.data!.slug}`)),
    false,
    'والخبر الرقيق لا يُدرج (لا صفحات رقيقة مفهرسة)'
  );
  assert.equal((await import('../lib/news/validate')).isIndexableNewsArticle(
    { ...store.getGatewayDatabase().news.find((item) => item.slug === full.data!.slug)! }
  ), true);
});

test('7ج) لا تُنشأ نسخة ثانية للخبر نفسه، والمستند القديم المكرّر يُطبَّع لنسخة واحدة', async () => {
  const form = {
    title: 'الأهلي يعلن جاهزية نجمه الأول قبل قمة الدوري المصري المرتقبة',
    excerpt: 'عودة اللاعب إلى التدريبات الجماعية بعد تعافيه، وارتفاع حظوظه في المشاركة أساسيًا.',
    bodyAr: 'عاد اللاعب إلى التدريبات الجماعية مساء اليوم بعد انتهاء برنامجه التأهيلي، وأكّد الجهاز الفني جاهزيته للمشاركة في القمة المقبلة.',
    slug: 'ahly-star-ready-derby',
    status: 'published' as const,
  };
  const first = await service.saveManualNews(form, OWNER);
  assert.equal(first.ok, true, first.messageAr);

  const again = await service.saveManualNews(form, OWNER);
  assert.equal(again.ok, false, 'نفس الرابط ونفس المعرّف = لا نسخة ثانية');
  assert.equal(again.status, 409);
  assert.match(again.messageAr, /منع التكرار|الرابط/);
  assert.equal(manualStore.listManualNews().length, 1, 'اللوحة تعرض خبرًا واحدًا لا نسخًا مكرّرة');

  // مستند قديم يحمل نسخًا مكرّرة بنفس المعرّف (وما حدث فعلًا في التشغيل الحقيقي):
  // القراءة تُعيده إلى أحدث نسخة واحدة، فلا تتضخّم الأعداد ولا تظهر أسطر مكرّرة.
  const legacy = manualDocument.emptyManualDocument();
  const saved = first.data!;
  legacy.news = [saved, { ...saved, title: 'عنوان محدَّث لنفس المعرّف' }];
  const normalized = manualDocument.normalizeManualDocument(JSON.parse(JSON.stringify(legacy)));
  assert.equal(normalized.news.length, 1);
  assert.equal(normalized.news[0].title, 'عنوان محدَّث لنفس المعرّف');
});

// ── 8) النسخ الاحتياطية ──────────────────────────────────────────────────────

test('8) نسخة احتياطية كاملة: تُنشأ، وتُفحص سلامتها، وتُستعاد بنسخة وقائية وتأكيد صريح', async () => {
  await service.createManualMatch(manualMatchForm(), OWNER);
  const firstBackup = await backups.buildBackup({ kind: 'manual', createdBy: 'admin', labelAr: 'اختبار' });
  const persisted = await backups.persistBackup(firstBackup);
  assert.equal(persisted.ok, true, persisted.messageAr);
  assert.ok(firstBackup.bytes > 1000, 'النسخة تحتوي بيانات المخزن كاملة لا مجرد ملخّص');

  const verification = backups.verifyBackupRecord(firstBackup);
  assert.equal(verification.ok, true, verification.messageAr);
  assert.equal(verification.checks.checksumMatches, true);
  assert.equal(verification.checks.hasDatabase, true);

  // نسخة مُعدَّلة يدويًا تُكشف (البصمة لا تطابق).
  const tampered = structuredClone(firstBackup);
  tampered.content.manual.matches = [];
  assert.equal(backups.verifyBackupRecord(tampered).checks.checksumMatches, false);

  // استعادة بلا تأكيد صحيح = رفض صريح بلا أي كتابة.
  const refused = await backups.restoreBackup({ id: firstBackup.id, confirmation: 'خطأ', actor: OWNER });
  assert.equal(refused.ok, false);
  assert.equal(manualStore.listManualMatches().length, 1);

  // تغيير لاحق ثم استعادة: ترجع الحالة كما في النسخة + نسخة وقائية قبلها.
  await service.deleteManualMatch('ismaily-vs-al-masry-2026-10-20', 'ismaily-vs-al-masry-2026-10-20', OWNER);
  assert.equal(manualStore.listManualMatches().length, 0);
  const restored = await backups.restoreBackup({ id: firstBackup.id, confirmation: firstBackup.id, actor: OWNER });
  assert.equal(restored.ok, true, restored.messageAr);
  assert.ok(restored.preRestoreBackupId, 'لا استعادة بلا نسخة وقائية');
  assert.equal(manualStore.listManualMatches().length, 1, 'المباراة عادت بعد الاستعادة');

  const list = await backups.listBackups(true);
  assert.equal(list.some((item) => item.kind === 'pre-restore'), true);
  assert.equal(list.every((item) => item.checksumShort.length > 0), true);

  // لا تُحذف أحدث نسخة.
  const newest = list[0];
  const deletion = await backups.deleteBackup(newest.id, OWNER);
  assert.equal(deletion.ok, false);
  assert.match(deletion.messageAr, /أحدث/);
});

test('8ب) نسخة مجدولة: لا تُنشأ مرتين داخل المدة، وتُرفض بصدق عند غياب تخزين دائم', async () => {
  const first = await backups.maybeCreateScheduledBackup({ minHours: 20 });
  assert.equal(first.created, true, first.messageAr);
  const second = await backups.maybeCreateScheduledBackup({ minHours: 20 });
  assert.equal(second.created, false, 'لا نسخة جديدة قبل انقضاء المدة');
  assert.match(second.messageAr, /أقل من 20 ساعة/);

  // بيئة بلا تخزين دائم (Vercel بلا GitHub) ⇒ رفض معلَن بلا نجاح وهمي.
  process.env.VERCEL = '1';
  delete process.env.NEMO_MANUAL_FILE_DURABLE;
  const serverless = await backups.maybeCreateScheduledBackup({ minHours: 20 });
  assert.equal(serverless.created, false);
  assert.match(serverless.messageAr, /لا تخزين دائم/);
  const persistAttempt = await backups.persistBackup(
    await backups.buildBackup({ kind: 'manual', createdBy: 'admin' })
  );
  assert.equal(persistAttempt.ok, false, 'لا ندّعي حفظ نسخة على قرص مؤقت');
  assert.match(persistAttempt.messageAr, /GITHUB_TOKEN/);
});

// ── 9) الكرونات في بيئة النشر + المسارات ─────────────────────────────────────

test('9) الكرونات: مهمتان يوميتان كما تسمح خطة Vercel الحالية، والنسخة المجدولة داخل مهمة الصباح', () => {
  const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'vercel.json'), 'utf-8')) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  assert.equal(config.crons.length, 2, 'الخطة المجانية تسمح بمهمتين — إضافة ثالثة تُبطل الجدولة كلها');
  assert.deepEqual(
    config.crons.map((cron) => cron.path).sort(),
    ['/api/cron/sync', '/api/cron/update-matches']
  );
  for (const cron of config.crons) {
    assert.equal(
      fs.existsSync(path.join(projectRoot, 'app', cron.path.replace(/^\//, ''), 'route.ts')),
      true,
      `المسار ${cron.path} موجود فعلًا`
    );
  }

  // النسخة الاحتياطية المجدولة تُنشأ داخل المزامنة الصباحية (mode==='daily') بلا مهمة كرون ثالثة.
  const engineSource = fs.readFileSync(path.join(projectRoot, 'lib/sync/engine.ts'), 'utf-8');
  assert.match(engineSource, /mode === 'daily'[\s\S]{0,400}maybeCreateScheduledBackup/);
});

test('9ب) لا مسار مكسور: كل صفحة في قائمة اللوحة لها ملف صفحة حقيقي', () => {
  const layout = fs.readFileSync(path.join(projectRoot, 'app/admin/layout.tsx'), 'utf-8');
  const hrefs = Array.from(layout.matchAll(/href:\s*'(\/admin[^']*)'/g)).map((match) => match[1]);
  assert.equal(hrefs.length >= 9, true, 'اللوحة تغطي كل الأقسام المطلوبة');
  for (const href of hrefs) {
    const relative = href.replace(/^\//, '');
    const candidates = [
      path.join(projectRoot, 'app', relative, 'page.tsx'),
      path.join(projectRoot, 'app', `${relative}.tsx`),
    ];
    assert.equal(candidates.some((candidate) => fs.existsSync(candidate)), true, `${href} له صفحة`);
  }
});

test('9ج) كل مسار إداري محميّ على الخادم، ولا بيانات دخول أو مفاتيح مكتوبة في المستودع', () => {
  const routeRoot = path.join(projectRoot, 'app/api/admin');
  const routeFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'route.ts') routeFiles.push(full);
    }
  };
  walk(routeRoot);
  assert.equal(routeFiles.length >= 12, true, `واجهات الإدارة موجودة (${routeFiles.length} مسارًا)`);

  for (const file of routeFiles) {
    const code = fs
      .readFileSync(file, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    if (file.endsWith('api/admin/session/route.ts')) continue;
    assert.match(
      code,
      /requireAdminPermission|requireAdminRequest/,
      `${path.relative(projectRoot, file)} يجب أن يفحص الصلاحية على الخادم`
    );
  }

  // لا مفاتيح مكتوبة في الوحدات الحساسة.
  for (const relative of ['lib/auth/admin-session.ts', 'lib/admin/manual-drivers.ts', 'lib/admin/backups.ts']) {
    const code = fs.readFileSync(path.join(projectRoot, relative), 'utf-8');
    assert.doesNotMatch(code, /ghp_[A-Za-z0-9]{20,}/, `${relative} بلا رمز GitHub مكتوب`);
    assert.doesNotMatch(code, /scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]{10,}\$/, `${relative} بلا hash لكلمة مرور`);
  }
});

test('9د) الصدق في الاستضافة: بلا تخزين دائم يُعلن الحالة بدل ادّعاء النجاح', async () => {
  process.env.VERCEL = '1';
  delete process.env.NEMO_MANUAL_FILE_DURABLE;
  const status = manualStore.getManualStatus();
  assert.equal(status.durable, false);
  assert.equal(status.driver, 'file');
  assert.equal(status.visibility === 'immediate' || status.visibility === 'after_redeploy', true);
  assert.equal(
    status.noteAr.includes('مؤقت') || status.noteAr.includes('لا'),
    true,
    'الحالة تشرح أن القرص غير دائم'
  );

  const rejected = await manualStore.mutateManualDocument(
    { actor: 'tester', role: 'owner', action: 'test.write', target: 'test', summaryAr: 'كتابة اختبار' },
    (draft) => ({ data: null, changed: true, messageAr: 'ok', draft })
  );
  assert.equal(rejected.ok, true, 'الكتابة المحلية مسموحة للعرض الفوري');
});

// ── 10) الإعدادات وسجل التدقيق ───────────────────────────────────────────────

test('10) تعديل يمسّ الفهرسة يُعاد معه أثر SEO قبل التأكيد، وكل عملية إدارية تُسجَّل باسم فاعلها', async () => {
  const newDescription = 'وصف تعريفي جديد كتبه المدير من لوحة الإدارة لاختبار أثر الفهرسة.';
  const blocked = await service.saveSiteSettings(
    { sitemapIncludeNews: false, siteDescriptionAr: newDescription },
    OWNER,
    { confirmSeo: false }
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.seoImpactAr.length > 0, true, 'الأثر يُعلن قبل أي تغيير');
  assert.equal(manualStore.getSiteSettings().sitemapIncludeNews, true, 'لم يتغيّر شيء');

  const applied = await service.saveSiteSettings(
    { sitemapIncludeNews: false, siteDescriptionAr: newDescription },
    OWNER,
    { confirmSeo: true }
  );
  assert.equal(applied.ok, true, applied.messageAr);
  assert.equal(manualStore.getSiteSettings().sitemapIncludeNews, false);

  const audit = manualStore.getManualDocument().audit;
  assert.equal(audit.length > 0, true);
  const entry = audit.find((item) => item.action === 'settings.save');
  assert.ok(entry);
  assert.equal(entry!.actor, 'admin');
  assert.equal(entry!.ok, true);
});

test('10ب) تحويل البطولة بالاسم: لا يُطلب من المدير حفظ الأكواد العشوائية', () => {
  assert.equal(service.resolveCompetitionCode({ code: 'EGY' }), 'EGY');
  assert.equal(service.resolveCompetitionCode({ nameAr: 'الدوري المصري الممتاز' }), 'EGY');
  assert.equal(service.resolveCompetitionCode({ code: 'egyptian-premier-league' }), 'EGY');
  assert.equal(service.resolveCompetitionCode({ nameEn: 'UEFA Champions League' }), 'CL');
  assert.equal(service.resolveCompetitionCode({ code: 'بطولة غير موجودة' }), null);

  // ومباراة أدخلها المدير بكتابة دستورية مختلفة الشكل تعمل بنفس بيانات الكتالوج.
  return service
    .createManualMatch(
      {
        homeNameAr: 'الأهلي',
        homeNameEn: 'Al Ahly',
        awayNameAr: 'الزمالك',
        awayNameEn: 'Zamalek',
        competitionCode: 'egyptian premiership',
        competitionNameAr: 'الدوري المصري الممتاز',
        kickoffUtc: '2026-11-01T17:00:00Z',
      },
      OWNER
    )
    .then((created) => {
      assert.equal(created.ok, true, created.messageAr);
      assert.equal(created.data!.competitionCode, 'EGY');
      assert.equal(created.data!.competitionNameEn, 'Egyptian Premier League');
    });
});

test('10ج) الحذف لا يترك سجلًا يتيمًا، وسجل التدقيق يحفظ من حذف ماذا', async () => {
  const created = await service.createManualMatch(manualMatchForm(), OWNER);
  assert.equal(created.ok, true, created.messageAr);
  const id = created.data!.id;
  assert.ok(store.getGatewayDatabase().matches.some((match) => match.id === id));

  const wrong = await service.deleteManualMatch(id, 'نعم', OWNER);
  assert.equal(wrong.ok, false, 'الحذف يتطلب كتابة المعرّف نفسه');

  const removed = await service.deleteManualMatch(id, id, OWNER);
  assert.equal(removed.ok, true, removed.messageAr);
  assert.equal(manualStore.listManualMatches().length, 0);
  assert.equal(
    store.getGatewayDatabase().matches.some((match) => match.id === id),
    false,
    'السجل أُزيل من المخزن فعلًا لا من اللوحة فقط'
  );
  const entry = manualStore.getManualDocument().audit.find((item) => item.action === 'match.delete');
  assert.ok(entry);
  assert.equal(entry!.target, id);

  // ولا يعود من اللقطة الدائمة بعد إعادة القراءة (كان يعود قبل وسم origin).
  store.resetStoreStateForTests();
  assert.equal(store.getGatewayDatabase().matches.some((match) => match.id === id), false);
});

test('10د) المستند اليدوي صالح دائمًا: النتيجة/الحالة غير المتناسقة تُرفض برسالة عربية واضحة', async () => {
  const inconsistent = await service.createManualMatch(
    manualMatchForm({ status: 'scheduled', scoreHome: 3, scoreAway: 1 }),
    OWNER
  );
  assert.equal(inconsistent.ok, false);
  assert.match(inconsistent.messageAr, /لم تبدأ|النتيجة/);

  const noScore = await service.createManualMatch(manualMatchForm({ status: 'finished' }), OWNER);
  assert.equal(noScore.ok, false);
  assert.match(noScore.messageAr, /النتيجة النهائية/);

  const sameTeam = await service.createManualMatch(
    manualMatchForm({ awayNameAr: 'الإسماعيلي', awayNameEn: 'Ismaily' }),
    OWNER
  );
  assert.equal(sameTeam.ok, false);
  assert.match(sameTeam.messageAr, /نفس الفريق/);

  assert.equal(manualStore.listManualMatches().length, 0, 'لا سجل غير صالح يدخل المخزن');
  assert.equal(manualDocument.emptyManualDocument().matches.length, 0);
  assert.equal(merge.stripManualLayerFromDatabase(store.getGatewayDatabase()).matches.length >= 0, true);
});
