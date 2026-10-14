import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getGatewayDatabase, hydrateStore } from '@/lib/db/store';
import { getArchiveNews } from '@/lib/news/query';
import { isIndexableNewsArticle } from '@/lib/news/validate';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  await hydrateStore();
  const archive = getArchiveNews(getGatewayDatabase().news);
  return {
    title: 'أرشيف الأخبار الرياضية',
    description: 'أرشيف العناوين الرياضية المنشورة سابقًا بعد التحقق، مرتبة حسب تاريخ النشر الأصلي.',
    alternates: { canonical: '/news/archive' },
    robots: { index: archive.some(isIndexableNewsArticle), follow: true },
  };
}

export default async function NewsArchivePage() {
  const db = await hydrateStore();
  const archive = getArchiveNews(db.news);

  return (
    <div className="kl-news-page">
      <header className="kl-section-head">
        <p className="kl-breadcrumb">
          <Link href="/">الرئيسية</Link>
          <span> / </span>
          <Link href="/news">الأخبار</Link>
          <span> / </span>
          <span>الأرشيف</span>
        </p>
        <h1 className="kl-section-title">أرشيف الأخبار</h1>
        <p className="kl-news-lead">
          الأخبار السابقة تبقى متاحة هنا ولا تُحذف لمجرد أنها لم تعد حديثة. الأخبار بدون تاريخ نشر موثوق تظهر بعلامة واضحة.
        </p>
      </header>

      {archive.length === 0 ? (
        <section className="kl-news-empty" aria-label="حالة الأرشيف">
          <h2 className="kl-section-subtitle">الأرشيف يتجمّع تلقائيًا</h2>
          <p>
            تُضاف الأخبار إلى الأرشيف تلقائيًا بعد خروجها من نافذة الأحدث، ويظهر كل خبر بتاريخ
            نشره الأصلي.
          </p>
          <Link className="kl-cta-btn" href="/news">
            عُد إلى آخر الأخبار
          </Link>
        </section>
      ) : (
        <div className="kl-news-list">
          {archive.map((item) => (
            <article key={item.id} className="kl-news-card">
              <div className="kl-news-thumb">
                <span className="kl-news-tag">{item.publisherName}</span>
                <span className="kl-news-date">{item.cairoTimeLabel}</span>
              </div>
              <h2 className="kl-news-title" dir={item.language === 'en' ? 'ltr' : 'rtl'}>
                <Link href={`/news/${item.slug}`}>{item.title}</Link>
              </h2>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
