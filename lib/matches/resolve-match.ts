import { redirect } from 'next/navigation';
import {
  findMatchRecordById,
  getActiveMatches,
  getGatewayDatabase,
  upsertMatchesInStoreWithStats,
} from '../db/store';
import {
  findServedCatalogEntryById,
  findServedCatalogEntryForMatch,
} from '../admin/served-catalog';
import { ensureFreshMatches } from '../sync/engine';
import { fetchApiFootballFixtureById } from '../sources/api-football';
import { fetchTheSportsDBEventById } from '../sources/thesportsdb';
import { buildMatchLandingPath } from './match-links';
import { parseMatchRecordId, type MatchIdHint } from './match-id-hints';
import type { MatchCatalogEntry } from './types';
import type { MatchRecord } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  محوّل معرّف المباراة إلى وجهة عرض (خادم فقط) — حل جذري لمشكلة 404 التفاصيل
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * المشكلة التي يعالجها هذا الملف: الجدول يعرض مباريات مُزامَنة حديثًا بمعرّفات مثل
 * `match-thesportsdb-2561134`، وعند النقر يصل الطلب إلى `/matches/<id>` — وفي بيئات
 * Serverless قد تُخدمه **نسخة باردة** مخزنها هو لقطة البذرة القديمة فقط، فتفشل قراءة
 * السجل وتظهر صفحة 404 لمباراة موجودة فعلًا في الجدول والمزوّد.
 *
 * مسار الحل (بترتيب ثابت — لا قفزات):
 *   ① كتالوج `data/matches.ts` + مباريات لوحة الإدارة (لقطة ثابتة — فورية دائمًا).
 *   ② المخزن (يشمل التكرارات المُثبتة: المعرّف القديم يُحوَّل إلى السجل الأساسي).
 *   ③ تحديث الجدول عند الطلب (`ensureFreshMatches`) ثم إعادة القراءة — فيُخزَّن سجل
 *      هذه المباراة في **هذه النسخة** نفسها قبل الرد.
 *   ④ استعادة موجَّهة بمعرّف المزوّد (`lookupevent.php?id=` / `GET /fixtures?id=`)
 *      للسجلات خارج نافذة المزامنة (نتائج قديمة، مباريات تاريخية).
 *   ⑤ إن لم يتيسر شيء لمعرّف يحمل هوية مزوّد: حالة «غير متاحة» أنيقة (لا 404 جامدة)،
 *      ومعرّف بلا هوية معروفة: 404 حقيقي (`notFound`) — لا صفحات مخترعة.
 */

/** نداء استعادة اختياري — يُحقن في الاختبارات بدل الشبكة. */
export type MatchLookup = (hint: MatchIdHint) => Promise<MatchRecord | null>;

export type MatchDetailTarget =
  | { kind: 'catalog'; entry: MatchCatalogEntry; path: string }
  | { kind: 'record'; record: MatchRecord; path: string }
  /** المعرّف المطلوب يشير إلى صفحة أخرى هي القانونية (كتالوج لمطابقة السجل). */
  | { kind: 'alias'; to: string; entry: MatchCatalogEntry }
  /** معرّف بهوية مزوّد لكن بياناته غير متاحة الآن — fallback UI أنيق، لا 404. */
  | { kind: 'unavailable'; hint: MatchIdHint };

export interface ResolveMatchDetailOptions {
  /**
   * عند `true` (الافتراضي — مسار الصفحة) يُحدَّث الجدول عند الطلب قبل الاستعادة
   * الموجَّهة. `generateMetadata` والاختبارات يمكنها تعطيله لتقليل النداءات.
   */
  refresh?: boolean;
  /** بديل حقن لاستعادة المزوّد (اختبارات بلا شبكة). */
  lookup?: MatchLookup;
}

/** الاستعادة الافتراضية من المزوّدين — بحسب ما يكشفه معرّف السجل. */
const DEFAULT_LOOKUPS: Record<'api-football' | 'thesportsdb', MatchLookup> = {
  'api-football': (hint) => fetchApiFootballFixtureById(hint.externalId || ''),
  thesportsdb: (hint) => fetchTheSportsDBEventById(hint.externalId || ''),
};

async function defaultLookup(hint: MatchIdHint): Promise<MatchRecord | null> {
  if (!hint.recoverable || !hint.externalId) return null;
  const lookup = DEFAULT_LOOKUPS[hint.provider as 'api-football' | 'thesportsdb'];
  return lookup ? lookup(hint) : null;
}

/**
 * يحدّد الوجهة النهائية لمعرّف بعد إدخال سجله في المخزن: كتالوج، أو صفحة السجل،
 * أو تحويل إلى الصفحة القانونية عندما يكون المعرّف المطلوب معرّفًا قديمًا.
 */
