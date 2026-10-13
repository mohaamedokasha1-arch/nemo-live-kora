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
