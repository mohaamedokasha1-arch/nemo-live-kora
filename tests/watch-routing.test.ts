import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import MatchCard from '../components/MatchCard';
import WatchStreamCta from '../components/WatchStreamCta';
import WatchStreamBlock from '../components/WatchStreamBlock';
import { MATCH_CATALOG } from '../data/matches';
import { getGatewayDatabase } from '../lib/db/store';
import { buildMatchLandingPath } from '../lib/matches/match-links';
import { resolveAllMatchViews } from '../lib/matches/match-catalog';
import {
  NEMO_WATCH_BASE_URL,
  NEMO_WATCH_ID_PARAM,
  NEMO_WATCH_MODE,
  buildPlatformWatchUrl,
  resolveWatchDestination,
  resolveWatchDestinationForMatchId,
  resolveWatchDestinationForRecord,
  resolveWatchDestinationForView,
  resolveWatchMatchId,
  resolveWatchMatchIdForRecord,
} from '../lib/nemo-watch';
import { scanForbiddenPatterns, stripComments } from './helpers/source-scan';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  اختبارات نظام التوجيه الديناميكي الموحّد (Global Dynamic Navigation System)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  تضمن هذه الاختبارات أن كل مباراة على البوابة — بلا استثناء، ومن أي مصدر، والآن
 *  ومستقبلًا — لها مسار توجيه كامل:
 *    بطاقة ← /matches/[id]  ←  زر المشاهدة الأحمر  ←  المنصة الرئيسية في نافذة جديدة
 *  مع مساحتين إعلانيتين حول الزر.
 */

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf-8');

/** النص المطلوب حرفيًا في الزر الرئيسي. */
const REQUIRED_CTA_TEXT = '🔴 اضغط هنا لمشاهدة البث المباشر للمباراة';

/* ────────────────────────────────────────────────────────────────────────────
 *  1) بناء الرابط الديناميكي
 * ──────────────────────────────────────────────────────────────────────────── */

test('1) صفحة المشاهدة الموحّدة: العنوان الصافي، وصيغة المعرّف تبقى صالحة للنمط الاختياري', () => {
  const url = buildPlatformWatchUrl('zamalek-vs-al-ahly-2026-10-11');
  assert.ok(
    url.startsWith(`${NEMO_WATCH_BASE_URL}?`) || url.startsWith(`${NEMO_WATCH_BASE_URL}&`),
    `الرابط لا يبدأ من الوجهة المعتمدة: ${url}`
  );
  assert.ok(url.includes(`${NEMO_WATCH_ID_PARAM}=`), `معامل المعرّف مفقود: ${url}`);
  assert.ok(url.includes('zamalek-vs-al-ahly-2026-10-11'), url);

  // الوجهة الافتراضية هي بوابة المشاهدة على منصة NEMO Sports
  assert.equal(NEMO_WATCH_BASE_URL, 'https://nemo-sports.vercel.app/watch');

  // معرّف يحتوي رموزًا خاصة يجب تهريبه ولا يكسر الرابط
  const escaped = buildPlatformWatchUrl('a&b=c d?');
  assert.ok(!escaped.slice(NEMO_WATCH_BASE_URL.length + 1).includes('&b='), 'المعرّف غير مُهرَّب');
  assert.equal(new URL(escaped).searchParams.get(NEMO_WATCH_ID_PARAM), 'a&b=c d?');

  // لو احتوى الرابط الأساسي معاملات مسبقًا يُستخدم & لا ?
  assert.ok(!url.includes('??'), url);
});

