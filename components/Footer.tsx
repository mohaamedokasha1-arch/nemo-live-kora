import React from 'react';
import Link from 'next/link';
import { NEMO_SPORTS_BASE_URL } from '@/lib/catalog';

export default function Footer() {
  return (
    <footer className="kl-footer">
      <div className="kl-container kl-footer-inner">
        <div className="kl-footer-brand">
          <span>جميع مواعيد المباريات معروضة بتوقيت القاهرة المحلي</span>
        </div>

        <div className="kl-footer-links">
          <a
            href={`${NEMO_SPORTS_BASE_URL}/competitions/egyptian-league`}
            target="_blank"
            rel="noopener noreferrer"
          >
            الدوري المصري
          </a>
          <a
            href={NEMO_SPORTS_BASE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            منصة NEMO Sports
          </a>
          <Link href="/news">الأخبار</Link>
          <Link href="/sources">حالة المصادر</Link>
        </div>
      </div>
    </footer>
  );
}
