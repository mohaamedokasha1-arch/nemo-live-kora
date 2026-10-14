/**
 * مقارنة تغطية المباريات: مرجع خارجي مقابل سجلات الموقع — دالة نقية بلا شبكة ولا تخزين.
 *
 * المدخلات يبنيها المحوّلون (`reference-*.ts`) وتُعطى هنا كما هي، فتُختبر المنطقة كلها بمدخلات
 * اصطناعية معلومة النتيجة. لا تُخمّن الدالة شيئًا: مباراة لا تطابق بالمفتاح الدقيق أو بالاسم
 * المتشابه تبقى «ناقصة»، ووقت أو نتيجة غير مؤكدة لا تُقارَن.
 */

export type CoverageStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled'
  | 'suspended'
  | 'unknown';

/** مباراة من المرجع الخارجي كما يصفها المصدر (بعد التحويل إلى الحقول الموحّدة). */
export interface ReferenceMatch {
  /** معرّف المصدر المرجعي الذي أتت منه المباراة (للتقرير). */
  source: string;
  /** معرّف المباراة لدى المرجع، مع اسم المفتاح الذي يقابله في سجلات الموقع (مثل footballDataMatchId). */
  externalRef?: { key: string; value: string };
  competitionCode?: string;
  competitionName: string;
  /** التاريخ بتوقيت القاهرة YYYY-MM-DD. */
  cairoDate: string;
  /** وقت البداية بصيغة ISO فقط عند تأكيد المصدر له؛ وإلا null. */
  utcKickoff: string | null;
  homeName: string;
  awayName: string;
  /** الحالة كما وردت من المرجع (تُطبَّع في الدالة). */
  status?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
}

/** صورة من سجل الموقع تكفي للمقارنة. */
export interface CoverageSiteMatch {
  id: string;
  competitionCode: string;
  competitionNameAr: string;
  competitionNameEn: string;
  cairoDate: string;
  utcKickoff: string;
  kickoffConfirmed: boolean;
  homeNames: string[];
  awayNames: string[];
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  externalIds: Record<string, string | undefined>;
  /** المصادر التي غذّت السجل — يُستخدم للتحذير من أن المرجع نفسه مصدر للموقع. */
  contributingSources: string[];
}

export interface CoverageWindow {
  from: string;
  to: string;
}

export interface CoverageOptions {
  /** فرق الوقت المسموح به بالدقائق قبل اعتباره اختلافًا. */
  timeToleranceMinutes?: number;
  /** حد تشابه أسماء الفرق (0..1) لاعتبار اسمين متشابهين. */
  nameSimilarityThreshold?: number;
}

export type CoverageIssueKind =
  | 'missing_match'
  | 'missing_competition'
  | 'team_name_difference'
  | 'time_mismatch'
  | 'status_mismatch'
  | 'score_mismatch'
  | 'score_missing_on_site'
  | 'reversed_orientation'
  | 'duplicate_site_record'
  | 'id_conflict'
  | 'site_only';

export interface CoverageIssue {
  kind: CoverageIssueKind;
  cairoDate: string;
  competition: string;
  home: string;
  away: string;
  siteMatchId?: string;
  siteMatchIds?: string[];
  referenceSource?: string;
  detail: string;
}

export interface CoverageDateRow {
  cairoDate: string;
  reference: number;
  matched: number;
  missing: number;
  siteOnly: number;
  coveragePct: number | null;
}

export interface CoverageReport {
  generatedAt: string;
  window: CoverageWindow;
  referenceSources: string[];
  /** true عند تشابه مصدر المرجع مع مصدر يغذي الموقع: التغطية حينها تقيس الاتساق لا الاستقلال. */
  referenceFeedsSite: boolean;
  summary: {
    referenceTotal: number;
    referenceOutOfWindow: number;
    siteTotalInWindow: number;
    matched: number;
    matchedExact: number;
    missing: number;
    siteOnly: number;
    coveragePct: number | null;
    competitionsInReference: number;
    competitionsMissing: number;
  };
  perDate: CoverageDateRow[];
  issues: CoverageIssue[];
}

const DEFAULTS: Required<CoverageOptions> = {
  timeToleranceMinutes: 5,
  nameSimilarityThreshold: 0.5,
};

/* ---------------- تطبيع الأسماء ---------------- */

