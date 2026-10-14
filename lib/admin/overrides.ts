import {
  MANUAL_STATUS_LABEL_AR,
  ManualMatchStatus,
  ManualOverride,
  buildMatchRecordFromManual,
} from './manual-document';
import { findManualMatch, findManualOverride, getManualOverrides } from './manual-store';
import type { MatchRecord, SourceId } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  سياسة فضّ التعارض بين ما كتبه المدير وما تجلبه المصادر
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  القاعدة التي تحمي عمل المدير، بالترتيب:
 *
 *   1) حقل مثبَّت (`locked`)  ← أعلى أولوية: لا يكتبه أي مصدر، ولا في المزامنة التالية.
 *   2) مباراة يدوية كاملة (`lockAll` أو سجل من لوحة التحكم) ← المصادر لا تعدّل السجل.
 *   3) قيمة أحدث من مصدر **غير مستبعَد** عن هذا السجل ← تُقبل كما في القواعد القديمة.
 *   4) بيانات الكتالوج/الافتراضية ← تُستخدم فقط إن لم يوجد سجل مصدر.
 *
 *  وثلاث دالات صغيرة فقط تُنفّذ ذلك:
 *   • `isMatchUpdateBlocked` — هل نُسقط تحديث هذا المصدر لهذه المباراة؟
 *   • `applyOverrideToMatch` — تُطبّق الحقول المثبَّتة على السجل بعد أي دمج.
 *   • `applyManualLayerToMatch` — تجمع الاثنين في مكان واحد يستدعيه كل مسار قراءة.
 *
 *  وكلها دوال نقية بلا كتابة: القراءة لا تغيّر بيانات، والكتابة تحدث في `lib/db/store.ts`.
 */

/** هل يستبعد هذا السجل المصدر القادم منه التحديث؟ */
export function isSourceSuppressedForMatch(matchId: string, sourceId: SourceId): boolean {
  const override = findManualOverride(matchId);
  if (!override) return false;
  return override.suppressedSources.includes(sourceId);
}

/**
 * هل نرفض تحديثًا قادمًا من مصدر لهذه المباراة؟
 * نرفضه إذا: السجل مجمَّد كاملًا، أو المصدر مستبعَد عن هذا السجل تحديدًا.
 * (المباراة اليدوية لا تصل هنا لأنها لا تملك سجل مصدر أصلًا.)
 */
export function isMatchUpdateBlocked(matchId: string, sourceId: SourceId | undefined): boolean {
  const override = findManualOverride(matchId);
  if (!override) return false;
  if (override.lockAll) return true;
  if (!sourceId) return false;
  return override.suppressedSources.includes(sourceId);
}

/** وصف عربي مختصر لسياسة سجل واحد — يُعرض في اللوحة وفي المباراة. */
export function describeOverrideAr(override: ManualOverride | null): string {
  if (!override) return 'لا يوجد أي تثبيت يدوي — السجل يتحدّث من المصادر تلقائيًا.';
  const parts: string[] = [];
  if (override.lockAll) parts.push('مجمَّد بالكامل: لا يعدّله أي مصدر');
  if (override.locked.length > 0) parts.push(`حقول مثبَّتة: ${override.locked.map((f) => f).join('، ')}`);
  if (override.suppressedSources.length > 0) {
    parts.push(`مصادر مستبعَدة عن هذه المباراة: ${override.suppressedSources.join('، ')}`);
  }
  if (parts.length === 0) parts.push('لا تثبيت فعّال');
  return parts.join(' • ');
}

/**
 * تُطبّق التثبيتات على سجل مباراة. تُنادى بعد أي دمج مع المصادر حتى لا يضيع عمل
 * المدير، وتُعيد نسخة جديدة (لا تُعدّل السجل الأصلي).
 */
