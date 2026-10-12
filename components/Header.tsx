'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { NEMO_SPORTS_BASE_URL } from '@/lib/catalog';

export default function Header() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const saved = window.localStorage.getItem('nemo-gateway-theme');
    if (saved === 'dark' || saved === 'light') {
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
        <Link href="/" className="kl-brand" aria-label="نيمو كورة لايف - الرئيسية">
          <div className="kl-brand-crest" aria-hidden="true">
            <svg
              viewBox="0 0 40 40"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="kl-brand-svg"
            >
              <defs>
                <linearGradient id="nemoGold" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#D99B52" />
                  <stop offset="100%" stopColor="#8B5E34" />
                </linearGradient>
              </defs>
              <path
                d="M20 2L6 8V19C6 28.2 11.98 36.56 20 39C28.02 36.56 34 28.2 34 19V8L20 2Z"
                fill="url(#nemoGold)"
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="1.5"
              />
              <circle cx="20" cy="20" r="8.5" fill="#1B2432" stroke="#FFFFFF" strokeWidth="1.5" />
              <path
                d="M20 14.2L22.6 16.1L21.6 19.2H18.4L17.4 16.1L20 14.2Z"
                fill="#D99B52"
              />
              <circle cx="20" cy="20" r="2.2" fill="#FFFFFF" />
            </svg>
          </div>
          <div className="kl-brand-titles">
            <span className="kl-brand-ar">نيمو كورة لايف</span>
            <span className="kl-brand-sub">بوابة المباريات الرسمية</span>
          </div>
        </Link>

        <nav className="kl-nav" aria-label="القائمة العلوية">
          <a href="#news" className="kl-nav-item">
            آخر الأخبار
          </a>
          <Link href="/sources" className="kl-nav-item">
            المصادر
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
