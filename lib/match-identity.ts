import { CANONICAL_COMPETITIONS } from './catalog';
import { findVerifiedMatchMapping } from './nemo-resolver';
import { MatchRecord, MatchTeamSummary } from './types';

export type MatchExternalIds = MatchRecord['externalIds'];

/**
 * Prefer a real provider fixture identifier over a synthetic teams/date key. The explicit
 * bridge table lets the two known SportScore fixtures share their API-Football identity with
 * TheSportsDB/API-Football records, but only when source id, competition and ordered teams agree.
 */
export function getStableMatchId(input: {
  externalIds: MatchExternalIds;
  competitionCode: string;
  homeTeamId: string;
  awayTeamId: string;
  cairoDate: string;
  fallbackId?: string;
}): string {
  const mapping = findVerifiedMatchMapping({
    ...input.externalIds,
    competitionCode: input.competitionCode,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
  });
  if (mapping?.apiFootballFixtureId) {
    return `match-api-football-${mapping.apiFootballFixtureId}`;
  }

  if (input.externalIds.apiFootballFixtureId) {
    return `match-api-football-${input.externalIds.apiFootballFixtureId}`;
  }
  if (input.externalIds.thesportsdbEventId) {
    return `match-thesportsdb-${input.externalIds.thesportsdbEventId}`;
  }
  if (input.externalIds.footballDataMatchId) {
    return `match-football-data-${input.externalIds.footballDataMatchId}`;
  }
  if (input.externalIds.sportscoreTrackerId) {
    return `match-sportscore-${input.externalIds.sportscoreTrackerId}`;
  }

  // No provider fixture id was supplied. Preserve the existing internal id when migrating
  // old records; otherwise use a clearly synthetic fallback rather than pretending it is a
  // source-provided id. Provider adapters should fill externalIds whenever the source has one.
  if (input.fallbackId) return input.fallbackId;
  return [
    'match-synthetic',
    input.competitionCode.toLowerCase(),
    input.cairoDate,
    input.homeTeamId,
    input.awayTeamId,
  ].join('-');
}

function isCatalogTeamId(teamId: string): boolean {
  return !/^team-(ss|tsdb|fd|apif)-/.test(teamId);
}

function normalizeTeamKey(team: MatchRecord['homeTeam']): string {
  if (isCatalogTeamId(team.id)) return team.id;
  return `name:${team.nameEn.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')}`;
}

/**
 * Cross-source identity key: the same fixture reported by two providers (e.g. SportScore and
 * TheSportsDB) carries different provider ids, so an id-only upsert would store it twice. Same
 * competition + same Cairo date + same ordered teams (catalog id, or normalized English name
 * when the team is not in the catalog) is treated as one match and merged.
 */
export function buildMatchDedupKey(match: MatchRecord): string {
  return [
    match.competitionCode,
    match.kickoffConfirmed === true && Number.isFinite(Date.parse(match.utcKickoff)) ? new Date(match.utcKickoff).toISOString() : `unknown:${match.id}`,
    match.seasonLabel,
    normalizeTeamKey(match.homeTeam),
    normalizeTeamKey(match.awayTeam),
  ].join('|');
}

/* -------------------------------------------------------------------------------------------
 * Cross-source fixture identity (النسخة القوية)
 *
 * القاعدة السابقة (`buildMatchDedupKey`) كانت تشترط تطابقًا حرفيًا في البطولة والموعد
 * والملصم، فسقطت في الحالة الواقعية: نفس المباراة من مصدرين بمعرّف بطولة مختلف وموعد
 * يفرق عشر دقائق (`united-states-major-league-soccer` مقابل `tsdb-4346`) وملصم موسم فارغ
 * في أحدهما — فظهرت المباراة مرتين في الصفحة العامة.
 *
 * الطبقة هنا تحكم التكرار بحسب **هوية المباراة الحقيقية** لا بحسب نص الحقول:
 *   ① الفريقان بالترتيب نفسه (معرّف كتالوج، أو اسم مطبَّع تمامًا).
 *   ② البطولة: هوية مشتركة بين المزوّدين (كتالوج + مرادفات موثّقة)، وإلا فبطولتان
 *      غير معروفتين مع فارق زمني ضيق جدًا فقط.
 *   ③ النافذة الزمنية: نفس يوم القاهرة، وفارق انطلاق صغير (90 دقيقة كحد أقصى، و30 دقيقة
 *      عندما لا تتطابق هوية البطولة).
 * وتمنع بأربع بوابات صريحة: نتيجة نهائية متعارضة، أو فريقان مختلفان، أو بطولتان معروفتان
 * مختلفتان، أو فارق زمني أكبر من الحد — فلا دمج لمجرد تشابه أسماء الفرق.
 * ---------------------------------------------------------------------------------------- */

