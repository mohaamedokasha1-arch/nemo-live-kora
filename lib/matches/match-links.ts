import { MATCH_CATALOG, FEATURED_MATCH_ID } from '@/data/matches';
import type { MatchRecord } from '../types';
import type { MatchCatalogEntry } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  أدوات كتالوج المباريات — طبقة نقية (Client-Safe)
 * ═══════════════════════════════════════════════════════════════════════════
 *  لا تستورد هذه الطبقة قاعدة البيانات ولا نظام الملفات، لذلك يمكن استخدامها
 *  داخل مكوّنات العميل (`MatchCard`) لربط بطاقة المباراة بصفحة الهبوط الداخلية.
 *
 *  مباريات لوحة الإدارة تُمرَّر إلى هذه الدوال عبر الوسيط `extra` (وتُجهَّز على الخادم
 *  في `lib/admin/served-catalog.ts`)، فلا يحتاج أي مكوّن عميل إلى معرفة مصدر البيانات.
 */

/** مسار صفحة الهبوط الرسمية للمباراة. */
export function buildMatchLandingPath(id: string): string {
  return `/matches/${encodeURIComponent(id)}`;
}

/** مسار صفحة البث/المشاهدة الداخلية. */
export function buildMatchLivePath(id: string): string {
  return `/live/${encodeURIComponent(id)}`;
}

/**
 * مسار صورة المشاركة المُولَّدة (1200×675) الخاصة بالمباراة.
 * تُنشئها `app/matches/[id]/opengraph-image.tsx` أوتوماتيكيًا لكل معرّف،
 * وتُستخدم كصورة أساسية في البيانات المنظمة (متطلب Google: عرض ≥ 720px).
 */
export function buildMatchOgImagePath(id: string): string {
  return `/matches/${encodeURIComponent(id)}/opengraph-image`;
}

/**
 * كل مباريات الكتالوج (مستبعدًا منها النموذج التعليمي غير المنشور) **مضافًا إليها
 * أي سجلات إضافية يمرّرها الخادم** (مباريات لوحة الإدارة).
 *
 * هذا هو نقطة الربط الوحيدة المطلوبة: لأن كل شيء في الموقع (صفحة الهبوط، صفحة البث،
 * البيانات المنظمة، خريطة الموقع، بطاقات الصفحة الرئيسية) يُبنى من هذه الدالة، فإن
 * أي مباراة يدخلها المدير من اللوحة تحصل تلقائيًا على كل ذلك بلا كود خاص بها.
 */
export function getAllCatalogEntries(extra: MatchCatalogEntry[] = []): MatchCatalogEntry[] {
  if (extra.length === 0) return MATCH_CATALOG;
  return [...MATCH_CATALOG, ...extra];
}

/** مباراة واحدة بمعرّفها، أو null عند عدم وجودها. */
export function findCatalogEntryById(
  id: string | null | undefined,
  extra: MatchCatalogEntry[] = []
): MatchCatalogEntry | null {
  if (!id) return null;
  const normalized = id.trim().toLowerCase();
  if (!normalized) return null;
  let decoded = normalized;
  try {
    decoded = decodeURIComponent(normalized);
  } catch {
    decoded = normalized;
  }
  return (
    getAllCatalogEntries(extra).find(
      (entry) => entry.id.toLowerCase() === normalized || entry.id.toLowerCase() === decoded
    ) ?? null
  );
}

/** هل هذا المعرّف يخص مباراة في الكتالوج (وليس تاريخًا مثل 2026-10-20)؟ */
export function isCatalogMatchId(value: string, extra: MatchCatalogEntry[] = []): boolean {
  return findCatalogEntryById(value, extra) !== null;
}

/** مباراة الأسبوع المعروضة في الصفحة الرئيسية (إن كانت موجودة). */
export function getFeaturedCatalogEntry(extra: MatchCatalogEntry[] = []): MatchCatalogEntry | null {
  const all = getAllCatalogEntries(extra);
  return (
    findCatalogEntryById(FEATURED_MATCH_ID, extra) ??
    all.find((entry) => entry.status === 'scheduled') ??
    all[0] ??
    null
  );
}

/**
 * الربط بين سجل مباراة حقيقي وسجل الكتالوج الخاص به.
 * الربط يتم بمعرّفات المصادر الدقيقة فقط — لا مطابقة تقريبية ولا بالأسماء.
 */
export function matchCatalogEntry(
  entries: MatchCatalogEntry[],
  match: MatchRecord
): MatchCatalogEntry | null {
  const identity = {
    thesportsdbEventId: match.externalIds.thesportsdbEventId,
    apiFootballFixtureId: match.externalIds.apiFootballFixtureId,
    sportscoreSlug: match.externalIds.sportscoreSlug,
    sportscoreTrackerId: match.externalIds.sportscoreTrackerId,
  };

  return (
    entries.find((entry) => {
      const source = entry.source;
      if (source.matchId && source.matchId === match.id) return true;
      if (source.thesportsdbEventId && source.thesportsdbEventId === identity.thesportsdbEventId) return true;
      if (source.apiFootballFixtureId && source.apiFootballFixtureId === identity.apiFootballFixtureId) return true;
      if (source.providerMatchId && source.providerMatchId === identity.sportscoreTrackerId) return true;
      if (source.sportscoreSlug && source.sportscoreSlug === identity.sportscoreSlug) return true;
      return (
        source.competitionCode === match.competitionCode &&
        source.homeTeamId === match.homeTeam.id &&
        source.awayTeamId === match.awayTeam.id &&
        source.cairoDate === match.cairoDate
      );
    }) ?? null
  );
}

/** يربط سجل مباراة حقيقي بسجل الكتالوج الخاص به (مع أي سجلات إضافية يمرّرها الخادم). */
export function findCatalogEntryForMatch(
  match: MatchRecord,
  extra: MatchCatalogEntry[] = []
): MatchCatalogEntry | null {
  return matchCatalogEntry(getAllCatalogEntries(extra), match);
}

/** خريطة `سجل المباراة ← معرّف صفحة الهبوط` لربط كل البطاقات دفعة واحدة. */
export function buildMatchLandingPathMap(
  matches: MatchRecord[],
  extra: MatchCatalogEntry[] = []
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const match of matches) {
    const entry = findCatalogEntryForMatch(match, extra);
    if (entry) map[match.id] = buildMatchLandingPath(entry.id);
  }
  return map;
}