function targetForRecord(record: MatchRecord, requestedId: string): MatchDetailTarget {
  const canonicalEntry = findServedCatalogEntryForMatch(record);
  if (canonicalEntry) {
    const path = buildMatchLandingPath(canonicalEntry.id);
    // المعرّف المطلوب ليس معرّف صفحة الكتالوج → تحويل إلى الصفحة القانونية.
    if (canonicalEntry.id.toLowerCase() !== requestedId.toLowerCase()) {
      return { kind: 'alias', to: path, entry: canonicalEntry };
    }
    return { kind: 'catalog', entry: canonicalEntry, path };
  }
  return { kind: 'record', record, path: buildMatchLandingPath(record.id) };
}

/**
 * قراءة متزامنة بلا شبكة ولا تحديث: كتالوج ← مخزن ← غير متاح.
 * تكفي لمسارات التحويل القديمة (`/match/[id]`) ولقطائع metadata حين يكون السجل
 * معروفًا أصلًا.
 */
export function resolveMatchDetailTargetSync(
  id: string | null | undefined
): MatchDetailTarget {
  const hint = parseMatchRecordId(id);
  const raw = hint.raw;
  if (!raw) return { kind: 'unavailable', hint };

  const entry = findServedCatalogEntryById(raw);
  if (entry) return { kind: 'catalog', entry, path: buildMatchLandingPath(entry.id) };

  const record = findMatchRecordById(raw);
  if (record) return targetForRecord(record, raw);

  return { kind: 'unavailable', hint };
}

/**
 * بعد إدخال سجل مُستعاد للتو: أوجد النسخة المخزَّنة الحقيقية (قد تندمج في سجل قائم
 * عبر هوية المباراة القوية، فيبقى معرّف السجل المخزَّن مختلفًا عن معرّف المزوّد).
 */
function findRecordAfterRecovery(requestedId: string, fetched: MatchRecord): MatchRecord | null {
  const store = getGatewayDatabase();
  const direct =
    findMatchRecordById(requestedId, store) ?? findMatchRecordById(fetched.id, store);
  if (direct) return direct;

  const wanted = new Set(
    [
      fetched.externalIds.thesportsdbEventId,
      fetched.externalIds.apiFootballFixtureId,
      fetched.externalIds.sportscoreTrackerId,
      fetched.externalIds.footballDataMatchId,
    ].filter(Boolean)
  );
  if (wanted.size === 0) return null;
  return (
    getActiveMatches(store).find((candidate) =>
      [
        candidate.externalIds.thesportsdbEventId,
        candidate.externalIds.apiFootballFixtureId,
        candidate.externalIds.sportscoreTrackerId,
        candidate.externalIds.footballDataMatchId,
      ].some((value) => value && wanted.has(value))
    ) ?? null
  );
}

/**
 * المحول الكامل: كل مسارات القراءة والاستعادة أعلاه.
 *
 * يُستدعى من `generateMetadata` وصفحة `/matches/[id]` — وبعد نجاح الاستعادة يبقى
 * السجل في المخزن، فتقرأ الصفحة نفسها النتيجة بلا نداء ثانٍ.
 */
export async function resolveMatchDetailTarget(
  id: string | null | undefined,
  options: ResolveMatchDetailOptions = {}
): Promise<MatchDetailTarget> {
  const { refresh = true, lookup } = options;
  const hint = parseMatchRecordId(id);
  const raw = hint.raw;
  if (!raw) return { kind: 'unavailable', hint };

  /* ① كتالوج + ② المخزن — بلا أي نداء شبكة. */
  const syncTarget = resolveMatchDetailTargetSync(raw);
  if (syncTarget.kind !== 'unavailable') return syncTarget;

  /* معرّف بلا هوية مزوّد معروفة: لا سبب لأي نداء شبكة — مجهول مباشرة. */
  if (hint.provider === 'unknown') return { kind: 'unavailable', hint };

  /* ③ تحديث الجدول عند الطلب ثم إعادة القراءة (نفسه ما يفعله جدول اليوم). */
  if (refresh) {
    try {
      await ensureFreshMatches(undefined, 'تحديث مباريات عند طلب صفحة التفاصيل');
    } catch {
      // فشل التحديث لا يمنع المحاولات التالية؛ البيانات المخزَّنة ليست مهددة.
    }
    const afterRefresh = resolveMatchDetailTargetSync(raw);
    if (afterRefresh.kind !== 'unavailable') return afterRefresh;
  }

  /* ④ استعادة موجَّهة من المزوّد بمعرّفه الخارجي. */
  if (hint.recoverable) {
    const fetched = await (lookup ?? defaultLookup)(hint);
    if (fetched) {
      upsertMatchesInStoreWithStats([fetched]);
      const stored = findRecordAfterRecovery(raw, fetched);
      if (stored) return targetForRecord(stored, raw);
    }
  }

  /* ⑤ fallback أنيق للمعرّفات الحقيقية، و404 صريح للمجهول. */
  return { kind: 'unavailable', hint };
}

/**
 * مساعد لصفحات العرض: يحوّل «alias» إلى `redirect()` قانوني من Next، ويعيد السجل/الكتالوج
 * لمن يرسمهما. حالات «unavailable» يقررها المستدعِ (fallback UI أو `notFound`).
 */
export function redirectIfAlias(target: MatchDetailTarget): void {
  if (target.kind === 'alias') redirect(target.to);
}
