import { MATCH_CATALOG } from '@/data/matches';
import { buildCatalogEntryFromManual } from './manual-document';
import { listManualMatches } from './manual-store';
import { applyManualLayerToMatch } from './overrides';
import {
  buildMatchLandingPath,
  findCatalogEntryById,
  findCatalogEntryForMatch,
  getAllCatalogEntries,
  getFeaturedCatalogEntry,
} from '../matches/match-links';
import type { MatchCatalogEntry } from '../matches/types';
import type { MatchRecord } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  طبقة الكتالوج المخدومة (خادم فقط)
 * ═══════════════════════════════════════════════════════════════════════════════
 *  هذه الوحدة هي الجسر بين **مباريات لوحة الإدارة** وبقية الموقع:
 *
 *   • `getServedCatalogEntries()` = كتالوج المستودع + مباريات المدير، فيسري عليها كل
 *     شيء تلقائيًا: صفحة الهبوط `/matches/{id}`، صفحة البث `/live/{id}`، صورة
 *     المشاركة، البيانات المنظمة، وخريطة الموقع — بلا كود خاص بكل مباراة.
 *   • `landingPathsForMatches()` تُسلِّم مسارات الهبوط إلى مكوّنات العميل كبيانات
 *     (Props) لأنها لا تستطيع قراءة طبقة الإدارة بنفسها.
 *
 *  القاعدة الثابتة: لا إنشاء صفحات مكرّرة — معرّف المباراة اليدوية يُشتق من الفريقين
 *  والتاريخ، والفحص قبل الإنشاء يمنع تكرار مباراة موجودة أصلًا.
 */

export function getManualCatalogEntries(): MatchCatalogEntry[] {
  const manual = listManualMatches();
  if (manual.length === 0) return [];
  return manual.map((record) => buildCatalogEntryFromManual(record));
}

export function getServedCatalogEntries(): MatchCatalogEntry[] {
  return getAllCatalogEntries(getManualCatalogEntries());
}

export function findServedCatalogEntryById(id: string | null | undefined): MatchCatalogEntry | null {
  return findCatalogEntryById(id, getManualCatalogEntries());
}

export function findServedCatalogEntryForMatch(match: MatchRecord): MatchCatalogEntry | null {
  return findCatalogEntryForMatch(match, getManualCatalogEntries());
}

export function getServedFeaturedCatalogEntry(): MatchCatalogEntry | null {
  return getFeaturedCatalogEntry(getManualCatalogEntries());
}

export function findServedCatalogEntriesByCairoDate(cairoDate: string): MatchCatalogEntry[] {
  return getServedCatalogEntries().filter((entry) => entry.cairoDate === cairoDate);
}

/** مسار صفحة الهبوط لسجل مباراة (أو null إن لم يكن له سجل كتالوج). */
export function servedLandingPathForMatch(match: MatchRecord): string | null {
  const entry = findServedCatalogEntryForMatch(match);
  return entry ? buildMatchLandingPath(entry.id) : null;
}

/** خريطة `معرّف سجل المباراة ← مسار صفحة الهبوط` تُمرَّر إلى بطاقات العميل. */
export function landingPathsForMatches(matches: MatchRecord[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const match of matches) {
    const path = servedLandingPathForMatch(match);
    if (path) map[match.id] = path;
  }
  return map;
}

/**
 * سجل المصدر مع تطبيق تعديلات المدير المثبَّتة (الحقول المثبَّتة، أو تجميد السجل).
 * تُستخدم في كل مكان يُقرأ فيه سجل من المخزن لعرضه، فيرى الزائر تعديل المدير فورًا.
 */
export function applyAdminOverridesToMatch(match: MatchRecord): MatchRecord {
  return applyManualLayerToMatch(match);
}

export { MATCH_CATALOG };