export function applyOverrideToMatch(match: MatchRecord, override: ManualOverride | null): MatchRecord {
  if (!override) return match;
  const locked = new Set(override.locked);
  const values = override.values;
  const next: MatchRecord = { ...match, score: { ...match.score } };

  if (locked.has('kickoff') && values.kickoff) {
    next.utcKickoff = values.kickoff.utcKickoff;
    next.cairoDate = values.kickoff.cairoDate;
    next.cairoTime = values.kickoff.cairoTime;
    // الموعد الذي أدخله المدير موعد مؤكَّد: هو رآه بنفسه، فلا يُعرض «بانتظار التأكيد».
    next.kickoffConfirmed = true;
  }

  if (locked.has('status') && values.status) {
    next.status = values.status.status;
    next.statusLabelAr = values.status.statusLabelAr;
    next.liveMinute = values.status.liveMinute;
    next.statusNoteAr = values.status.statusNoteAr;
  }

  if (locked.has('score') && values.score) {
    next.score = { ...match.score, ...values.score };
  }

  if (locked.has('venue')) {
    next.venue = values.venue ?? null;
  }

  if (locked.has('teams') && values.teams) {
    next.homeTeam = { ...match.homeTeam, nameAr: values.teams.home.nameAr, nameEn: values.teams.home.nameEn, logoUrl: values.teams.home.logoUrl };
    next.awayTeam = { ...match.awayTeam, nameAr: values.teams.away.nameAr, nameEn: values.teams.away.nameEn, logoUrl: values.teams.away.logoUrl };
  }

  if (locked.has('competition') && values.competition) {
    next.competitionCode = values.competition.code;
    next.competitionNameAr = values.competition.nameAr;
    next.competitionNameEn = values.competition.nameEn;
    next.countryAr = values.competition.countryAr;
    next.region = values.competition.region;
  }

  if (locked.has('round')) {
    next.roundLabelAr = values.roundLabelAr ?? null;
  }

  if (locked.has('incidents')) {
    next.incidents = values.incidents && values.incidents.length > 0 ? values.incidents : undefined;
  }

  return next;
}

/** يبحث عن تجاوز سجل مباراة (بالمعرّف) ويُطبّقه. */
export function applyManualLayerToMatch(match: MatchRecord): MatchRecord {
  return applyOverrideToMatch(match, findManualOverride(match.id));
}

/** يُطبّق الطبقة اليدوية على قائمة كاملة — للاستخدام في مسارات القراءة بالجملة. */
export function applyManualLayerToMatches(matches: MatchRecord[]): MatchRecord[] {
  const overrides = getManualOverrides();
  if (overrides.length === 0) return matches;
  const byId = new Map(overrides.map((override) => [override.matchId, override]));
  return matches.map((match) => applyOverrideToMatch(match, byId.get(match.id) ?? null));
}

/**
 * يحوّل مباراة يدوية كاملة إلى `MatchRecord` بالحالة التي يريدها المدير.
 * تُستخدم في مسارات القراءة لضمان ظهور السجل اليدوي حتى لو لم يُدمج في المخزن بعد
 * (نسخة باردة، أو قبل أول مزامنة).
 */
export function manualMatchAsRecord(recordId: string): MatchRecord | null {
  return findManualMatch(recordId) ? buildManualRecordCached(recordId) : null;
}

/** بناء السجل مع تخزين مؤقت بسيط بحسب وقت آخر تعديل (البناء رخيص لكن تكراري). */
const recordCache = new Map<string, { updatedAt: string; record: MatchRecord }>();

function buildManualRecordCached(recordId: string): MatchRecord | null {
  const record = findManualMatch(recordId);
  if (!record) return null;
  const cached = recordCache.get(record.id);
  if (cached && cached.updatedAt === record.updatedAt) return cached.record;
  const built = buildMatchRecordFromManual(record);
  recordCache.set(record.id, { updatedAt: record.updatedAt, record: built });
  return built;
}

/** يفرّغ المخزون المؤقت (الاختبارات والاستعادة). */
export function clearManualRecordCache(): void {
  recordCache.clear();
}

/** تسمية عربية لحالة سجل يدوي — تُستخدم في اللوحة. */
export function manualStatusLabel(status: ManualMatchStatus): string {
  return MANUAL_STATUS_LABEL_AR[status];
}
