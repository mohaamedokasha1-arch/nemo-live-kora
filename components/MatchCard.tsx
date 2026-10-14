'use client';

import React from 'react';
import Link from 'next/link';
import { formatScoreDisplay, toCairoTimeArabic } from '@/lib/cairo-time';
import { getMatchSourceLabelAr } from '@/lib/catalog';
import { buildMatchLandingPath, findCatalogEntryForMatch } from '@/lib/matches/match-links';
import { MatchRecord } from '@/lib/types';
import TeamCrest from './TeamCrest';

export const UNVERIFIED_MATCH_LINK_LABEL_AR = 'شاهد مباشرة على NEMO Sports';
export const VERIFIED_MATCH_LINK_LABEL_AR = 'صفحة المباراة على NEMO Sports';
/** البطاقة التي لها صفحة هبوط داخلية على البوابة (المسار الموصى به للزائر). */
export const MATCH_PAGE_LINK_LABEL_AR = 'تفاصيل المباراة والمشاهدة المباشرة';

export default function MatchCard({ match }: { match: MatchRecord }) {
  const scoreDisplay = formatScoreDisplay(match.score, match.status);
  const sourceLabel = getMatchSourceLabelAr(match.primarySource);
  const kickoffConfirmed =
    match.kickoffConfirmed === true && Number.isFinite(Date.parse(match.utcKickoff));
  // الأولوية للصفحة الداخلية (صفحة هبوط المباراة) لأنها بوابة المشاهدة الرسمية على الموقع،
  // وإن لم توجد صفحة داخلية نستخدم رابط NEMO Sports المُتحقَّق منه فقط.
  const catalogEntry = findCatalogEntryForMatch(match);
  const landingPath = catalogEntry ? buildMatchLandingPath(catalogEntry.id) : null;
  const targetUrl = match.nemoLink.verified ? match.nemoLink.url : null;
  const hasAction = Boolean(landingPath || targetUrl);
  const cardClass = [
    'kl-match-card',
    match.status === 'live' ? 'kl-match-card-live' : '',
    // اسم الصنف يصف حالة البث **الخارجية** فقط (وجود صفحة مطابقة مؤكَّدة من عدمه)،
    // ولا يعني أبدًا أن البطاقة غير قابلة للنقر — كل بطاقة تقود إلى صفحة التفاصيل.
    hasAction ? '' : 'kl-match-card-no-broadcast',
    landingPath ? 'kl-match-card-linked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const finishedLabel = landingPath
    ? 'النتيجة والملخص — صفحة المباراة'
    : 'انتهت المباراة — تفاصيل المباراة';
  const actionLabel = landingPath
    ? match.status === 'finished'
      ? finishedLabel
      : MATCH_PAGE_LINK_LABEL_AR
    : targetUrl
    ? match.status === 'finished'
      ? finishedLabel
      : VERIFIED_MATCH_LINK_LABEL_AR
    : UNVERIFIED_MATCH_LINK_LABEL_AR;

  const statusText =
    match.status === 'not_started'
      ? 'لم تبدأ بعد'
      : match.status === 'live'
      ? match.liveMinute
        ? `جارية الآن (${match.liveMinute}')`
        : 'جارية الآن'
      : match.status === 'finished'
      ? 'انتهت المباراة'
      : match.status === 'postponed'
      ? 'مؤجلة'
      : match.status === 'cancelled'
      ? 'أُلغيت'
      : match.statusLabelAr;

  const statusPinClass =
    match.status === 'live'
      ? 'kl-status-pin kl-pin-live'
      : match.status === 'finished'
      ? 'kl-status-pin kl-pin-finished'
      : match.status === 'postponed' || match.status === 'cancelled'
      ? 'kl-status-pin kl-pin-warn'
      : 'kl-status-pin kl-pin-upcoming';

  /**
   * كل بطاقة مباراة تُربط بصفحة تفاصيلها الديناميكية — بلا استثناء.
   *
   * الأولوية:
   *  ① `landingPath` = صفحة هبوط الكتالوج `/matches/<catalog-id>` (الأغنى محتوى).
   *  ② وإلا `buildMatchLandingPath(match.id)` = صفحة تفاصيل السجل نفسه
   *     `/matches/<store-id>` — وهي مسار حقيقي موجود يخدم `SourceMatchDetails`.
   *
   * كان السلوك السابق: بطاقات سجلات المصادر تُترك كعنصر `<article>` غير قابل للنقر
   * مع رابط نصي صغير داخلها، فتصل نسبة كبيرة من المباريات بلا صفحة تفاصيل عند النقر
   * على البطاقة. الآن **كل** بطاقة قابلة للنقر وتقود إلى `/matches/[id]`.
   */
  const detailPath = landingPath ?? buildMatchLandingPath(match.id);

  /**
   * وصف الرابط لقارئات الشاشة يصف **الفعل** لا حالة الرابط.
   * كان الوصف سابقًا هو نفسه نص الحالة («لا يوجد رابط بث مطابق موثّق»)، وهو وصف
   * مُربك لرابط قابل للنقر ويقود إلى صفحة مباراة كاملة. الآن يصف الوجهة دائمًا،
   * وتبقى حالة البث الخارجية موضّحة في شريط البطاقة السفلي كما هي.
   */
  const ariaLabel = `${MATCH_PAGE_LINK_LABEL_AR} — ${match.homeTeam.nameAr} ضد ${match.awayTeam.nameAr}`;

  const cardContent = (
    <>
      {/* Main Body: Home Team (Right) — Center Time/Score/Status Pin — Away Team (Left) */}
      <div className="kl-card-main">
        {/* Right Side: Home Team */}
        <div className="kl-team-side kl-team-right">
          <TeamCrest
            nameAr={match.homeTeam.nameAr}
            logoUrl={match.homeTeam.logoUrl}
            isEgyptian={match.homeTeam.isEgyptian}
          />
          <span className="kl-team-name">{match.homeTeam.nameAr}</span>
        </div>

        {/* Center: Kickoff Time + Score (when available) + Status Pin */}
        <div className="kl-center-info">
          {kickoffConfirmed ? (
            <time className="kl-match-time" dir="ltr" dateTime={match.utcKickoff}>
              {toCairoTimeArabic(match.utcKickoff)}
            </time>
          ) : (
            <span className="kl-match-time">الموعد غير مؤكد</span>
          )}

          {scoreDisplay.hasScore ? (
            <div className="kl-score-badge" dir="ltr">
              <span>{scoreDisplay.homeDisplay}</span>
              <span className="kl-score-sep">:</span>
              <span>{scoreDisplay.awayDisplay}</span>
            </div>
          ) : null}

          <span className={statusPinClass}>
            {match.status === 'live' && <span className="kl-live-dot" aria-hidden="true" />}
            {statusText}
          </span>
        </div>

        {/* Left Side: Away Team */}
        <div className="kl-team-side kl-team-left">
          <TeamCrest
            nameAr={match.awayTeam.nameAr}
            logoUrl={match.awayTeam.logoUrl}
            isEgyptian={match.awayTeam.isEgyptian}
          />
          <span className="kl-team-name">{match.awayTeam.nameAr}</span>
        </div>
      </div>

      {/* Subtle Bottom Strip: Channel + Competition (Non-duplicated) + Direct Link Indicator */}
      <div className="kl-card-footer">
        <div className="kl-meta-item">
          <svg
            viewBox="0 0 20 20"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="kl-meta-svg"
            aria-hidden="true"
          >
            <rect x="2" y="5" width="16" height="11" rx="2" />
            <polyline points="6 2 10 5 14 2" />
          </svg>
          <span>مصدر البيانات: {sourceLabel}</span>
        </div>

        <div className="kl-meta-item kl-meta-league">
          <svg
            viewBox="0 0 20 20"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="kl-meta-svg"
            aria-hidden="true"
          >
            <path d="M6 3h8v4a4 4 0 0 1-8 0V3z" />
            <path d="M6 5H3v1a3 3 0 0 0 3 3" />
            <path d="M14 5h3v1a3 3 0 0 1-3 3" />
            <line x1="10" y1="11" x2="10" y2="15" />
            <line x1="7" y1="15" x2="13" y2="15" />
          </svg>
          <span>{match.competitionNameAr}</span>
        </div>

        <div className="kl-meta-item kl-meta-action" title={match.nemoLink.subLabelAr}>
          <span>{actionLabel}</span>
          {hasAction ? (
            <svg
              viewBox="0 0 16 16"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 8H4M4 8L8 4M4 8L8 12" />
            </svg>
          ) : null}
        </div>
      </div>
    </>
  );

  /*
   * كل بطاقة تقود إلى صفحة التفاصيل الديناميكية داخل البوابة.
   *
   * ملاحظة مقصودة: حتى البطاقة التي لها صفحة مطابقة موثّقة على NEMO Sports لا تفتحها
   * مباشرة، لأن الوجهة الأساسية للنقر هي بوابة البوابة الداخلية `/matches/[id]` التي
   * تجمع معلومات المباراة كاملة (الفرق والشعارات والتوقيت والبطولة والملعب) وتحمل
   * زر «المشاهدة المباشرة» ثم مساحات الإعلانات. تخطّي صفحة التفاصيل كان يُفقد الزائر
   * هذه المعلومات ويُضيّع صفحة عرض إعلانية كاملة.
   */
  return (
    <Link
      href={detailPath}
      className={cardClass}
      title={`${match.homeTeam.nameAr} ضد ${match.awayTeam.nameAr} — صفحة المباراة على نيمو كورة لايف`}
      aria-label={ariaLabel}
    >
      {cardContent}
    </Link>
  );
}