/** أقصى فارق انطلاق مقبول لمباراة واحدة يرويها مصدران (نفس البطولة). */
export const FIXTURE_KICKOFF_TOLERANCE_MINUTES = 90;
/** حدّ أضيق يُلزم وجوده عندما لا تتطابق هوية البطولة (بطولتان غير معروفتين في الكتالوج). */
export const FIXTURE_UNKNOWN_COMPETITION_TOLERANCE_MINUTES = 30;
/** عبور منتصف الليل: يختلف يوم القاهرة بين المصدرين لنفس الموعد — يُقبل بهذا الحد. */
export const FIXTURE_MIDNIGHT_TOLERANCE_MINUTES = 45;

/**
 * مرادفات أسماء البطولات بين المزوّدين. لا تُخترع منها أسماء: كل مدخل يجمع **نفس**
 * البطولة بأسماء مختلفة كما وردت من المصادر (مثبتة من مخرجات الإنتاج).
 */
const COMPETITION_NAME_EQUIVALENTS: Array<{ key: string; tests: Array<(name: string) => boolean> }> = [
  {
    key: 'alias:mls',
    tests: [
      (name) => /\bmls\b/.test(name),
      (name) => name.includes('major league soccer'),
      (name) => name.includes('american major league'),
      (name) => name.includes('united states major league'),
      (name) => name.includes('الدوري الامريكي للمحترفين'),
    ],
  },
];

