import { toCairoDateString } from '../cairo-time';
import { fetchFootballDataSync } from '../sources/football-data';
import type { MatchRecord } from '../types';
import type { CoverageSiteMatch, ReferenceMatch } from './compare';

/**
 * محوّلات المرجع. كل مرجع يجب أن يكون **مصرّحًا به**:
 *  - `football-data`: واجهة API رسمية بمفتاح (`FOOTBALL_DATA_API_KEY`) — بلا مفتاح لا يوجد مرجع.
 *  - `file:<path>`: ملف JSON يصدّره صاحب المشروع من مصدر مرخص له هو (مثل تصدير من مزوّد بترخيص).
 *
 * **كووورة مرفوضة صراحةً**: شروط الاستخدام في kooora.com (البند 11 «No text or data mining, or
 * web scraping») تمنع أي روبوت أو كاشط للوصول إلى أي جزء من الموقع، والبند 10 يقصر الاستخدام
 * على المشاهدة الشخصية غير التجارية. لذلك لا يوجد محوّل آلي لكووورة في هذا المستودع.
 */

export const REFUSED_REFERENCE_IDS = ['kooora', 'كووورة'] as const;

export function refusedReferenceReason(sourceId: string): string | null {
  const normalized = sourceId.trim().toLowerCase();
  if ((REFUSED_REFERENCE_IDS as readonly string[]).includes(normalized) || normalized.includes('kooora')) {
    return 'كووورة: شروط الاستخدام تمنع الكشط والوصول الآلي (البند 11) والاستخدام التجاري دون ترخيص (البند 10). لا يُستخدم كمرجع آلي؛ استخدم مرجعًا مصرّحًا به.';
  }
  return null;
}

export interface ReferenceParseRejection {
  index: number;
  reason: string;
}

