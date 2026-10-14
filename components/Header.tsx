'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { NEMO_SPORTS_BASE_URL } from '@/lib/catalog';

export default function Header() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem('nemo-gateway-theme');
    if (saved === 'dark' || saved === 'light') {
      setTheme(saved);
      document.documentElement.setAttribute('data-theme', saved);
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const toggleTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    window.localStorage.setItem('nemo-gateway-theme', next);
  }, [theme]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <>
      <header className="kl-header">
        <div className="kl-container kl-header-inner">
          <Link href="/" className="kl-brand" aria-label="نيمو كورة لايف - الرئيسية">
            <div className="kl-brand-crest" aria-hidden="true">
              <svg
                viewBox="0 0 44 44"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="kl-brand-svg"
              >
                <defs>
                  <linearGradient id="nemoGold" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#FFD700" />
                    <stop offset="100%" stopColor="#E6A817" />
                  </linearGradient>
                  <linearGradient id="nemoRed" x1="22" y1="0" x2="22" y2="44" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#FF1744" />
                    <stop offset="100%" stopColor="#D50000" />
                  </linearGradient>
                </defs>
                {/* Shield shape */}
                <path
                  d="M22 2L6 8.5V20C6 30 12.5 39 22 42C31.5 39 38 30 38 20V8.5L22 2Z"
                  fill="url(#nemoGold)"
                  stroke="rgba(255,255,255,0.3)"
                  strokeWidth="1.2"
                />
                {/* Inner shield */}
                <path
                  d="M22 6L10 10.5V20C10 28.2 15.3 35.2 22 38C28.7 35.2 34 28.2 34 20V10.5L22 6Z"
                  fill="#0A0E27"
                  stroke="rgba(255,215,0,0.4)"
                  strokeWidth="0.8"
                />
                {/* Football / N letter */}
                <text
                  x="22"
                  y="27"
                  textAnchor="middle"
                  fontFamily="Tajawal, sans-serif"
                  fontWeight="900"
                  fontSize="18"
                  fill="url(#nemoGold)"
                >
                  N
                </text>
                {/* Live dot */}
                <circle cx="32" cy="12" r="3.5" fill="url(#nemoRed)">
                  <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
                </circle>
              </svg>
            </div>
            <div className="kl-brand-titles">
              <span className="kl-brand-ar">نيمو كورة لايف</span>
              <span className="kl-brand-sub">LIVE SPORTS GATEWAY</span>
            </div>
          </Link>

          <nav className="kl-nav" aria-label="القائمة العلوية">
            <Link href="/news" className="kl-nav-item">
              آخر الأخبار
            </Link>
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

            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="kl-mobile-menu-btn"
              aria-label="فتح القائمة"
              aria-expanded={menuOpen}
            >
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </nav>
        </div>
      </header>

      {/* Mobile overlay + slide-over panel */}
      <div
        className="kl-mobile-overlay"
        data-open={menuOpen ? 'true' : 'false'}
        onClick={closeMenu}
        aria-hidden="true"
      />
      <aside
        className="kl-mobile-panel"
        data-open={menuOpen ? 'true' : 'false'}
        role="dialog"
        aria-label="القائمة الجانبية"
      >
        <button
          type="button"
          className="kl-mobile-panel-close"
          onClick={closeMenu}
          aria-label="إغلاق القائمة"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <Link href="/" onClick={closeMenu}>🏠 الرئيسية</Link>
        <Link href="/news" onClick={closeMenu}>📰 آخر الأخبار</Link>
        <Link href="/sources" onClick={closeMenu}>📋 المصادر</Link>

        <div className="kl-mobile-panel-sep" />

        <a
          href={NEMO_SPORTS_BASE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={closeMenu}
        >
          🌐 منصة NEMO Sports
        </a>

        <div className="kl-mobile-panel-sep" />

        <Link href="/about" onClick={closeMenu}>ℹ️ من نحن</Link>
        <Link href="/contact" onClick={closeMenu}>📞 اتصل بنا</Link>
        <Link href="/privacy-policy" onClick={closeMenu}>🔒 سياسة الخصوصية</Link>
        <Link href="/terms" onClick={closeMenu}>📜 شروط الاستخدام</Link>

        <div className="kl-mobile-panel-sep" />

        <button type="button" onClick={toggleTheme}>
          {theme === 'light' ? '🌙 الوضع الداكن' : '☀️ الوضع الفاتح'}
        </button>
      </aside>
    </>
  );
}