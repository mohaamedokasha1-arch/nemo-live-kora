import { mergeMatchRecords } from '../db/seed-data';
import { translateGlobalCompetitionAr } from '../catalog';
import { buildTeamIdentityKey, compareFixtureIdentity, findDuplicateFixtureGroups } from '../match-identity';
import type { MatchRecord, SourceId } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  توحيد المباراة الواحدة القادمة من أكثر من مصدر (بلا حذف أي سجل)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  المُشكلة الواقعية التي تحلّها هذه الطبقة: المباراة نفسها يرويها SportScore
 *  وTheSportsDB بمعرّفين واسم بطولة وموعد مختلفين بعشر دقائق، فيُنشأ لها سجلان في
 *  المخزن فتظهر **مرتين** في الصفحة العامة (Chicago Fire ضد Philadelphia Union،
 *  FC Dallas ضد Seattle Sounders — 2026-10-15).
 *
 *  القاعدة المتبعة هنا: **لا حذف أبدًا**.
 *   ① يُختار سجل أساسي واحد بقواعد ثابتة قابلة للتفسير (أولوية المصدر ← الأحدث ← المعرّف).
 *   ② تُدمج في السجل الأساسي معرّفات المصادر وحقول المصدر الناقصة (الملعب، الموسم…)
 *      مع تسجيل مصدر كل حقل (`fieldProvenance`).
 *   ③ يبقى السجل الآخر في المخزن كاملًا كما ورد من مصدره، ويُعلَّم فقط
 *      بـ`duplicateOfId` كي يُستبعد من العرض وتُحوَّل صفحته إلى السجل الأساسي.
 *  والنتيجة: لا يفقد المصدر بياناته، ولا يرى الزائر تكرارًا، ولا ينكسر أي رابط قائم.
 */

export interface FixtureConsolidationOptions {
  /** رتبة المصدر الفعلية (يضبطها المدير من اللوحة؛ الأصغر = أعلى أولوية). */
  sourceRank: (sourceId: SourceId) => number;
  /**
   * هل السجل مجمَّد/مثبَّت يدويًا؟ السجل المجمَّد لا يُعلَّم كتكرار ولا يُخفي عن المدير؛
   * تُبلَّغ الحالة للمراجعة بدل التصرّف تلقائيًا.
   */
  isFrozen?: (matchId: string) => boolean;
  /** وقت الدمج الذي يُسجَّل في دليل الدمج. */
  now?: Date;
  /** تعطيل الكتابة (يُستخدم في الفحص فقط). */
  dryRun?: boolean;
}

export interface ConsolidatedFixtureGroup {
  survivorId: string;
  survivorSource: SourceId;
  duplicateIds: string[];
  reason: string;
  matchedOn: string[];
  kickoffDeltaMinutes: number | null;
  /** مجموعة تحتاج قرارًا بشريًا (سجل يدوي/مجمَّد أو تعارض) ولم تُعدَّل. */
  requiresReview: boolean;
  reviewReasonAr: string | null;
}

export interface FixtureConsolidationReport {
  /** عدد المجموعات التي وُجدت فيها مباراة مكررة. */
  groups: number;
  /** عدد السجلات التي عُلِّمت كتكرار في هذه الجولة. */
  markedDuplicates: number;
  /** عدد السجلات التي كانت مُعلَّمة من قبل وأُعيد توجيهها إلى السجل الأساسي الجديد. */
  repointedDuplicates: number;
  /** المجموعات التي تحتاج مراجعة بشرية. */
  requiresReview: ConsolidatedFixtureGroup[];
  consolidated: ConsolidatedFixtureGroup[];
}

function parseMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/** ترتيب ثابت لاختيار السجل الأساسي: رتبة المصدر ← الأحدث ← المعرّف أبجديًا. */
function pickSurvivor(group: MatchRecord[], sourceRank: (sourceId: SourceId) => number): MatchRecord {
  return [...group].sort((a, b) => {
    const rankA = sourceRank(a.primarySource);
    const rankB = sourceRank(b.primarySource);
    if (rankA !== rankB) return rankA - rankB;
    const updatedA = parseMs(a.lastUpdatedAt);
    const updatedB = parseMs(b.lastUpdatedAt);
    if (updatedA !== updatedB) return updatedB - updatedA;
    return a.id.localeCompare(b.id);
  })[0];
}

