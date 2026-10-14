import React from 'react';
import Link from 'next/link';
import NemoLogo from '@/components/NemoLogo';
import { NEMO_SPORTS_BASE_URL } from '@/lib/catalog';

export default function Footer() {
  return (
    <footer className="kl-footer">
      <div className="kl-container kl-footer-inner">
        <div className="kl-footer-brand">
          {/* العلامة الرسمية نفسها المستخدمة في الهيدر (تظهر في كل صفحة) */}
          <NemoLogo size={40} tone="light" className="kl-footer-logo" />
          <strong>نيمو كورة لايف — NEMO Sports</strong>
          <span>
            بوابة مباريات ومواعيد بتوقيت القاهرة، مع صفحة تفصيلية لكل مباراة ومشاهدة مباشرة،
            وتحديث تلقائي للنتائج والأخبار. لا نستضيف أي بث غير مرخّص.
          </span>
        </div>

        <div className="kl-footer-links">
          <a
            href={`${NEMO_SPORTS_BASE_URL}/competitions/egyptian-league`}
            target="_blank"
            rel="noopener noreferrer"
          >
            الدوري المصري
          </a>
          <a href={NEMO_SPORTS_BASE_URL} target="_blank" rel="noopener noreferrer">
            منصة NEMO Sports
          </a>
          <Link href="/news">الأخبار</Link>
        </div>

        <nav className="kl-footer-links kl-footer-legal" aria-label="روابط قانونية">
          <Link href="/about">من نحن</Link>
          <Link href="/contact">اتصل بنا</Link>
          <Link href="/privacy-policy">سياسة الخصوصية</Link>
          <Link href="/terms">شروط الاستخدام</Link>
        </nav>
      </div>
    </footer>
  );
}