test('2) الافتراضي: صفحة المشاهدة الصافية لكل مباراة — والزائر يختار المباراة بنفسه', () => {
  const verifiedPage = 'https://nemo-sports.vercel.app/matches/zamalek-sc-vs-al-ahly-fc#live-stream';

  // الافتراضي (نظام الموقع الدائم): العنوان الصافي نفسه لكل مباراة، بلا معرّف ولا معامل.
  for (const input of [
    { matchId: 'm1' },
    { matchId: 'm1', verifiedMatchPageUrl: verifiedPage },
    { matchId: 'anything', verifiedMatchPageUrl: null },
  ]) {
    const destination = resolveWatchDestination(input);
    assert.equal(destination.url, NEMO_WATCH_BASE_URL);
    assert.equal(destination.url, 'https://nemo-sports.vercel.app/watch');
    // لا معامل استعلام ولا مرساة — فلا نوهم الزائر بأن مباراة محددة ستُفتح
    assert.equal(destination.url.includes('?'), false, destination.url);
    assert.equal(destination.url.includes('#'), false, destination.url);
    assert.equal(destination.kind, 'platform_watch');
    assert.equal(destination.opensExactMatch, false);
    assert.equal(destination.matchId, input.matchId);
  }

  // ومع ذلك لا تُفقد صفحة المباراة المطابقة المُتحقَّق منها: تبقى كرابط ثانوي هادئ
  assert.equal(
    resolveWatchDestination({ matchId: 'm1', verifiedMatchPageUrl: verifiedPage }).exactMatchUrl,
    verifiedPage
  );
  assert.equal(resolveWatchDestination({ matchId: 'm1' }).exactMatchUrl, null);

  // الأنماط الاختيارية (بيئة فقط، بلا كود): ?id= ثم exact-first
  const idParam = resolveWatchDestination({ matchId: 'm1', mode: 'id-param' });
  assert.equal(idParam.url, buildPlatformWatchUrl('m1'));
  assert.equal(idParam.opensExactMatch, false);

  const exactFirst = resolveWatchDestination({
    matchId: 'm1',
    verifiedMatchPageUrl: verifiedPage,
    mode: 'exact-first',
  });
  assert.equal(exactFirst.url, verifiedPage);
  assert.equal(exactFirst.kind, 'verified_match_page');
  assert.equal(exactFirst.opensExactMatch, true);
  assert.equal(
    resolveWatchDestination({ matchId: 'm1', verifiedMatchPageUrl: null, mode: 'exact-first' }).kind,
    'platform_watch'
  );

  // قيمة غير صالحة لا تُستخدم كورل (لا روابط مكسورة ولا رابط ثانوي معطوب)
  const invalid = resolveWatchDestination({ matchId: 'm1', verifiedMatchPageUrl: 'not-a-url', mode: 'exact-first' });
  assert.equal(invalid.kind, 'platform_watch');
  assert.equal(invalid.exactMatchUrl, null);
  assert.match(invalid.url, /^https:\/\//);

  // النمط الافتراضي معلن ويأتي من البيئة بقيمة gateway
  assert.equal(NEMO_WATCH_MODE, 'gateway');
});

test('3) سلسلة اختيار معرّف المباراة تعمل لكل أنواع السجلات', () => {
  const [first] = resolveAllMatchViews();
  assert.ok(first);
  const resolvedId = resolveWatchMatchId(first!);
  assert.ok(resolvedId.length > 0);

  // لكل مباراة في الكتالوج: معرّف صالح ورابط صالح (لا فراغ ولا رابط مكسور)
  for (const view of resolveAllMatchViews()) {
    const id = resolveWatchMatchId(view);
    const destination = resolveWatchDestinationForView(view);
    assert.ok(id.trim().length > 0, `${view.entry.id}: معرّف فارغ`);
    assert.ok(
      /^https:\/\/[^\s]+$/.test(destination.url),
      `${view.entry.id}: رابط غير صالح — ${destination.url}`
    );
    // النظام الموحّد: كل مباراة — بلا استثناء — تفتح نفس صفحة المشاهدة، والزائر يختار منها
    assert.equal(destination.kind, 'platform_watch', `${view.entry.id}: وجهة غير موحّدة`);
    assert.equal(destination.url, NEMO_WATCH_BASE_URL, `${view.entry.id}: وجهة مختلفة عن البقية`);
    // الوجهة الموحّدة لا تخدع الزائر بأنها تفتح المباراة نفسها
    assert.equal(destination.opensExactMatch, false, `${view.entry.id}: ادعاء فتح المباراة نفسها`);
    // المعرّف يبقى محسوبًا ومتاحًا (يُستخدم في النمط الاختياري ?id= وفي ملفات العرض)
    assert.ok(id.trim().length > 0, `${view.entry.id}: معرّف فارغ`);
  }

  // سلسلة السجلات الخام (خارج الكتالوج): معرّفات المصادر تسبق المعرّف الداخلي
  assert.equal(
    resolveWatchMatchIdForRecord({
      id: 'match-api-football-1612251',
      externalIds: { sportscoreSlug: 'slug-x', apiFootballFixtureId: '1612251' },
    }),
    'slug-x'
  );
  assert.equal(
    resolveWatchMatchIdForRecord({
      id: 'match-api-football-1612251',
      externalIds: { apiFootballFixtureId: '1612251' },
    }),
    '1612251'
  );
  assert.equal(
    resolveWatchMatchIdForRecord({ id: 'match-tsdb-1', externalIds: { thesportsdbEventId: '2561122' } }),
    '2561122'
  );
  // الملاذ الأخير: معرّف السجل الداخلي (لا مباراة بلا معرّف)
  assert.equal(resolveWatchMatchIdForRecord({ id: 'match-store-only', externalIds: null }), 'match-store-only');
  assert.equal(resolveWatchMatchIdForRecord({ id: 'match-store-only' }), 'match-store-only');
  // القيم الفارغة أو المسافات لا تُختار
  assert.equal(
    resolveWatchMatchIdForRecord({ id: 'fallback', externalIds: { sportscoreSlug: '   ' } }),
    'fallback'
  );
});

/* ────────────────────────────────────────────────────────────────────────────
 *  2) نص الزر وتفاصيل التحويل
 * ──────────────────────────────────────────────────────────────────────────── */

test('4) نص الزر المطلوب حرفيًا + فتح في نافذة جديدة بخصائص أمان', () => {
  const destination = resolveWatchDestination({ matchId: 'x' });
  const html = renderToStaticMarkup(WatchStreamCta({ destination }));

  assert.ok(html.includes(REQUIRED_CTA_TEXT), 'نص الزر لا يطابق المطلوب حرفيًا');

  // target="_blank" مطلوب + rel كاملة تمنع وصول النافذة الجديدة إلى window.opener
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);

  // الرابط نفسه هو وجهة المشاهدة المحسوبة
  assert.ok(html.includes(`href="${destination.url}"`) || html.includes(`href="${destination.url.replace(/&/g, '&amp;')}"`));

  // وسم إمكانية الوصول + الملاحظة الصادقة
  assert.match(html, /aria-label="/);
  assert.ok(html.includes(destination.noteAr), 'الملاحظة الصادقة مفقودة');
});

/* ────────────────────────────────────────────────────────────────────────────
 *  3) المساحات الإعلانية فوق وتحت الزر
 * ──────────────────────────────────────────────────────────────────────────── */

test('5) الكتلة الموحّدة تضع مساحة إعلانية فوق الزر وأخرى تحته', () => {
  const source = stripComments(read('components/WatchStreamBlock.tsx'));
  const ctaIndex = source.indexOf('<WatchStreamCta');
  assert.ok(ctaIndex > 0, 'زر المشاهدة مفقود من الكتلة');

  const adIndexes = [...source.matchAll(/<AdSlot/g)].map((match) => match.index ?? -1);
  assert.equal(adIndexes.length, 2, `المتوقع مساحتان إعلانيتان، وُجد ${adIndexes.length}`);
  assert.ok(adIndexes[0] < ctaIndex, 'لا توجد مساحة إعلانية فوق الزر');
  assert.ok(adIndexes[1] > ctaIndex, 'لا توجد مساحة إعلانية تحت الزر');

  // التشغيل الفعلي: بلا إعلانات مضبوطة لا يُرسم أي صندوق فارغ — والزر ورابطه حاضران
  const destination = resolveWatchDestination({ matchId: 'x' });
  const html = renderToStaticMarkup(WatchStreamBlock({ destination }));
  assert.ok(html.includes('kl-watch-cta'), 'الزر اختفى عند غياب الإعلانات');
  assert.ok(html.includes('kl-watch-btn'), 'زر المشاهدة الأحمر مفقود');
  assert.ok(html.includes(destination.url), 'رابط الوجهة مفقود');
  assert.ok(!html.includes('data-ad-configured'), 'صندوق إعلاني فارغ ظهر للزائر');
  assert.ok(!/min-height/.test(html), 'مساحة محجوزة بلا إعلان ظهرت للزائر');
});

test('6) كل بطاقة مباراة (من أي مصدر) قابلة للنقر وتقود إلى /matches/[id]', () => {
  const db = getGatewayDatabase();
  assert.ok(db.matches.length > 0);
  const catalogIds = new Set(MATCH_CATALOG.map((entry) => entry.id));

  // نفحص مجموعة متنوعة: من الكتالوج، ومن المخزن، ومنتهية، وقادمة، وبلا رابط موثّق
  const samples = db.matches.slice(0, 12);
  assert.ok(samples.length >= 5, 'المخزن لا يحتوي عينات كافية');

  for (const match of samples) {
    const html = renderToStaticMarkup(MatchCard({ match }));
    // البطاقة تبدأ بوسم رابط دائمًا (لا <article> غير قابل للنقر)
    assert.match(html, /^<a /, `${match.id}: البطاقة ليست رابطًا`);
    // ولا تفتح المنصة مباشرة من البطاقة
    assert.ok(!html.includes('href="https://nemo-sports'), `${match.id}: رابط خارجي مباشر من البطاقة`);
    // والوجهة مسار تفاصيل داخلي صالح
    // وصف الرابط يصف الفعل والوجهة (لا حالة البث) — لأن البطاقة تنقل إلى صفحة المباراة
    const aria = /aria-label="([^"]+)"/.exec(html)?.[1] ?? '';
    assert.ok(
      aria.startsWith('تفاصيل المباراة والمشاهدة المباشرة —'),
      `${match.id}: وصف الرابط لا يصف الوجهة — ${aria}`
    );

    const href = /href="([^"]+)"/.exec(html)?.[1] ?? '';
    assert.ok(href.startsWith('/matches/'), `${match.id}: وجهة غير متوقعة ${href}`);
    const targetId = decodeURIComponent(href.replace('/matches/', ''));
    assert.ok(
      catalogIds.has(targetId) || targetId === match.id,
      `${match.id}: المسار ${href} لا يطابق الكتالوج ولا معرّف السجل`
    );
  }
});