const GENERIC_COUNTRIES = new Set(['دولي', 'global', 'world', '']);

/**
 * حقل العرض العربي: نأخذ القيمة العربية إن كانت الأخرى لاتينية/عامة.
 * لا اختراع: القيمة البديلة موجودة فعلًا في السجل الآخر أو مشتقة من قاموس الترجمة المعتمد.
 */
function preferLocalizedCountry(current: string, candidate: string): string {
  const currentGeneric = GENERIC_COUNTRIES.has((current || '').trim().toLowerCase());
  const candidateGeneric = GENERIC_COUNTRIES.has((candidate || '').trim().toLowerCase());
  if (currentGeneric && !candidateGeneric) return candidate;
  return current;
}

function hasArabicLetters(value: string | null | undefined): boolean {
  return /[\u0600-\u06FF]/.test(value || '');
}

/**
 * دمج سجل تكرار داخل السجل الأساسي:
 *  • معرّفات المصادر والمساهمون = اتحاد الاثنين (لا يُفقد معرّف أي مصدر).
 *  • الحقول الناقصة (ملعب/موسم/جولة) تُملأ من السجل الآخر مع تسجيل المنشأ.
 *  • الحالة والنتيجة تُؤخذ من الأحدث فقط إذا كان السجل الآخر متقدمًا فعلًا، والقواعد
 *    الداخلية لـ`mergeMatchRecords` تمنع ارتداد مباراة منتهية إلى «لم تبدأ».
 *  • هوية البطولة وكودها وترتيبها تبقى للسجل الأساسي (ثبات الروابط والتصفية).
 */
export function mergeDuplicateIntoSurvivor(survivor: MatchRecord, duplicate: MatchRecord): MatchRecord {
  const merged = mergeMatchRecords(survivor, duplicate);
  const competitionDisplayAr =
    !hasArabicLetters(merged.competitionNameAr) && hasArabicLetters(duplicate.competitionNameAr)
      ? duplicate.competitionNameAr
      : merged.competitionNameAr;

  /**
   * الاسم العربي للبطولة يُشتق من قاموس الترجمة المعتمد عند تطابقه (مثل الدوري الأمريكي)،
   * ولا يُغيّر شيئًا لبطولة لا يعرفها القاموس: القيمة الأصلية تبقى كما وردت.
   */
  const translated = translateGlobalCompetitionAr(
    merged.competitionNameEn || merged.competitionNameAr,
    undefined
  );
  const translationKnown = hasArabicLetters(translated.nameAr);
  const countryAr = (() => {
    const preferred = preferLocalizedCountry(merged.countryAr || '', duplicate.countryAr || '');
    if (translationKnown && !hasArabicLetters(preferred)) return translated.countryAr;
    return preferred;
  })();

  return {
    ...merged,
    id: survivor.id,
    // هوية البطولة تبقى كما هي في السجل الأساسي — لا تتغيّر روابط ولا تصفية.
    competitionId: survivor.competitionId,
    competitionCode: survivor.competitionCode,
    competitionNameEn: survivor.competitionNameEn,
    region: survivor.region,
    priority: survivor.priority,
    competitionNameAr: hasArabicLetters(competitionDisplayAr)
      ? competitionDisplayAr
      : translationKnown
      ? translated.nameAr
      : competitionDisplayAr,
    competitionLogo: survivor.competitionLogo || merged.competitionLogo,
    countryAr,
    // ملصق الموسم والجولة: يُملأ من السجل الآخر عند غيابه — نفس المباراة ونفس البطولة.
    seasonLabel: survivor.seasonLabel || duplicate.seasonLabel || merged.seasonLabel,
    roundLabelAr: survivor.roundLabelAr || duplicate.roundLabelAr || merged.roundLabelAr,
    /**
     * رابط NEMO موثّق في السجل الأساسي لا يُستبدل بردّ غير موثّق من السجل الآخر.
     * والقراءة محميّة من سجل ناقص: دمجٌ ينهار على حقل غائب يُسقط المزامنة كلها، وهو أسوأ
     * من نقص حقل واحد — فلا يصل هنا أي استثناء بسبب رابط غير موجود.
     */
    nemoLink: survivor.nemoLink?.verified ? survivor.nemoLink : merged.nemoLink ?? survivor.nemoLink,
    duplicateOfId: null,
    duplicateEvidence: null,
  };
}

