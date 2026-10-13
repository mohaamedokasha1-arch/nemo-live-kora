import { MATCH_CATALOG, FEATURED_MATCH_ID } from '@/data/matches';
import type { MatchRecord } from '../types';
import type { MatchCatalogEntry } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  أدوات كتالوج المباريات — طبقة نقية (Client-Safe)
 * ═══════════════════════════════════════════════════════════════════════════
 *  لا تستورد هذه الطبقة قاعدة البيانات ولا نظام الملفات، لذلك يمكن استخدامها
 *  داخل مكوّنات العميل (`MatchCard`) لربط بطاقة المباراة بصفحة الهبوط الداخلية.
 */

/** مسار صفحة الهبوط الرسمية للمباراة. */
export function buildMatchLandingPath(id: string): string {
  return `/matches/${encodeURIComponent(id)}`;
}

/** مسار صفحة البث/المشاهدة الداخلية. */
export function buildMatchLivePath(id: string): string {
  return `/live/${encodeURIComponent(id)}`;
}

/** كل مباريات الكتالوج (مستبعدًا منها النموذج التعليمي غير المنشور). */
export function getAllCatalogEntries(): MatchCatalogEntry[] {
  return [...MATCH_CATALOG];
}

/** مباراة واحدة بمعرّفها/سلَغها، أو null عند عدم وجودها. */
export function findCatalogEntryById(id: string | null | undefined): MatchCatalogEntry | null {
  if (!id) return null;
  const normalized = id.trim().toLowerCase();
  if (!normalized) return null;
  return (
    MATCH_CATALOG.find(
      (entry) => entry.id.toLowerCase() === normalized || entry.id.toLowerCase() === decodeURIComponent(normalized)
    ) ?? null
  );
}

/** هل هذا المعرّف يخص مباراة في الكتالوج (وليس تاريخًا مثل 2026-10-20)؟ */
export function isCatalogMatchId(value: string): boolean {
  return findCatalogEntryById(value) !== null;
}

/** مباراة الأسبوع المعروضة في الصفحة الرئيسية (إن كانت موجودة). */
export function getFeaturedCatalogEntry(): MatchCatalogEntry | null {
  return (
    findCatalogEntryById(FEATURED_MATCH_ID) ??
    MATCH_CATALOG.find((entry) => entry.status === 'scheduled') ??
    MATCH_CATALOG[0] ??
    null
  );
}

/**
 * يربط سجل مباراة حقيقي من قاعدة البيانات بسجل الكتالوج الخاص به.
 * الربط يتم بمعرّفات المصادر الدقيقة فقط — لا مطابقة تقريبية ولا بالأسماء.
 */
export function findCatalogEntryForMatch(match: MatchRecord): MatchCatalogEntry | null {
  const identity = {
    thesportsdbEventId: match.externalIds.thesportsdbEventId,
    apiFootballFixtureId: match.externalIds.apiFootballFixtureId,
    sportscoreSlug: match.externalIds.sportscoreSlug,
    sportscoreTrackerId: match.externalIds.sportscoreTrackerId,
  };

  return (
    MATCH_CATALOG.find((entry) => {
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

/** خريطة `سجل المباراة ← معرّف صفحة الهبوط` لربط كل البطاقات دفعة واحدة. */
export function buildMatchLandingPathMap(matches: MatchRecord[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const match of matches) {
    const entry = findCatalogEntryForMatch(match);
    if (entry) {
      map[match.id] = buildMatchLandingPath(entry.id);
    }
  }
  return map;
}
