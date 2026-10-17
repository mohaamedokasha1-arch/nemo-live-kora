/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  قراءة معرّفات سجلات المباريات (نقية — قابلة للاستخدام في المتصفح والخادم)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * معرّف السجل في المخزن يُبنى في `lib/match-identity.ts` على النحو:
 *   match-api-football-<fixtureId>     — API-Football v3
 *   match-thesportsdb-<eventId>        — TheSportsDB
 *   match-football-data-<matchId>      — Football-Data
 *   match-sportscore-<tracker|slug>    — SportScore
 *   match-synthetic-<...>-<...>        — بلا معرّف مزوّد (مُشتق من الفرق والتاريخ)
 *
 * عند فشل العثور على السجل في المخزن (نسخة Serverless باردة، لقطة قديمة، أو سجل
 * خارج نافذة المزامنة)، تسمح هذه الطبقة باستنتاج **أي مزوّد يحمل المعرّف**، لذا يمكن
 * للصفحة استعادة المباراة عبر نداء موجَّه للمزوّد نفسه — أو عرض حالة عدم التوفر بشكل
 * أنيق بدل صفحة 404 جامدة.
 */

export type MatchIdProvider =
  | 'api-football'
  | 'thesportsdb'
  | 'football-data'
  | 'sportscore'
  | 'synthetic'
  | 'unknown';

export interface MatchIdHint {
  /** المعرّف كما ورد في الرابط بعد التطبيع. */
  raw: string;
  provider: MatchIdProvider;
  /** المعرّف الخارجي المستنتَج من المعرّف (null لـ`synthetic` و`unknown`). */
  externalId: string | null;
  /**
   * هل هذا المعرّف يعود على مباراة حقيقية من مزوّد بيانات يمكن استعادتها منه؟
   * `match-synthetic-*` صناعة داخلية بلا مزوّد، لذا تُعتبر غير قابلة للاستعادة.
   */
  recoverable: boolean;
}

/** يزيل الفراغات ويحل ترميز URI (مرة واحدة، بأمان) ثم يوحّد حالة الأحرف للمطابقة فقط. */
function normalizeId(value: string | null | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  return decoded;
}

/**
 * يستنتج مصدر المعرّف ومعرّفه الخارجي من صيغة `match-<provider>-<rest>`.
 *
 * القواعد:
 *   • البادئة وحدها ليست كافية: `match-does-not-exist` مثلاً ليس معرّف مزوّد ولا
 *     يُصنَّف `synthetic` — يبقى `unknown` فتُعامل صفحته كمعرّف مجهول (404 حقيقي).
 *   • `match-sportscore-<value>`: القيمة إما tracker id أو slug، وكلاهما صالح للاستعادة
 *     عبر تحديث الجدول (لا يوجد endpoint مفرد للمباراة في SportScore).
 *   • `match-synthetic-*` صناعة داخلية: غير قابلة للاستعادة من أي مزوّد.
 */
export function parseMatchRecordId(value: string | null | undefined): MatchIdHint {
  const raw = normalizeId(value);
  const lower = raw.toLowerCase();
  const hint = (provider: MatchIdProvider, externalId: string | null, recoverable: boolean): MatchIdHint => ({
    raw,
    provider,
    externalId,
    recoverable,
  });

  let match = /^match-api-football-(\d+)$/.exec(lower);
  if (match) return hint('api-football', match[1], true);

  match = /^match-thesportsdb-(\d+)$/.exec(lower);
  if (match) return hint('thesportsdb', match[1], true);

  match = /^match-football-data-(\d+)$/.exec(lower);
  if (match) return hint('football-data', match[1], true);

  match = /^match-sportscore-([a-z0-9_-]+)$/.exec(lower);
  if (match) return hint('sportscore', match[1], true);

  if (/^match-synthetic-/.test(lower)) return hint('synthetic', null, false);

  return hint('unknown', null, false);
}

/**
 * هل هذا المعرّف يحمل هوية مباراة من مزوّد بيانات (صالح للاستعادة أو لشاشة الانتظار
 * الأنيقة)؟ أي معرّف آخر (سطر عشوائي، مسار خاطئ) يُعامل كـ 404 حقيقي.
 */
export function isProviderBackedMatchId(value: string | null | undefined): boolean {
  return parseMatchRecordId(value).recoverable;
}