function buildEvidence(
  survivor: MatchRecord,
  verdict: ReturnType<typeof compareFixtureIdentity>,
  now: Date
): NonNullable<MatchRecord['duplicateEvidence']> {
  return {
    survivorId: survivor.id,
    survivorSource: survivor.primarySource,
    reason: verdict.reason,
    matchedOn: verdict.matchedOn,
    kickoffDeltaMinutes: verdict.kickoffDeltaMinutes,
    requiresReview: verdict.confidence !== 'strong',
    resolvedAt: now.toISOString(),
  };
}

/**
 * تُنفَّذ بعد كل كتابة للمخزن (رفع المصادر أو دمج طبقة الإدارة). الدالة **idempotent**:
 * تشغيلها مرارًا على نفس البيانات لا يغيّر شيئًا.
 */
export function consolidateDuplicateFixtures(
  matches: MatchRecord[],
  options: FixtureConsolidationOptions
): { matches: MatchRecord[]; report: FixtureConsolidationReport } {
  const now = options.now ?? new Date();
  const byId = new Map(matches.map((match) => [match.id, match]));
  const report: FixtureConsolidationReport = {
    groups: 0,
    markedDuplicates: 0,
    repointedDuplicates: 0,
    requiresReview: [],
    consolidated: [],
  };

  // ⓪ شفاء ذاتي: سجل مُعلَّم كتكرار اختفى سجله الأساسي (استعادة لقطة قديمة/تنظيف يدوي) —
  // يُعاد سجلًا نشطًا بدل أن تختفي مباراة من الموقع بلا سبب ظاهر.
  const orphans = matches.filter((match) => match.duplicateOfId && !byId.has(match.duplicateOfId));
  for (const orphan of orphans) {
    if (options.dryRun) continue;
    const healed: MatchRecord = { ...orphan, duplicateOfId: null, duplicateEvidence: null };
    byId.set(orphan.id, healed);
    matches = matches.map((match) => (match.id === orphan.id ? healed : match));
    report.repointedDuplicates += 1;
  }

  // ① المجموعات تُحسب على السجلات غير المُعلَّمة فقط (المُعلَّم مُعالج سابقًا).
  const unmarked = matches.filter((match) => !match.duplicateOfId);
  const groups = findDuplicateFixtureGroups(unmarked);
  report.groups = groups.length;
  if (groups.length === 0) {
    return {
      matches: report.repointedDuplicates > 0 ? Array.from(byId.values()) : matches,
      report,
    };
  }

  const duplicateAssignments = new Map<string, string>();

  for (const group of groups) {
    const records = group.ids.map((id) => byId.get(id)).filter((record): record is MatchRecord => Boolean(record));
    if (records.length < 2) continue;

    // سجل إداري يدوي: لا نُخفي عمل المدير ولا نُخضعه لقواعد المصادر.
    const manual = records.find((record) => record.origin === 'manual');
    if (manual) {
      report.requiresReview.push({
        survivorId: manual.id,
        survivorSource: manual.primarySource,
        duplicateIds: records.filter((record) => record.id !== manual.id).map((record) => record.id),
        reason: group.verdict.reason,
        matchedOn: group.verdict.matchedOn,
        kickoffDeltaMinutes: group.verdict.kickoffDeltaMinutes,
        requiresReview: true,
        reviewReasonAr:
          'إحدى المباريات مُدخلة من لوحة الإدارة لنفس الفريقين واليوم — تحتاج قرار المدير قبل أي دمج.',
      });
      continue;
    }

    const survivor = pickSurvivor(records, options.sourceRank);
    const losers = records
      .filter((record) => record.id !== survivor.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    const frozenLosers = losers.filter((record) => options.isFrozen?.(record.id));
    if (frozenLosers.length > 0) {
      report.requiresReview.push({
        survivorId: survivor.id,
        survivorSource: survivor.primarySource,
        duplicateIds: frozenLosers.map((record) => record.id),
        reason: group.verdict.reason,
        matchedOn: group.verdict.matchedOn,
        kickoffDeltaMinutes: group.verdict.kickoffDeltaMinutes,
        requiresReview: true,
        reviewReasonAr:
          'سجل مجمَّد يدويًا يشبه سجلًا آخر لنفس المباراة — لم يُخفَ عن اللوحة، ويحتاج تأكيد المدير.',
      });
    }

    const markable = losers.filter((record) => !options.isFrozen?.(record.id));
    if (markable.length === 0) continue;

    let merged = survivor;
    for (const loser of markable) {
      merged = mergeDuplicateIntoSurvivor(merged, loser);
    }
    const evidence = buildEvidence(survivor, group.verdict, now);
    if (!options.dryRun) {
      merged = { ...merged, duplicateOfId: null, duplicateEvidence: null };
      byId.set(survivor.id, merged);
      for (const loser of markable) {
        duplicateAssignments.set(loser.id, survivor.id);
        const marked: MatchRecord = {
          ...loser,
          duplicateOfId: survivor.id,
          duplicateEvidence: evidence,
        };
        byId.set(loser.id, marked);
        report.markedDuplicates += 1;
      }
    }
    report.consolidated.push({
      survivorId: survivor.id,
      survivorSource: survivor.primarySource,
      duplicateIds: markable.map((record) => record.id),
      reason: group.verdict.reason,
      matchedOn: group.verdict.matchedOn,
      kickoffDeltaMinutes: group.verdict.kickoffDeltaMinutes,
      requiresReview: group.verdict.confidence !== 'strong',
      reviewReasonAr:
        group.verdict.confidence === 'strong'
          ? null
          : 'تطابق الفريقين واليوم دون تطابق هوية البطولة (بطولتان غير معروفتين في الكتالوج) — راجع البطولة.',
    });
  }

  // ② إعادة توجيه أي سجل مُعلَّم سابقًا إلى السجل الأساسي الجديد حين يتغيّر.
  if (!options.dryRun) {
    for (const [duplicateId, survivorId] of duplicateAssignments) {
      const record = byId.get(duplicateId);
      if (!record || record.duplicateOfId === survivorId) continue;
      byId.set(duplicateId, { ...record, duplicateOfId: survivorId });
      report.repointedDuplicates += 1;
    }
    // ③ مجموعة انقسمت: نسجّل فقط أن السجل الأساسي تغيّر — بلا حذف أي سجل.
    for (const match of matches) {
      if (!match.duplicateOfId) continue;
      const survivor = byId.get(match.duplicateOfId);
      if (survivor && survivor.duplicateOfId) {
        byId.set(match.id, { ...match, duplicateOfId: survivor.duplicateOfId });
        report.repointedDuplicates += 1;
      }
    }
  }

  const hasChanges = report.markedDuplicates > 0 || report.repointedDuplicates > 0;
  return {
    matches: hasChanges ? Array.from(byId.values()) : matches,
    report,
  };
}

/** هل هذا السجل تكرار مثبت لمباراة موجودة في سجل آخر؟ */
export function isDuplicateFixtureRecord(match: Pick<MatchRecord, 'duplicateOfId'>): boolean {
  return Boolean(match.duplicateOfId);
}

/**
 * السجلات التي تُعرض للزائر وتُعدّ في الإحصاءات: كل مباراة مرة واحدة.
 * تُستخدم في كل مسار قراءة حتى لا يظهر سجل مُعلَّم كتكرار في الجدول أو الخريطة.
 */
export function activeMatches(matches: readonly MatchRecord[]): MatchRecord[] {
  return matches.filter((match) => !match.duplicateOfId);
}

/** تشخيص جاهز للعرض: سبب استبعاد السجل من العرض. */
export function describeDuplicateAr(match: MatchRecord): string | null {
  if (!match.duplicateOfId) return null;
  const evidence = match.duplicateEvidence;
  const basis = evidence
    ? `نفس الفريقين بنفس اليوم (${evidence.matchedOn.join('، ')}${
        evidence.kickoffDeltaMinutes !== null ? ` — فارق ${evidence.kickoffDeltaMinutes} دقيقة` : ''
      })`
    : 'نفس الفريقين بنفس اليوم';
  return `تكرار مثبت لمباراة واحدة: ${basis}. السجل الأساسي: ${match.duplicateOfId} (مصدره ${
    evidence?.survivorSource ?? 'غير معروف'
  }). بيانات هذا السجل محفوظة كما وردت ولم تُحذف، وصفحته تحوّل الزائر إلى السجل الأساسي.`;
}

export { buildTeamIdentityKey };
