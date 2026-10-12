import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatArabicTimestamp } from '@/lib/cairo-time';
import { getGatewayDatabase } from '@/lib/db/store';
import { getArchiveNews, getLatestNews } from '@/lib/news/query';
import { ensureFreshNews } from '@/lib/sync/engine';
import NewsSection from '@/components/NewsSection';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'الأخبار الرياضية',
  description:
    'عناوين رياضية محققة من المصادر المعتمدة، مع نسبتها للناشر الأصلي وتاريخ النشر الحقيقي وربطها بصفحات NEMO Sports عند وجود مطابقة.',
  alternates: { canonical: '/news' },
};

export default async function NewsIndexPage() {
  await ensureFreshNews();
  const db = getGatewayDatabase();
  const latest = getLatestNews(db.news, 24);
  const archiveCount = getArchiveNews(db.news).length;
  const lastOk = db.meta.lastSuccessfulNewsSyncAt;

  return (
    <div className="kl-news-page">
      <header className="kl-section-head">
        <p className="kl-breadcrumb">
          <Link href="/">الرئيسية</Link>
          <span> / </span>
          <span>الأخبار</span>
        </p>
        <h1 className="kl-section-title">الأخبار الرياضية</h1>
        <p className="kl-news-lead">
          نعرض فقط الأخبار التي اجتازت التحقق: عنوان صالح، مصدر معروف، رابط صحيح، ومنع للتكرار. تاريخ العرض هو تاريخ النشر الأصلي وليس وقت الجلب.
        </p>
        <p className="kl-news-updated">
          {lastOk ? `آخر مزامنة ناجحة: ${formatArabicTimestamp(lastOk)}` : 'لم تكتمل مزامنة أخبار ناجحة بعد'}
        </p>
      </header>
      <NewsSection
        news={latest}
        lastUpdatedLabel={lastOk ? formatArabicTimestamp(lastOk) : null}
      />
      {archiveCount > 0 ? (
        <p className="kl-news-archive-link">
          <Link href="/news/archive">أرشيف الأخبار السابقة ({archiveCount})</Link>
        </p>
      ) : null}
    </div>
  );
}