export interface ReferenceParseResult {
  matches: ReferenceMatch[];
  rejected: ReferenceParseRejection[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  return undefined;
}

/**
 * يتحقق من تصدير JSON (مصفوفة صفوف). الصف الذي ينقصه حقل إلزامي يُرفض بسبب واضح ولا يُكمَّل
 * بالتخمين. الحقول: competition, home, away, و(date أو utcKickoff)، واختياريًا competitionCode،
 * status، homeScore، awayScore، externalId و externalIdKey.
 */
export function parseReferenceExport(payload: unknown, sourceLabel: string): ReferenceParseResult {
  const matches: ReferenceMatch[] = [];
  const rejected: ReferenceParseRejection[] = [];
  if (!Array.isArray(payload)) {
    return { matches, rejected: [{ index: -1, reason: 'الملف يجب أن يكون مصفوفة JSON من الصفوف' }] };
  }
  payload.forEach((row, index) => {
    if (!row || typeof row !== 'object') {
      rejected.push({ index, reason: 'الصف ليس كائنًا' });
      return;
    }
    const r = row as Record<string, unknown>;
    const competition = str(r.competition);
    const home = str(r.home);
    const away = str(r.away);
    if (!competition || !home || !away) {
      rejected.push({ index, reason: 'حقول إلزامية ناقصة: competition / home / away' });
      return;
    }
    const utcRaw = str(r.utcKickoff);
    let utcKickoff: string | null = null;
    if (utcRaw) {
      const ms = Date.parse(utcRaw);
      if (!Number.isFinite(ms)) {
        rejected.push({ index, reason: 'utcKickoff ليس تاريخًا صالحًا' });
        return;
      }
      utcKickoff = new Date(ms).toISOString();
    }
    let cairoDate = str(r.date);
    if (cairoDate && !DATE_PATTERN.test(cairoDate)) {
      rejected.push({ index, reason: 'تاريخ date ليس بصيغة YYYY-MM-DD' });
      return;
    }
    if (!cairoDate && utcKickoff) cairoDate = toCairoDateString(utcKickoff);
    if (!cairoDate) {
      rejected.push({ index, reason: 'لا يوجد تاريخ (date أو utcKickoff)' });
      return;
    }
    // الحقل الغائب = نتيجة غير معروفة (null)، والحقل الموجود بقيمة غير صالحة يُرفض.
    const homeScore = r.homeScore === undefined ? null : num(r.homeScore);
    const awayScore = r.awayScore === undefined ? null : num(r.awayScore);
    if (homeScore === undefined || awayScore === undefined) {
      rejected.push({ index, reason: 'homeScore/awayScore يجب أن يكونا عددًا صحيحًا أو null' });
      return;
    }
    const externalId = str(r.externalId);
    const externalIdKey = str(r.externalIdKey);
    matches.push({
      source: sourceLabel,
      competitionCode: str(r.competitionCode) || undefined,
      competitionName: competition,
      cairoDate,
      utcKickoff,
      homeName: home,
      awayName: away,
      status: str(r.status),
      homeScore,
      awayScore,
      externalRef: externalId && externalIdKey ? { key: externalIdKey, value: externalId } : undefined,
    });
  });
  return { matches, rejected };
}

/** يحوّل سجل موقع إلى صورة المقارنة. */
export function toCoverageSiteMatch(record: MatchRecord): CoverageSiteMatch {
  return {
    id: record.id,
    competitionCode: record.competitionCode,
    competitionNameAr: record.competitionNameAr,
    competitionNameEn: record.competitionNameEn,
    cairoDate: record.cairoDate,
    utcKickoff: record.utcKickoff,
    kickoffConfirmed: record.kickoffConfirmed === true,
    homeNames: [record.homeTeam.nameEn, record.homeTeam.nameAr].filter(Boolean) as string[],
    awayNames: [record.awayTeam.nameEn, record.awayTeam.nameAr].filter(Boolean) as string[],
    status: record.status,
    homeScore: record.score?.home ?? null,
    awayScore: record.score?.away ?? null,
    externalIds: { ...(record.externalIds as Record<string, string | undefined>) },
    contributingSources: [...(record.contributingSources || []), record.primarySource].filter(Boolean),
  };
}

export interface FootballDataReferenceResult {
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  matches: ReferenceMatch[];
  hasApiKey: boolean;
  error?: string;
  messageAr: string;
}

/**
 * مرجع Football-Data.org (API رسمي). بلا مفتاح لا يُطلب شيء ويُعاد `ok: false` بسبب واضح.
 * يُستخدم الجلب الموجود في `lib/sources/football-data.ts` كما هو، بلا مسار جديد.
 */
export async function fetchFootballDataReference(from: string, to: string): Promise<FootballDataReferenceResult> {
  const hasKey = Boolean((process.env.FOOTBALL_DATA_API_KEY || '').trim());
  if (!hasKey) {
    return {
      ok: false,
      httpStatus: null,
      latencyMs: 0,
      matches: [],
      hasApiKey: false,
      error: 'missing_api_key',
      messageAr: 'لا يوجد مرجع: FOOTBALL_DATA_API_KEY غير مضبوط. لم يُطلب أي شيء من المرجع.',
    };
  }
  const res = await fetchFootballDataSync(from, to);
  const matches: ReferenceMatch[] = res.matches.map((match) => ({
    source: 'football-data.org',
    externalRef: match.externalIds.footballDataMatchId
      ? { key: 'footballDataMatchId', value: match.externalIds.footballDataMatchId }
      : undefined,
    competitionCode: match.competitionCode,
    competitionName: match.competitionNameEn || match.competitionNameAr,
    cairoDate: match.cairoDate,
    utcKickoff: match.kickoffConfirmed === true ? match.utcKickoff : null,
    homeName: match.homeTeam.nameEn,
    awayName: match.awayTeam.nameEn,
    status: match.status,
    homeScore: match.score?.home ?? null,
    awayScore: match.score?.away ?? null,
  }));
  return {
    ok: res.ok,
    httpStatus: res.httpStatus,
    latencyMs: res.latencyMs,
    matches,
    hasApiKey: res.hasApiKey,
    error: res.ok ? undefined : res.error || 'football_data_unavailable',
    messageAr: res.messageAr,
  };
}
