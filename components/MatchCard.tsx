'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { formatScoreDisplay } from '@/lib/cairo-time';
import { getMatchSourceLabelAr } from '@/lib/catalog';
import { MatchRecord } from '@/lib/types';

/**
 * Professional Club Crest pedestal component with high-res PNG support
 * and a bespoke vector SVG football shield emblem fallback (never plain text!).
 */
function TeamCrest({
  nameAr,
  logoUrl,
  isEgyptian,
}: {
  nameAr: string;
  logoUrl: string | null;
  isEgyptian?: boolean;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="kl-team-logo-wrap">
      {!logoUrl || imgError ? (
        <svg
          viewBox="0 0 48 48"
          className="kl-team-shield-svg"
          aria-label={nameAr}
          role="img"
        >
          <defs>
            <linearGradient
              id={isEgyptian ? 'shieldEg' : 'shieldGlobal'}
              x1="0"
              y1="0"
              x2="48"
              y2="48"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor={isEgyptian ? '#991B1B' : '#1E3A8A'} />
              <stop offset="100%" stopColor={isEgyptian ? '#7F1D1D' : '#172554'} />
            </linearGradient>
          </defs>
          <path
            d="M24 4L8 10.5V22.5C8 33.4 14.82 42.8 24 45.5C33.18 42.8 40 33.4 40 22.5V10.5L24 4Z"
            fill={`url(#${isEgyptian ? 'shieldEg' : 'shieldGlobal'})`}
            stroke="#D99B52"
            strokeWidth="2"
          />
          <path
            d="M24 9L13 13.5V22.2C13 30.2 17.68 37.2 24 39.5C30.32 37.2 35 30.2 35 22.2V13.5L24 9Z"
            fill="rgba(255,255,255,0.08)"
          />
          <circle cx="24" cy="23" r="6.5" fill="none" stroke="#FDE68A" strokeWidth="1.6" />
          <circle cx="24" cy="23" r="2.2" fill="#FDE68A" />
        </svg>
      ) : (
        <Image
          src={logoUrl}
          alt={nameAr}
          width={48}
          height={48}
          unoptimized
          className="kl-team-logo-img"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
        />
      )}
    </div>
  );
}

/**
 * Formats UTC ISO time into a clean Koora Live clock ("5:00 PM" / "8:00 PM") in Africa/Cairo
 */
function formatCleanTime(utcIso: string): string {
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

export default function MatchCard({ match }: { match: MatchRecord }) {
  const scoreDisplay = formatScoreDisplay(match.score, match.status);
  const sourceLabel = getMatchSourceLabelAr(match.primarySource);
  const targetUrl =
    match.nemoLink.linkType === 'direct_match' && match.nemoLink.verified
      ? match.nemoLink.url
      : null;
  const cardClass = `kl-match-card ${
    match.status === 'live' ? 'kl-match-card-live' : ''
  } ${targetUrl ? '' : 'kl-match-card-unlinked'}`.trim();

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
          <time className="kl-match-time" dir="ltr" dateTime={match.utcKickoff}>
            {formatCleanTime(match.utcKickoff)}
          </time>

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

        <div className="kl-meta-item kl-meta-action">
          <span>
            {targetUrl
              ? 'مشاهدة البث على NEMO Sports'
              : 'لا يتوفر رابط بث مطابق على NEMO Sports'}
          </span>
          {targetUrl ? (
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

  if (!targetUrl) {
    return (
      <article
        className={cardClass}
        aria-label={`${match.homeTeam.nameAr} ضد ${match.awayTeam.nameAr} — ${match.statusLabelAr}`}
      >
        {cardContent}
      </article>
    );
  }

  return (
    <a
      href={targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cardClass}
      title={`${match.homeTeam.nameAr} ضد ${match.awayTeam.nameAr}`}
      aria-label={`مشاهدة بث ${match.homeTeam.nameAr} ضد ${match.awayTeam.nameAr} على NEMO Sports`}
    >
      {cardContent}
    </a>
  );
}
