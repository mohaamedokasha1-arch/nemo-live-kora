import { formatScoreDisplay } from '../cairo-time';
import type { MatchScore, MatchStatusCode } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  الربط المرجعي بين كل فريق ونتيجته (Score ↔ Team binding)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  المشكلة الجذرية التي تمنع هذه الطبقة رجوعها:
 *  المخزن يربط النتيجة بفريقها بالمفتاح (`score.home` ← `homeTeam`، `score.away` ←
 *  `awayTeam`) — وهذا الربط صحيح في كل مسارات الحفظ. لكن كل سطر عرض كان يعيد ترتيب
 *  الرقمين حسب نفسه: بطاقة المباريات كانت تُجبر الرقمين على ترتيب LTR صريح
 *  (`dir="ltr"`) بينما أعمدة الفريقين تُرتب RTL (الأول يمينًا) — فيقع رقم الفريق الأول
 *  ملاصقًا لعمود الفريق الثاني والعكس، أي أن النتيجة «تنقلب» بصريًا بين الفريقين على
 *  كل بطاقة، بينما تعرض الصفحات الأخرى الرقمين كسرد نصي واحد («1 - 0») تعيد خوارزمية
 *  ثنائية الاتجاه ترتيبه بحسب السياق — فتختلف النتيجة المقروءة من سطح إلى آخر.
 *
 *  القاعدة الثابتة المفروضة من هنا:
 *   1) صاحب كل رقم يُحسم **بالمفتاح المخزَّن وحده**: `home` لـ`homeTeam` و`away` لـ`awayTeam`.
 *      لا أسماء، لا ترتيب أبجدي، لا مطابقة نصوص — لا أي استنتاج إطلاقًا.
 *   2) كل رقم يُعرض في عنصر مستقل يحمل هوية فريقه (`data-side` + `data-team-id` +
 *      `title`/`aria-label`)، والترتيب المنطقي في DOM ثابت: الفريق الأول ثم الثاني.
 *      اتجاه العرض (LTR/RTL) تُطبّقه طبقة التنسيق على الفريقين والرقمين معًا في نفس
 *      السياق، فيبقى كل رقم ملاصقًا لفريقه في الاتجاهين — بلا قلب مزدوج ولا اختلاف
 *      بين سطح وآخر.
 *   3) المسار الوحيد لعرض النتيجة في كل مكونات الموقع هو المكوّن
 *      `components/MatchScoreView.tsx` المبني على هذه الطبقة — لا يبني أي مكوّن
 *      سلسلة نصية للنتيجة بنفسه بعد اليوم.
 */

export type MatchScoreSide = 'home' | 'away';

export interface MatchScoreSideView {
  /** جانب الفريق في بنية السجل — المفتاح الوحيد الذي يحدد صاحب الرقم. */
  side: MatchScoreSide;
  teamId: string | null;
  teamName: string;
  /** الرقم كما يُعرض («1»)، أو شرطة em عند غياب النتيجة. */
  display: string;
  value: number | null;
}

export interface MatchScoreView {
  /** هل يوجد رقم لفريقين قابل للعرض في هذه الحالة؟ (نفس شروط `formatScoreDisplay`). */
  hasScore: boolean;
  /** دائمًا [الأول، الثاني] — الترتيب المنطقي الثابت الذي يبني عليه العرض. */
  sides: readonly [MatchScoreSideView, MatchScoreSideView];
  /** ملخّص «home - away» للاستخدام النصي فقط (سجلات اللوحة، aria-label المكوّن). */
  summaryText: string;
}

interface ScoreViewTeam {
  id?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
}

/** هل للنتيجة رقمُ فريقين يُعرض؟ (قاعدة واحدة لكل الأسطح: `formatScoreDisplay`). */
export function scoreIsDisplayable(score: MatchScore | null | undefined, status?: MatchStatusCode): score is MatchScore {
  if (!score) return false;
  return formatScoreDisplay(score, status ?? 'live').hasScore;
}

/**
 * يبني عرض النتيجة من سجل المباراة: كل رقم يبقى مربوطًا بمفتاحه (`home`/`away`)
 * وبفريقه (المعرّف + الاسم) في نفس الكائن الناتج — فلا يستطيع أي سطح عرض أن
 * ينزّل رقمًا على فريق غير صاحبه دون أن يكسر النوع.
 */
export function buildMatchScoreView(input: {
  score: MatchScore | null | undefined;
  status?: MatchStatusCode;
  homeTeam: ScoreViewTeam;
  awayTeam: ScoreViewTeam;
}): MatchScoreView {
  const { score, status, homeTeam, awayTeam } = input;
  // بوابة العرض الوحيدة: نفس قاعدة البطاقات التاريخية (لا رقم لمباراة لم تبدأ/أُجلت/أُلغيت).
  const formatted = formatScoreDisplay(score ?? { home: null, away: null }, status ?? 'unconfirmed');
  const hasScore = Boolean(score) && formatted.hasScore;

  const sides: readonly [MatchScoreSideView, MatchScoreSideView] = [
    {
      side: 'home',
      teamId: homeTeam.id ?? null,
      teamName: (homeTeam.nameAr || homeTeam.nameEn || 'الفريق الأول').trim(),
      display: hasScore ? formatted.homeDisplay : '—',
      value: hasScore ? (score as MatchScore).home : null,
    },
    {
      side: 'away',
      teamId: awayTeam.id ?? null,
      teamName: (awayTeam.nameAr || awayTeam.nameEn || 'الفريق الثاني').trim(),
      display: hasScore ? formatted.awayDisplay : '—',
      value: hasScore ? (score as MatchScore).away : null,
    },
  ];

  return {
    hasScore,
    sides,
    // الملخّص النصي يبقى دائمًا «home - away» بالترتيب المنطقي — للعناوين وaria والسجلات،
    // ولأن قارئة الشاشة والروبوتات تقرأ DOM منطقيًا لا بصريًا.
    summaryText: formatted.summaryText,
  };
}

/**
 * تحويل مباشر من شكل السجل المخزَّن إلى العرض — يُستخدم في مسارات الاختبار وفي أي
 * طبقة وسيطة (صفحة المباراة/لوحة الإدارة) للتأكد من أن الربط بالمفاتيح لا بالموضع.
 */
export function buildMatchScoreViewFromRecord(record: {
  score: MatchScore | null;
  status: MatchStatusCode;
  homeTeam: ScoreViewTeam;
  awayTeam: ScoreViewTeam;
}): MatchScoreView {
  return buildMatchScoreView({
    score: record.score,
    status: record.status,
    homeTeam: record.homeTeam,
    awayTeam: record.awayTeam,
  });
}
