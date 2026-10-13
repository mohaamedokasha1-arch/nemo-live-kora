import { buildMatchLandingPath, findCatalogEntryForMatch } from '../matches/match-links';
import { GATEWAY_SITE_URL } from '../site-url';
import type { MatchRecord } from '../types';

export { serializeJsonLd } from './json-ld';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  بيانات صفحات الجداول (ItemList) — وليست صفحات الأحداث
 * ═══════════════════════════════════════════════════════════════════════════════
 *  سياسة Google لأحداث الرياضة: «حدث واحد = صفحة فريدة واحدة»، وصفحات القوائم
 *  لا تتأهل للنتائج المُنسّقة للأحداث. لذلك:
 *   • صفحات اليوم/التاريخ تُخرج `ItemList` يربط كل مباراة بصفحة الهبوط الرسمية لها
 *     (/matches/[id]) عندما تكون هذه الصفحة موجودة — بدون تكرار عقدة SportsEvent
 *     ناقصة الحقول (وهو ما كان يُنتج أخطاء «حقل مفقود» في Search Console).
 *   • البيانات المنظمة الكاملة (SportsEvent كامل الحقول) توجد فقط في صفحة الهبوط
 *     الخاصة بالمباراة، وهي الصفحة المعيارية (canonical) للحدث.
 */
export function createMatchScheduleStructuredData(
  date: string,
  matches: MatchRecord[]
): Record<string, unknown> | null {
  if (matches.length === 0) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `جدول مباريات ${date} — نيمو كورة لايف`,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: matches.length,
    itemListElement: matches.slice(0, 20).map((match, index) => {
      const entry = findCatalogEntryForMatch(match);
      const item: Record<string, unknown> = {
        '@type': 'ListItem',
        position: index + 1,
        name: `${match.homeTeam.nameAr} ضد ${match.awayTeam.nameAr} — ${match.competitionNameAr}`,
      };
      if (entry) {
        // الرابط المعياري لصفحة الحدث الكاملة على البوابة (لا رابط خارجي هنا).
        item.url = `${GATEWAY_SITE_URL}${buildMatchLandingPath(entry.id)}`;
      }
      return item;
    }),
  };
}