/** كلمات عامة تُحذف قبل المقارنة (لا تُغيّر هوية النادي). */
const GENERIC_TOKENS = new Set(['fc', 'sc', 'cf', 'afc', 'ac', 'club', 'the', 'نادي']);

/** يوحّد الهمزات والتاء المربوطة والألف المقصورة والتطويل، ثم يحوّل إلى كلمات صغيرة. */
export function normalizeNameTokens(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !GENERIC_TOKENS.has(token));
}

export function normalizeName(value: string): string {
  return normalizeNameTokens(value).join(' ');
}

/**
 * تشابه بين اسمين: 1 عند التطابق بعد التطبيع، وإلا مؤشر جاكار على الكلمات، مع اعتبار
 * الاحتواء الكامل لمجموعة الكلمات تشابهًا ("الأهلي" ↔ "الأهلي المصري" مثلًا).
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = normalizeNameTokens(a);
  const tb = normalizeNameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  if (ta.join(' ') === tb.join(' ')) return 1;
  const sa = new Set(ta);
  const sb = new Set(tb);
  const intersection = [...sa].filter((token) => sb.has(token)).length;
  const union = new Set([...sa, ...sb]).size;
  const jaccard = intersection / union;
  // الاحتواء الكامل لكلمات الاسم القصير (مثل «الأهلي» ↔ «الأهلي المصري») تشابه قوي لكنه ليس تطابقًا.
  const containment = intersection === Math.min(sa.size, sb.size) ? 0.9 : 0;
  return Math.max(jaccard, containment);
}

function bestNameSimilarity(candidates: string[], target: string): number {
  let best = 0;
  for (const candidate of candidates) {
    best = Math.max(best, nameSimilarity(candidate, target));
  }
  return best;
}

/* ---------------- الحالة والتوقيت ---------------- */

/**
 * يطبّع حالة من المرجع (Football-Data: SCHEDULED/TIMED/IN_PLAY/PAUSED/FINISHED/POSTPONED/
 * SUSPENDED/CANCELLED…) أو من الموقع (not_started/live/finished/postponed/cancelled/suspended/
 * unconfirmed). «unconfirmed» وأي قيمة مجهولة تعود `unknown` ولا تُقارن.
 */
