import type { SourceId } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  أولوية المصادر — مصدر حكم واحد
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  الرتبة الأصغر = أولوية أعلى. تُستخدم في مكانين فقط، وكلاهما يحتاج **نفس** الترتيب:
 *   ① فضّ التعارض بين جدولين لنفس البطولة (`upsertStandingsInStore`).
 *   ② اختيار السجل الأساسي عند دمج مباراة واحدة رصدها أكثر من مصدر
 *      (`lib/matches/fixture-consolidation.ts`).
 *
 *  ولأن المدير يستطيع تغيير الترتيب من اللوحة، تُقرأ الأولوية الفعلية من `getSourceControl`
 *  في طبقة المخزن (`sourcePriorityRank`)، وتبقى هذه القيم هي الافتراضي المُوثّق عند
 *  غياب أي ضبط إداري — فلا يتغيّر أي سلوك قديم إن لم يضبط المدير شيئًا.
 */
export const DEFAULT_SOURCE_RANK: Record<SourceId, number> = {
  sportscore: 10,
  thesportsdb: 20,
  'football-data': 30,
  'api-football': 40,
  'google-news-rss': 90,
};

export function defaultSourceRank(sourceId: SourceId): number {
  return DEFAULT_SOURCE_RANK[sourceId] ?? 99;
}