test('7) صفحة المشاهدة الداخلية تحمل كتلة المشاهدة الموحّدة لكل مباراة', () => {
  const live = stripComments(read('components/LiveBroadcastView.tsx'));

  // الكتلة الموحّدة (إعلان ← زر ← إعلان) موجودة في الصفحة
  assert.match(live, /<WatchStreamBlock\s+destination=\{destination\}\s*\/>/);
  // والوجهة تُحسب من المحرّك المركزي لا يدويًا
  assert.match(live, /resolveWatchDestinationForView\(view\)/);
  // ولا يوجد عنوان المنصة مكتوبًا يدويًا في هذه الطبقة
  assert.ok(!live.includes('nemo-sports.vercel.app'), 'عنوان المنصة مكتوب يدويًا في صفحة البث');
});

test('8) صفحة تفاصيل السجل الخام (خارج الكتالوج) ليست استثناءً', () => {
  const source = stripComments(read('components/SourceMatchDetails.tsx'));

  assert.match(source, /<WatchStreamBlock\s+destination=\{destination\}\s*\/>/);
  assert.match(source, /resolveWatchDestinationForRecord\(match\)/);
  // يمرّر السجل كاملًا للمحرّك المركزي (لا يبني الوجهة بنفسه ولا يفحص الرابط يدويًا)
  assert.ok(!source.includes('nemo-sports.vercel.app'), 'عنوان المنصة مكتوب يدويًا في صفحة السجل');
  // والرابط المُتحقَّق منه يُؤخذ داخل المحرّك من نفس السجل
  const engine = stripComments(read('lib/nemo-watch.ts'));
  assert.match(engine, /record\.nemoLink\.verified \? record\.nemoLink\.url : null/);
});

