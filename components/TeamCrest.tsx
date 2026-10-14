'use client';

import React, { useState } from 'react';
import Image from 'next/image';

/**
 * شعار الفريق مع بديل SVG احترافي (درع) عند غياب الشعار أو فشل تحميله.
 * مشترك بين بطاقات الصفحة الرئيسية وصفحات الهبوط وصفحات البث.
 */
export default function TeamCrest({
  nameAr,
  logoUrl,
  isEgyptian,
  size = 48,
}: {
  nameAr: string;
  logoUrl: string | null;
  isEgyptian?: boolean;
  size?: number;
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
          width={size}
          height={size}
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
              <stop offset="0%" stopColor={isEgyptian ? '#B71C1C' : '#0D47A1'} />
              <stop offset="100%" stopColor={isEgyptian ? '#7F1D1D' : '#0A0E27'} />
            </linearGradient>
            <linearGradient
              id={isEgyptian ? 'shieldEgStroke' : 'shieldGlobalStroke'}
              x1="0"
              y1="0"
              x2="48"
              y2="48"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#FFD700" />
              <stop offset="100%" stopColor="#E6A817" />
            </linearGradient>
          </defs>
          {/* Shield outer */}
          <path
            d="M24 3L7 10V22C7 33.2 14.4 42.5 24 45.5C33.6 42.5 41 33.2 41 22V10L24 3Z"
            fill={`url(#${isEgyptian ? 'shieldEg' : 'shieldGlobal'})`}
            stroke={`url(#${isEgyptian ? 'shieldEgStroke' : 'shieldGlobalStroke'})`}
            strokeWidth="1.5"
          />
          {/* Shield inner highlight */}
          <path
            d="M24 7L11 12.5V22C11 31 16.8 38.2 24 41C31.2 38.2 37 31 37 22V12.5L24 7Z"
            fill="rgba(255,255,255,0.06)"
          />
          {/* Football icon */}
          <circle cx="24" cy="22" r="8" fill="none" stroke="#FFD700" strokeWidth="1.4" opacity="0.7" />
          <path d="M24 14L27 18H21L24 14Z" fill="#FFD700" opacity="0.5" />
          <circle cx="24" cy="22" r="2.5" fill="#FFD700" opacity="0.8" />
        </svg>
      ) : (
        <Image
          src={logoUrl}
          alt={nameAr}
          width={size}
          height={size}
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