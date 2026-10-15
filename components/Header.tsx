'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import NemoLogo from '@/components/NemoLogo';
import { NEMO_SPORTS_BASE_URL } from '@/lib/catalog';

export default function Header() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const saved = window.localStorage.getItem('nemo-gateway-theme');
    if (saved === 'dark' || saved === 'light') {
      // Apply the browser-only preference after hydration to keep the server render deterministic.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only available in the browser.
      setTheme(saved);
      document.documentElement.setAttribute('data-theme', saved);
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    window.localStorage.setItem('nemo-gateway-theme', next);
  };

  return (
    <header className="kl-header">
      <div className="kl-container kl-header-inner">
        <Link
          href="/"
          className="kl-brand"
          aria-label="نيمو كورة لايف — NEMO Sports — الصفحة الرئيسية"
        >
          {/*
            شعار NEMO Sports — **نفس شعار الموقع المرجعي** (nemo-sports.vercel.app)،
            منقولًا من ملفاته الأصلية بلا أي إعادة رسم: العلامة (دربان + قُطر ذهبي)
            ثم «NEMO» فوق «Sports». المقاس 38px — وهو المقاس المستخدم في هيدر الموقع
            المرجعي نفسه — ويصغر بنسبه إلى 32px على الموبايل.

            الملفات الأصلية منسوخة كما هي في `public/nemo-mark.svg` و
            `public/nemo-logo.svg` و`app/icon.svg` (نفس البايتات، ويحرس التطابق
            اختبار في `tests/logo-branding.test.ts`)، والمصدر موثّق في
            `components/NemoLogo.tsx`.
          */}
          <NemoLogo size={38} className="kl-brand-logo" />
        </Link>

        <nav className="kl-nav" aria-label="القائمة العلوية">
          <Link href="/matches" className="kl-nav-item">
            📅 جدول المباريات
          </Link>
          <Link href="/news" className="kl-nav-item">
            آخر الأخبار
          </Link>
          <a
            href={NEMO_SPORTS_BASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="kl-nav-cta"
          >
            <span>NEMO Sports</span>
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
              <path d="M5 11L11 5M11 5H6M11 5V10" />
            </svg>
          </a>
          <button
            type="button"
            onClick={toggleTheme}
            className="kl-theme-btn"
            aria-label={theme === 'light' ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح'}
            title={theme === 'light' ? 'الوضع الداكن' : 'الوضع الفاتح'}
          >
            {theme === 'light' ? (
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
              </svg>
            )}
          </button>
        </nav>
      </div>
    </header>
  );
}
