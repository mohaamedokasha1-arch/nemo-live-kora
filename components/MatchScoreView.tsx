import React from 'react';
import { buildMatchScoreView, type MatchScoreView } from '@/lib/matches/score-view';
import type { MatchScore, MatchStatusCode } from '@/lib/types';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  المكوّن الوحيد لعرض نتيجة مباراة — في كل صفحات الموقع واللوحة على حدّ سواء
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  لماذا مكوّن مشترك واحد؟ لأن انقلاب النتائج بين الفريقين كان **مشكلة ترتيب بصري**،
 *  لا مشكلة تخزين: كل سطح كان يرتّب الرقمين بطريقته (بطاقة هنا تجبر الترتيب اللاتيني،
 *  وسرد نصي هناك تعيد خوارزمية ثنائية الاتجاه ترتيبه)، فيتزوّج رقم الفريق الأول بعمود
 *  الفريق الثاني بصريًا. من هنا لا يبني أي مكوّن سلسلة نتيجة بنفسه.
 *
 *  العقد الثابت الذي ينفّذه هذا المكوّن:
 *   • الترتيب المنطقي في DOM: [رقم الأول][الفاصل][رقم الثاني] — لا يتغيّر أبدًا.
 *   • كل رقم في عنصر مستقل يحمل هوية صاحبة: `data-side` و`data-team-id` و`title`
 *     باسم الفريق وقيمته — فتصبح المطابقة قابلة للتحقق آليًا (وفي قارئات الشاشة).
 *   • لا `dir` مفروض على النتيجة: يتبع المكوّن اتجاه أبيه تمامًا — نفس اتجاه أعمدة
 *     الفريقين — فيبقى كل رقم ملاصقًا لفريقه في RTL وLTR معًا، بلا قلب مزدوج.
 */

interface TeamLike {
  id?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
}

export interface MatchScoreViewProps {
  score: MatchScore | null | undefined;
  status?: MatchStatusCode;
  homeTeam: TeamLike;
  awayTeam: TeamLike;
  /** الفاصل المقروء بين الرقمين (نفس ما يُستخدم في كل بطاقات الموقع). */
  separator?: ':' | '-';
  className?: string;
  /**
   * نص يُعرض بدل النتيجة حين لا رقم مؤهّل للعرض (مثال «VS» في صفحة البث).
   * بدونه لا يُعرض شيء إطلاقًا عند غياب النتيجة — مثل السلوك التاريخي للبطاقات.
   */
  noScoreText?: string;
  /** يضيف `title` للحاوية كلها (تلميح لوحة الإدارة مثلًا). */
  containerTitle?: string;
}

/** يبني `aria-label` يثبت الاقتران: اسم الفريق ثم رقمه، الفريق الأول أولًا. */
export function scorePairAriaLabel(view: MatchScoreView, separator: string): string {
  return view.sides.map((side) => `نتيجة ${side.teamName}: ${side.display}`).join(` ${separator} `);
}

export default function MatchScoreView({
  score,
  status,
  homeTeam,
  awayTeam,
  separator = ':',
  className,
  noScoreText,
  containerTitle,
}: MatchScoreViewProps) {
  const view = buildMatchScoreView({ score, status, homeTeam, awayTeam });

  if (!view.hasScore) {
    if (!noScoreText) return null;
    return <span className={className}>{noScoreText}</span>;
  }

  const [homeSide, awaySide] = view.sides;

  const sideProps = (side: typeof homeSide) => ({
    className: `kl-score-num kl-score-num-${side.side}`,
    'data-side': side.side,
    ...(side.teamId ? { 'data-team-id': side.teamId } : {}),
    title: `${side.teamName}: ${side.display}`,
  });

  return (
    <span
      className={['kl-score-pair', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={scorePairAriaLabel(view, separator)}
      title={containerTitle ?? `${homeSide.teamName} ${homeSide.display} ${separator} ${awaySide.display} ${awaySide.teamName}`}
    >
      <span {...sideProps(homeSide)}>{homeSide.display}</span>
      <span className="kl-score-sep" aria-hidden="true">{separator}</span>
      <span {...sideProps(awaySide)}>{awaySide.display}</span>
    </span>
  );
}