test('9) صفحة تفاصيل الكتالوج تعرض الزر الأحمر + رابطًا داخليًا لصفحة المشاهدة', () => {
  const landing = stripComments(read('components/MatchLandingView.tsx'));

  assert.match(landing, /<WatchStreamBlock\s+destination=\{destination\}\s*\/>/);
  assert.match(landing, /resolveWatchDestinationForView\(view\)/);
  // الرابط الداخلي لصفحة المشاهدة محفوظ (البوابة الداخلية + مساحاتها الإعلانية)
  assert.match(landing, /href=\{view\.livePath\}/);
});

/* ────────────────────────────────────────────────────────────────────────────
 *  5) مصدر واحد للوجهة + لا مسارات مكسورة
 * ──────────────────────────────────────────────────────────────────────────── */

test('10) وجهة المشاهدة معرّفة في مكان واحد فقط ولا تُكتب يدويًا في الواجهات', () => {
  const violations = scanForbiddenPatterns(repoRoot, ['components', 'app'], [
    { regex: /https:\/\/nemo-sports\.vercel\.app\/watch/, reason: 'hardcoded watch URL' },
  ]);
  assert.deepEqual(
    violations.map((v) => `${v.file}: ${v.reason}`),
    [],
    'رابط المشاهدة يجب أن يأتي من lib/nemo-watch.ts فقط'
  );

  // والمحرّك المركزي هو الوحيد الذي يملك المسار والصيغة
  const engine = read('lib/nemo-watch.ts');
  assert.match(engine, /NEMO_WATCH_PATH = '\/watch'/);
  assert.match(engine, /NEMO_WATCH_ID_PARAM = 'id'/);
  // وقابل للتجاوز بالبيئة دون تعديل كود
  assert.match(engine, /NEXT_PUBLIC_NEMO_WATCH_BASE_URL/);
});