export function normalizeStatus(raw: string | null | undefined): CoverageStatus {
  const value = (raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!value) return 'unknown';
  if (['SCHEDULED', 'TIMED', 'NOT_STARTED', 'NS'].includes(value)) return 'scheduled';
  if (['IN_PLAY', 'PAUSED', 'LIVE', 'HALF_TIME', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'].includes(value)) {
    return 'live';
  }
  if (['FINISHED', 'FT', 'AET', 'PEN', 'AWARDED'].includes(value)) return 'finished';
  if (['POSTPONED', 'DELAYED'].includes(value)) return 'postponed';
  if (['CANCELLED', 'CANCELED'].includes(value)) return 'cancelled';
  if (['SUSPENDED', 'STOPPED'].includes(value)) return 'suspended';
  return 'unknown';
}

function siteStatusOf(match: CoverageSiteMatch): CoverageStatus {
  return normalizeStatus(match.status);
}

/* ---------------- المفاتيح والتطابق ---------------- */

/**
 * البطولة تتطابق بالرمز المشترك أو باسم مطابق بعد التطبيع فقط. لا يُكتفى بالاحتواء الجزئي:
 * «Premier League» لا تعني «الدوري المصري الممتاز».
 */
export function sameCompetition(reference: ReferenceMatch, site: CoverageSiteMatch): boolean {
  if (reference.competitionCode && site.competitionCode && reference.competitionCode === site.competitionCode) {
    return true;
  }
  const refName = normalizeName(reference.competitionName);
  if (!refName) return false;
  return [site.competitionNameEn, site.competitionNameAr]
    .filter(Boolean)
    .some((name) => normalizeName(name) === refName);
}

function pairOrientation(
  reference: ReferenceMatch,
  site: CoverageSiteMatch,
  threshold: number
): 'exact' | 'similar' | 'reversed' | null {
  const homeScore = bestNameSimilarity(site.homeNames, reference.homeName);
  const awayScore = bestNameSimilarity(site.awayNames, reference.awayName);
  const reversedHome = bestNameSimilarity(site.homeNames, reference.awayName);
  const reversedAway = bestNameSimilarity(site.awayNames, reference.homeName);
  if (homeScore === 1 && awayScore === 1) return 'exact';
  if (homeScore >= threshold && awayScore >= threshold) return 'similar';
  if (reversedHome >= threshold && reversedAway >= threshold) return 'reversed';
  return null;
}

function kickoffMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/* ---------------- المقارنة ---------------- */

export function compareCoverage(input: {
  window: CoverageWindow;
  reference: ReferenceMatch[];
  site: CoverageSiteMatch[];
  generatedAt?: string;
  options?: CoverageOptions;
}): CoverageReport {
  const options = { ...DEFAULTS, ...(input.options || {}) };
  const { window } = input;
  const inWindow = (date: string) => date >= window.from && date <= window.to;

  const reference = input.reference.filter((match) => inWindow(match.cairoDate));
  const referenceOutOfWindow = input.reference.length - reference.length;
  const site = input.site.filter((match) => inWindow(match.cairoDate));

  const issues: CoverageIssue[] = [];
  const usedSite = new Set<string>();
  const matchedSiteIds = new Set<string>();
  let matchedExact = 0;
  let matched = 0;
  const missingByDate = new Map<string, number>();
  const matchedByDate = new Map<string, number>();
  const refByDate = new Map<string, number>();

  for (const ref of reference) {
    refByDate.set(ref.cairoDate, (refByDate.get(ref.cairoDate) || 0) + 1);
    const label = { cairoDate: ref.cairoDate, competition: ref.competitionName, home: ref.homeName, away: ref.awayName, referenceSource: ref.source };

    // 1) المعرّف الخارجي نفسه (أدق دليل). لو وُجد سجل بالمعرّف لكن بفريق/تاريخ مختلف → ربط خاطئ.
    let chosen: { site: CoverageSiteMatch; orientation: 'exact' | 'similar' | 'reversed' } | null = null;
    if (ref.externalRef) {
      const byId = site.find(
        (candidate) =>
          !usedSite.has(candidate.id) &&
          candidate.externalIds[ref.externalRef!.key] === ref.externalRef!.value
      );
      if (byId) {
        const orientation = pairOrientation(ref, byId, options.nameSimilarityThreshold);
        if (orientation && byId.cairoDate === ref.cairoDate) {
          chosen = { site: byId, orientation };
        } else {
          issues.push({
            ...label,
            kind: 'id_conflict',
            siteMatchId: byId.id,
            detail: `المعرّف ${ref.externalRef.key}=${ref.externalRef.value} يشير في الموقع إلى مباراة بفريقين أو تاريخ مختلفين (${byId.cairoDate}).`,
          });
          usedSite.add(byId.id);
        }
      }
    }

    // 2) مطابقة بالتاريخ + البطولة + الفريقين (ترتيب مطابق أولًا، ثم متشابه، ثم معكوس).
    if (!chosen) {
      const candidates = site.filter(
        (candidate) =>
          candidate.cairoDate === ref.cairoDate &&
          !usedSite.has(candidate.id) &&
          sameCompetition(ref, candidate)
      );
      const scored = candidates
        .map((candidate) => ({ candidate, orientation: pairOrientation(ref, candidate, options.nameSimilarityThreshold) }))
        .filter((entry): entry is { candidate: CoverageSiteMatch; orientation: 'exact' | 'similar' | 'reversed' } => entry.orientation !== null);
      const rank = { exact: 0, similar: 1, reversed: 2 } as const;
      scored.sort((a, b) => rank[a.orientation] - rank[b.orientation]);
      if (scored[0]) chosen = { site: scored[0].candidate, orientation: scored[0].orientation };
    }

    if (!chosen) {
      missingByDate.set(ref.cairoDate, (missingByDate.get(ref.cairoDate) || 0) + 1);
      // هل توجد مباراة للفريقين لكن بتهجئة مختلفة؟ تُرفع كـ«اختلاف اسم» لا كغياب كامل.
      const nameCandidate = site.find(
        (candidate) =>
          candidate.cairoDate === ref.cairoDate &&
          !usedSite.has(candidate.id) &&
          sameCompetition(ref, candidate) &&
          (bestNameSimilarity(candidate.homeNames, ref.homeName) >= options.nameSimilarityThreshold ||
            bestNameSimilarity(candidate.awayNames, ref.awayName) >= options.nameSimilarityThreshold)
      );
      // كل مباراة غير مطابقة تُحسب ناقصة (تتساوى مع الملخص). إن وُجد سجل قريب بنفس البطولة
      // والتاريخ وفريق واحد على الأقل بتهجئة متشابهة، يُذكر كدليل للتدقيق لا كمطابقة.
      issues.push({
        ...label,
        kind: 'missing_match',
        ...(nameCandidate ? { siteMatchId: nameCandidate.id } : {}),
        detail: nameCandidate
          ? `لا توجد مطابقة كاملة في الموقع؛ أقرب سجل بنفس البطولة والتاريخ (قد يكون اختلاف اسم): ${nameCandidate.homeNames[0]} × ${nameCandidate.awayNames[0]}.`
          : 'المباراة موجودة في المرجع ولا يوجد لها سجل مطابق في الموقع لهذا التاريخ.',
      });
      continue;
    }

    // مطابقة ناجحة.
    usedSite.add(chosen.site.id);
    matchedSiteIds.add(chosen.site.id);
    matched += 1;
    matchedByDate.set(ref.cairoDate, (matchedByDate.get(ref.cairoDate) || 0) + 1);
    if (chosen.orientation === 'exact') matchedExact += 1;
    const siteLabel = { ...label, siteMatchId: chosen.site.id };

    if (chosen.orientation === 'reversed') {
      issues.push({ ...siteLabel, kind: 'reversed_orientation', detail: 'الفريقان موجودان لكن المضيف والضيف معكوسان بين المرجع والموقع.' });
    } else if (chosen.orientation === 'similar') {
      issues.push({ ...siteLabel, kind: 'team_name_difference', detail: `اختلاف في تهجئة الاسم: المرجع «${ref.homeName} × ${ref.awayName}» والموقع «${chosen.site.homeNames[0]} × ${chosen.site.awayNames[0]}».` });
    }

    // التوقيت: فقط عند تأكيد الموقع للوقت وتوفّره في المرجع.
    const refMs = kickoffMs(ref.utcKickoff);
    const siteMs = chosen.site.kickoffConfirmed ? kickoffMs(chosen.site.utcKickoff) : null;
    if (refMs !== null && siteMs !== null) {
      const diffMinutes = Math.round(Math.abs(refMs - siteMs) / 60000);
      if (diffMinutes > options.timeToleranceMinutes) {
        issues.push({ ...siteLabel, kind: 'time_mismatch', detail: `فرق الموعد ${diffMinutes} دقيقة (المرجع ${ref.utcKickoff}، الموقع ${chosen.site.utcKickoff}).` });
      }
    }

    // الحالة: فقط عند معرفتها للطرفين.
    const refStatus = normalizeStatus(ref.status);
    const siteStatus = siteStatusOf(chosen.site);
    if (refStatus !== 'unknown' && siteStatus !== 'unknown' && refStatus !== siteStatus) {
      issues.push({ ...siteLabel, kind: 'status_mismatch', detail: `الحالة في المرجع «${refStatus}» وفي الموقع «${siteStatus}».` });
    }

    // النتيجة: لا تُقارن إلا عند وجودها للطرفين؛ غيابها في الموقع يُسجَّل كنقص.
    const refHasScore = ref.homeScore != null && ref.awayScore != null;
    const siteHasScore = chosen.site.homeScore != null && chosen.site.awayScore != null;
    if (refHasScore && siteHasScore) {
      const sameOrder = chosen.orientation !== 'reversed';
      const refHome = sameOrder ? ref.homeScore! : ref.awayScore!;
      const refAway = sameOrder ? ref.awayScore! : ref.homeScore!;
      if (refHome !== chosen.site.homeScore || refAway !== chosen.site.awayScore) {
        issues.push({ ...siteLabel, kind: 'score_mismatch', detail: `النتيجة في المرجع ${refHome}-${refAway} وفي الموقع ${chosen.site.homeScore}-${chosen.site.awayScore}.` });
      }
    } else if (refHasScore && !siteHasScore) {
      issues.push({ ...siteLabel, kind: 'score_missing_on_site', detail: 'المرجع يذكر نتيجة لهذه المباراة والموقع لا يملكها.' });
    }
  }

  // تكرار السجلات داخل الموقع: نفس التاريخ والبطولة والفريقين بمعرّفين مختلفين.
  const groups = new Map<string, CoverageSiteMatch[]>();
  for (const candidate of site) {
    const teams = [normalizeName(candidate.homeNames[0] || ''), normalizeName(candidate.awayNames[0] || '')].sort();
    const key = [candidate.cairoDate, candidate.competitionCode, teams.join('|')].join('::');
    groups.set(key, [...(groups.get(key) || []), candidate]);
  }
  for (const group of groups.values()) {
    if (group.length > 1) {
      const first = group[0];
      issues.push({
        kind: 'duplicate_site_record',
        cairoDate: first.cairoDate,
        competition: first.competitionNameEn,
        home: first.homeNames[0],
        away: first.awayNames[0],
        siteMatchIds: group.map((entry) => entry.id),
        detail: `${group.length} سجلات في الموقع لنفس المباراة بمعرّفات مختلفة.`,
      });
    }
  }

  // سجلات الموقع في النافذة ولا تقابلها أي مباراة في المرجع: معلومة وليست خطأً بالضرورة.
  for (const candidate of site) {
    if (matchedSiteIds.has(candidate.id)) continue;
    const alreadyCounted = issues.some((issue) => issue.siteMatchId === candidate.id);
    if (alreadyCounted) continue;
    issues.push({
      kind: 'site_only',
      cairoDate: candidate.cairoDate,
      competition: candidate.competitionNameEn,
      home: candidate.homeNames[0],
      away: candidate.awayNames[0],
      siteMatchId: candidate.id,
      detail: 'موجودة في الموقع ولا تقابلها مباراة في المرجع لهذه النافذة.',
    });
  }

  // تغطية البطولات: بطولات المرجع التي لا يوجد لها أي سجل في الموقع داخل النافذة.
  const refCompetitions = new Map<string, ReferenceMatch>();
  for (const ref of reference) {
    const key = normalizeName(ref.competitionName) || ref.competitionName;
    if (!refCompetitions.has(key)) refCompetitions.set(key, ref);
  }
  let competitionsMissing = 0;
  for (const [, ref] of refCompetitions) {
    const present = site.some((candidate) => sameCompetition(ref, candidate));
    if (!present) {
      competitionsMissing += 1;
      issues.push({
        kind: 'missing_competition',
        cairoDate: ref.cairoDate,
        competition: ref.competitionName,
        home: '',
        away: '',
        referenceSource: ref.source,
        detail: 'البطولة موجودة في المرجع ضمن النافذة ولا يوجد لها أي سجل في الموقع.',
      });
    }
  }

  const missing = reference.length - matched;
  const siteOnly = site.length - matchedSiteIds.size;
  const perDateKeys = new Set<string>([...refByDate.keys(), ...site.map((match) => match.cairoDate)]);
  const perDate: CoverageDateRow[] = [...perDateKeys]
    .sort()
    .map((cairoDate) => {
      const reference = refByDate.get(cairoDate) || 0;
      const matchedCount = matchedByDate.get(cairoDate) || 0;
      return {
        cairoDate,
        reference,
        matched: matchedCount,
        missing: missingByDate.get(cairoDate) || 0,
        siteOnly: site.filter((match) => match.cairoDate === cairoDate && !matchedSiteIds.has(match.id)).length,
        coveragePct: reference > 0 ? Math.round((matchedCount / reference) * 1000) / 10 : null,
      };
    });

  const referenceSources = [...new Set(input.reference.map((match) => match.source))].sort();
  const siteSources = new Set(site.flatMap((match) => match.contributingSources));
  const referenceFeedsSite = referenceSources.some((source) => siteSources.has(source));

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    window,
    referenceSources,
    referenceFeedsSite,
    summary: {
      referenceTotal: reference.length,
      referenceOutOfWindow,
      siteTotalInWindow: site.length,
      matched,
      matchedExact,
      missing,
      siteOnly,
      coveragePct: reference.length > 0 ? Math.round((matched / reference.length) * 1000) / 10 : null,
      competitionsInReference: refCompetitions.size,
      competitionsMissing,
    },
    perDate,
    issues,
  };
}
