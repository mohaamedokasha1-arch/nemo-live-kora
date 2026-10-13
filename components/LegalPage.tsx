import React from 'react';
import Link from 'next/link';

/** قالب موحّد للصفحات القانونية (سياسة الخصوصية، الشروط، من نحن، اتصل بنا). */
export default function LegalPage({
  title,
  updatedAt,
  intro,
  children,
}: {
  title: string;
  updatedAt: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <article className="kl-legal-page">
      <header className="kl-legal-head">
        <h1>{title}</h1>
        <p className="kl-legal-updated">آخر تحديث: {updatedAt}</p>
        <p className="kl-legal-intro">{intro}</p>
      </header>

      <div className="kl-legal-body">{children}</div>

      <footer className="kl-legal-foot">
        <p>
          روابط ذات صلة:{' '}
          <Link href="/about">من نحن</Link> ·{' '}
          <Link href="/privacy-policy">سياسة الخصوصية</Link> ·{' '}
          <Link href="/terms">شروط الاستخدام</Link> ·{' '}
          <Link href="/contact">اتصل بنا</Link>
        </p>
        <p>
          <Link href="/">→ العودة إلى جدول مباريات اليوم</Link>
        </p>
      </footer>
    </article>
  );
}