test('11) لا تنتهي أي مباراة بوجهة مكسورة — لكل سجل وكل مسار وجهة صالحة', () => {
  // مسار صفحة التفاصيل مبني دائمًا لأي معرّف (لا يرمي ولا يُنتج فراغًا)
  for (const value of ['match-api-football-1612259', 'a b', 'x/y', 'معرّف-عربي']) {
    const p = buildMatchLandingPath(value);
    assert.ok(p.startsWith('/matches/'), p);
    assert.ok(!/\s/.test(p), `المسار يحتوي مسافة غير مُهرَّبة: ${p}`);
  }

  // كل سجل في المخزن يُنتج رابط مشاهدة صالحًا — بلا استثناء وبلا كود خاص به
  for (const match of getGatewayDatabase().matches) {
    const destination = resolveWatchDestinationForRecord(match);
    assert.ok(/^https:\/\/[^\s]+$/.test(destination.url), `${match.id}: ${destination.url}`);

    // الوجهة موحّدة للجميع: نفس صفحة المشاهدة
    assert.equal(destination.kind, 'platform_watch', match.id);
    assert.equal(destination.url, NEMO_WATCH_BASE_URL, match.id);
    // وإن كان للسجل رابط مُتحقَّق منه فلا يُفقَد — يظهر كرابط ثانوي
    assert.equal(
      destination.exactMatchUrl,
      match.nemoLink.verified ? match.nemoLink.url : null,
      match.id
    );

    // المعرّف المُختار من معرّفات المصادر يبقى صالحًا (للنمط الاختياري ?id=)
    const expectedId = resolveWatchMatchIdForRecord(match);
    assert.equal(destination.matchId, expectedId, match.id);
    assert.ok(expectedId.trim().length > 0, `${match.id}: معرّف فارغ`);
    assert.equal(
      resolveWatchDestinationForMatchId(expectedId, null, 'id-param').url,
      buildPlatformWatchUrl(expectedId),
      `${match.id}: نمط المعرّف لا يبني رابطًا صحيحًا`
    );
  }
});