/** تطبيع الاسم للمقارنة فقط — لا يُستخدم للعرض أبدًا. */
export function normalizeIdentityName(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFKC')
    .toLowerCase()
    // علامات التشكيل والتطويل العربية لا تميّز اسمًا عن آخر.
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
    .replace(/[’'`´]/g, '')
    // أي شيء ليس حرفًا أو رقمًا يصبح مسافة (فتتوحّد الشرطات والنقاط).
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** هوية الفريق: معرّف الكتالوج إن وُجد، وإلا الاسم الإنجليزي المطبَّع (ثم العربي). */
export function buildTeamIdentityKey(team: Pick<MatchTeamSummary, 'id' | 'nameEn' | 'nameAr'>): string {
  if (team.id && !/^team-(ss|tsdb|fd|apif)-/.test(team.id)) return `catalog:${team.id.toLowerCase()}`;
  const byEn = normalizeIdentityName(team.nameEn);
  if (byEn) return `name:${byEn}`;
  const byAr = normalizeIdentityName(team.nameAr);
  if (byAr) return `name-ar:${byAr}`;
  return `provider-id:${(team.id || '').toLowerCase()}`;
}

/** هوية البطولة عبر المزوّدين: كتالوج رسمي → مرادفات موثّقة → اسم مطبَّع → كود. */
export function buildCompetitionIdentityKey(input: {
  code?: string | null;
  nameEn?: string | null;
  nameAr?: string | null;
}): string {
  const code = (input.code || '').trim().toUpperCase();
  if (code) {
    const canonical = CANONICAL_COMPETITIONS.find((competition) => competition.code.toUpperCase() === code);
    if (canonical) return `catalog:${canonical.code}`;
  }
  const normalizedEn = normalizeIdentityName(input.nameEn);
  const normalizedAr = normalizeIdentityName(input.nameAr);
  for (const equivalent of COMPETITION_NAME_EQUIVALENTS) {
    if (
      equivalent.tests.some(
        (test) =>
          (normalizedEn && test(normalizedEn)) || (normalizedAr && test(normalizedAr))
      )
    ) {
      return equivalent.key;
    }
  }
  if (normalizedEn) return `name:${normalizedEn}`;
  if (normalizedAr) return `name-ar:${normalizedAr}`;
  return `code:${code || 'unknown'}`;
}

export interface FixtureMatchVerdict {
  /** هل السجلان يصفان المباراة نفسها؟ */
  same: boolean;
  /** مستوى الثقة — `strong` يعني عقدة فريقين + نافذة زمنية مطابقة للبطولة. */
  confidence: 'strong' | 'medium' | 'none';
  /** رمز قصير يُخزَّن في دليل الدمج ويُعرض للمراجعة. */
  reason: string;
  /** المعايير المتحققة: teams · competition · kickoff_window · cairo_date. */
  matchedOn: string[];
  kickoffDeltaMinutes: number | null;
  /** لماذا رُفض الدمج (فارغ عند القبول). */
  rejectedBy: string | null;
}

function parseKickoffMs(match: MatchRecord): number | null {
  const ms = Date.parse(match.utcKickoff);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * تعارض النتائج: مباراتان منتهيتان بنتيجتين مختلفتين ليستا مباراة واحدة (وميض بيانات أو
 * خطأ مصدر) — نرفض الدمج ونتركه للمراجعة بدل اختيار نتيجة قد تكون خاطئة.
 */
export function hasConflictingFinalScore(a: MatchRecord, b: MatchRecord): boolean {
  if (a.status !== 'finished' || b.status !== 'finished') return false;
  const comparable = (x: number | null, y: number | null) => x !== null && y !== null && x !== y;
  return comparable(a.score.home, b.score.home) || comparable(a.score.away, b.score.away);
}

/**
 * الحكم النهائي: هل السجلان مباراة واحدة؟ (دالة نقية بلا أي كتابة).
 */
export function compareFixtureIdentity(a: MatchRecord, b: MatchRecord): FixtureMatchVerdict {
  const none = (rejectedBy: string, extra: Partial<FixtureMatchVerdict> = {}): FixtureMatchVerdict => ({
    same: false,
    confidence: 'none',
    reason: rejectedBy,
    matchedOn: [],
    kickoffDeltaMinutes: null,
    rejectedBy,
    ...extra,
  });

  const sameTeams =
    buildTeamIdentityKey(a.homeTeam) === buildTeamIdentityKey(b.homeTeam) &&
    buildTeamIdentityKey(a.awayTeam) === buildTeamIdentityKey(b.awayTeam);
  if (!sameTeams) return none('different_teams');

  if (hasConflictingFinalScore(a, b)) return none('conflicting_final_score');

  const competitionA = buildCompetitionIdentityKey({
    code: a.competitionCode,
    nameEn: a.competitionNameEn,
    nameAr: a.competitionNameAr,
  });
  const competitionB = buildCompetitionIdentityKey({
    code: b.competitionCode,
    nameEn: b.competitionNameEn,
    nameAr: b.competitionNameAr,
  });
  const sameCompetition = competitionA === competitionB;
  const bothUnknownCompetition = !competitionA.startsWith('catalog:') && !competitionB.startsWith('catalog:');
  if (sameCompetition !== true && !bothUnknownCompetition) return none('different_known_competition');

  const kickoffA = parseKickoffMs(a);
  const kickoffB = parseKickoffMs(b);
  const confirmedA = a.kickoffConfirmed === true;
  const confirmedB = b.kickoffConfirmed === true;

  // بلا موعد مؤكد من أحد الطرفين: نكتفي باليوم نفسه وهوية بطولة متطابقة.
  if (!confirmedA || !confirmedB || kickoffA === null || kickoffB === null) {
    if (a.cairoDate !== b.cairoDate) return none('different_cairo_date');
    if (!sameCompetition) return none('unconfirmed_kickoff_without_competition_match');
    return {
      same: true,
      confidence: 'medium',
      reason: 'same_teams_same_day_unconfirmed_kickoff',
      matchedOn: ['teams', 'competition', 'cairo_date'],
      kickoffDeltaMinutes: null,
      rejectedBy: null,
    };
  }

  const deltaMinutes = Math.abs(kickoffA - kickoffB) / 60_000;
  const sameCairoDate = a.cairoDate === b.cairoDate;
  const tolerance = sameCompetition
    ? FIXTURE_KICKOFF_TOLERANCE_MINUTES
    : FIXTURE_UNKNOWN_COMPETITION_TOLERANCE_MINUTES;

  if (deltaMinutes > FIXTURE_KICKOFF_TOLERANCE_MINUTES) return none('kickoff_outside_tolerance');
  if (!sameCairoDate && deltaMinutes > FIXTURE_MIDNIGHT_TOLERANCE_MINUTES) {
    return none('different_cairo_date');
  }
  if (deltaMinutes > tolerance) return none('kickoff_outside_competition_tolerance');

  return {
    same: true,
    confidence: sameCompetition ? 'strong' : 'medium',
    reason: sameCompetition ? 'same_teams_competition_window' : 'same_teams_unknown_competition_window',
    matchedOn: [
      'teams',
      ...(sameCompetition ? ['competition'] : []),
      'kickoff_window',
      ...(sameCairoDate ? ['cairo_date'] : []),
    ],
    kickoffDeltaMinutes: Math.round(deltaMinutes),
    rejectedBy: null,
  };
}

export interface DuplicateFixtureGroup {
  /** معرّفات السجلات التي تصف المباراة نفسها، بترتيب ثابت. */
  ids: string[];
  /** نتيجة المقارنة بين أول سجلين (كل السجلات في المجموعة متكافئة بالعبور). */
  verdict: FixtureMatchVerdict;
}

/**
 * كل مجموعات السجلات التي تصف المباراة نفسها من مصدرين مختلفين (أو نفس المصدر بمعرّفين).
 * تُستخدم في الفحص الإداري والاختبارات وفي طبقة الدمج نفسها — مصدر حكم واحد لا نسختان.
 */
export function findDuplicateFixtureGroups(matches: MatchRecord[]): DuplicateFixtureGroup[] {
  const buckets = new Map<string, MatchRecord[]>();
  for (const match of matches) {
    const key = [
      buildTeamIdentityKey(match.homeTeam),
      buildTeamIdentityKey(match.awayTeam),
      match.cairoDate,
    ].join('|');
    const bucket = buckets.get(key);
    if (bucket) bucket.push(match);
    else buckets.set(key, [match]);
  }

  const groups: DuplicateFixtureGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const assigned = new Set<string>();
    for (let i = 0; i < bucket.length; i += 1) {
      if (assigned.has(bucket[i].id)) continue;
      const groupIds = [bucket[i].id];
      let verdict: FixtureMatchVerdict | null = null;
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (assigned.has(bucket[j].id)) continue;
        const comparison = compareFixtureIdentity(bucket[i], bucket[j]);
        if (!comparison.same) continue;
        groupIds.push(bucket[j].id);
        assigned.add(bucket[j].id);
        verdict = verdict ?? comparison;
      }
      if (groupIds.length > 1) {
        assigned.add(bucket[i].id);
        groups.push({
          ids: groupIds.sort(),
          verdict:
            verdict ?? {
              same: true,
              confidence: 'strong',
              reason: 'same_fixture',
              matchedOn: ['teams'],
              kickoffDeltaMinutes: null,
              rejectedBy: null,
            },
        });
      }
    }
  }
  return groups;
}

/* -------------------------------------------------------------------------------------------
 * Link-integrity audit
 *
 * A visitor landing on a match card must reach the page for THAT fixture. The failure mode this
 * catches is the one that actually happened: a stored record kept an old verified match slug, so
 * a new fixture between the same two clubs opened last season's page. Every check below is
 * derived from the stored record itself, so the audit runs offline against real data.
 * ---------------------------------------------------------------------------------------- */

export interface MatchLinkIntegrityIssue {
  matchId: string;
  code:
    | 'link_date_mismatch'
    | 'link_team_mismatch'
    | 'link_competition_mismatch'
    | 'duplicate_identity'
    | 'duplicate_fixture_across_sources'
    | 'missing_provider_id'
    | 'stale_upcoming'
    | 'live_outside_window';
  severity: 'error' | 'warning';
  messageAr: string;
}

export interface MatchLinkIntegrityReport {
  checked: number;
  linked: number;
  unlinked: number;
  issues: MatchLinkIntegrityIssue[];
  /**
   * مجموعات السجلات **غير المُعلَّمة بعد** التي تصف المباراة نفسها من مصدرين مختلفين.
   * تُملأ من نفس حكم المطابقة المستخدم في الدمج (`compareFixtureIdentity`).
   */
  unresolvedDuplicateGroups: DuplicateFixtureGroup[];
  /** عدد السجلات التي سبق إثبات أنها تكرار وأُدمجت منطقيًا (`duplicateOfId`). */
  mergedDuplicates: number;
}

/** Days after which a "not started" match is stale data rather than an upcoming fixture. */
export const STALE_UPCOMING_DAYS = 45;

/**
 * Verifies that every stored match's identity and its NEMO Sports link describe the same
 * fixture. Returns a report; it never mutates the store.
 */
export function auditMatchLinkIntegrity(
  matches: MatchRecord[],
  today: Date = new Date()
): MatchLinkIntegrityReport {
  const issues: MatchLinkIntegrityIssue[] = [];
  const seenIdentity = new Map<string, string>();
  let linked = 0;

  /**
   * فحص التكرار عبر المصادر: يُطبَّق على السجلات **غير المُعلَّمة** فقط، لأن السجل المُعلَّم
   * بـ`duplicateOfId` هو تكرار مثبت ومعالج (يُستبعد من العرض وتُحوَّل صفحته إلى السجل
   * الأساسي). هكذا يبقى الفحص إنذارًا حقيقيًا على ما لم يُعالَج بعد، لا ضجيجًا دائمًا.
   */
  const unmarked = matches.filter((match) => !match.duplicateOfId);
  const unresolvedDuplicateGroups = findDuplicateFixtureGroups(unmarked);
  const mergedDuplicates = matches.length - unmarked.length;
  for (const group of unresolvedDuplicateGroups) {
    for (const matchId of group.ids) {
      issues.push({
        matchId,
        code: 'duplicate_fixture_across_sources',
        severity: 'error',
        messageAr: `المباراة نفسها موجودة في ${group.ids.length} سجلات (${group.ids.join('، ')}) — نفس الفريقين ونافذة انطلاق متطابقة بفارق ${
          group.verdict.kickoffDeltaMinutes ?? 0
        } دقيقة.`,
      });
    }
  }

  for (const match of matches) {
    const ids = match.externalIds || {};
    const hasProviderId = Boolean(
      ids.apiFootballFixtureId ||
        ids.thesportsdbEventId ||
        ids.footballDataMatchId ||
        ids.sportscoreTrackerId
    );
    if (!hasProviderId) {
      issues.push({
        matchId: match.id,
        code: 'missing_provider_id',
        severity: 'warning',
        messageAr: 'لا يحمل معرّفًا من أي مزوّد؛ الهوية مشتقة من الفرق والتاريخ فقط.',
      });
    }

    const identityKey = [
      match.competitionCode,
      match.seasonLabel,
      match.homeTeam.id,
      match.awayTeam.id,
      match.utcKickoff,
    ].join('|');
    const previous = seenIdentity.get(identityKey);
    if (previous && previous !== match.id) {
      issues.push({
        matchId: match.id,
        code: 'duplicate_identity',
        severity: 'error',
        messageAr: `سجل مكرر لنفس المباراة (معرّف آخر: ${previous}).`,
      });
    } else {
      seenIdentity.set(identityKey, match.id);
    }

    if (match.nemoLink?.url) {
      linked += 1;
      const entry = findVerifiedMatchMapping({
        ...ids,
        competitionCode: match.competitionCode,
        homeTeamId: match.homeTeam.id,
        awayTeamId: match.awayTeam.id,
      });
      if (entry) {
        if (entry.cairoDate !== match.cairoDate) {
          issues.push({
            matchId: match.id,
            code: 'link_date_mismatch',
            severity: 'error',
            messageAr: `الرابط موثّق لمباراة ${entry.cairoDate} بينما السجل بتاريخ ${match.cairoDate}؛ يجب ألا يفتح الزائر صفحة مباراة قديمة.`,
          });
        }
        if (entry.homeTeamId !== match.homeTeam.id || entry.awayTeamId !== match.awayTeam.id) {
          issues.push({
            matchId: match.id,
            code: 'link_team_mismatch',
            severity: 'error',
            messageAr: 'الفريقان في السجل لا يطابقان الفريقين الموثّقين للرابط.',
          });
        }
        if (entry.competitionCode !== match.competitionCode) {
          issues.push({
            matchId: match.id,
            code: 'link_competition_mismatch',
            severity: 'error',
            messageAr: 'البطولة في السجل لا تطابق البطولة الموثّقة للرابط.',
          });
        }
      }
    }

    const kickoffMs = Date.parse(match.utcKickoff);
    if (Number.isFinite(kickoffMs)) {
      const daysSince = (today.getTime() - kickoffMs) / 86_400_000;
      if (match.status === 'not_started' && daysSince > STALE_UPCOMING_DAYS) {
        issues.push({
          matchId: match.id,
          code: 'stale_upcoming',
          severity: 'warning',
          messageAr: `مباراة معروضة كـ«لم تبدأ» رغم مرور ${Math.floor(daysSince)} يومًا على موعدها.`,
        });
      }
      if (match.status === 'live' && (daysSince > 1 || daysSince < -1)) {
        issues.push({
          matchId: match.id,
          code: 'live_outside_window',
          severity: 'error',
          messageAr: 'مباراة معروضة كجارية خارج نافذة المباراة المعقولة.',
        });
      }
    }
  }

  return {
    checked: matches.length,
    linked,
    unlinked: matches.length - linked,
    issues,
    unresolvedDuplicateGroups,
    mergedDuplicates,
  };
}

/** Errors only — the subset that must block a release. */
export function blockingLinkIssues(report: MatchLinkIntegrityReport): MatchLinkIntegrityIssue[] {
  return report.issues.filter((issue) => issue.severity === 'error');
}
