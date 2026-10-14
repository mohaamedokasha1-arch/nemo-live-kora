import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatArabicTimestamp } from '@/lib/cairo-time';
import { getGatewayDatabase, hydrateStore } from '@/lib/db/store';
import { getArchiveNews, getLatestNews, getPublishedNews } from '@/lib/news/query';
import { isIndexableNewsArticle } from '@/lib/news/validate';
import { ensureFreshNews } from '@/lib/sync/engine';
import NewsSection from '@/components/NewsSection';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const db = await hydrateStore();
  const hasIndexableCurrentNews = getLatestNews(db.news, 24).some(isIndexableNewsArticle);
  return {
    title: 'الأخبار الرياضية',
    description:
      'عناوين رياضية من مصدر النشر الأصلي مع تاريخ النشر الحقيقي، ولا تظهر إلا بعد اجتياز روابطها وفحوص الجودة.',
    alternates: { canonical: '/news' },
    robots: { index: hasIndexableCurrentNews, follow: true },
  };
}

export default async function NewsIndexPage() {
  await hydrateStore();
  await ensureFreshNews();
  const db = getGatewayDatabase();
  const latest = getLatestNews(db.news, 24);
  const displayed = latest.length ? latest : getPublishedNews(db.news).slice(0, 24);
  const attempt = db.newsSourceSyncs?.[0];
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
      {attempt && !attempt.ok && <p role="status">تعذر تحديث الأخبار في آخر محاولة ({formatArabicTimestamp(attempt.finishedAt)}). {attempt.messageAr}</p>}
      {!latest.length && displayed.length > 0 && <p>آخر أخبار صالحة محفوظة — ليست أخبارًا جديدة، راجع تاريخ النشر.</p>}
      <NewsSection
        news={displayed}
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
