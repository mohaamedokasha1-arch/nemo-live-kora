import { isIndexableNewsArticle } from '@/lib/news/validate';
import React from 'react';
import Link from 'next/link';
import { NewsItemRecord } from '@/lib/types';

export default function NewsSection({
  news,
  lastUpdatedLabel,
}: {
  news: NewsItemRecord[];
  lastUpdatedLabel?: string | null;
}) {
  /*
   * بلا أخبار: لا يُرسم أي شيء — لا عنوان قسم فارغ ولا نص «ستظهر الأخبار هنا».
   * قسم فارغ يوحي بأن الموقع لا يعمل، وإخفاؤه يعرض صفحة نظيفة كاملة.
   */
  if (!news || news.length === 0) return null;

  return (
    <section id="news" className="kl-news-section" aria-label="آخر الأخبار">
      <div className="kl-section-head kl-news-head">
        <div>
          <h2 className="kl-section-title">آخر الأخبار الرياضية</h2>
          {lastUpdatedLabel ? (
            <p className="kl-news-updated">آخر تحديث: {lastUpdatedLabel}</p>
          ) : null}
        </div>
        <Link href="/news" className="kl-news-all-link">
          كل الأخبار
        </Link>
      </div>

      <div className="kl-news-grid">
          {news.map((item) => (
            <article key={item.id} className="kl-news-card">
              <div className="kl-news-thumb">
                <span className="kl-news-tag">{item.publisherName}</span>
                <span className="kl-news-date">{item.cairoTimeLabel}</span>
              </div>
              <h3 className="kl-news-title" dir={item.language === 'en' ? 'ltr' : 'rtl'}>
                <a href={isIndexableNewsArticle(item) ? `/news/${item.slug}` : item.originalUrl || item.link}>{item.title}</a>
              </h3>
              {item.excerpt ? (
                <p className="kl-news-excerpt" dir={item.language === 'en' ? 'ltr' : 'rtl'}>
                  {item.excerpt}
                </p>
              ) : null}
              <div className="kl-news-card-links">
                <a href={isIndexableNewsArticle(item) ? `/news/${item.slug}` : item.originalUrl || item.link}>{isIndexableNewsArticle(item) ? 'تفاصيل الخبر' : 'اقرأ لدى المصدر الأصلي'}</a>
                {item.nemoRelatedUrl ? (
                  <a href={item.nemoRelatedUrl} target="_blank" rel="noopener noreferrer">
                    NEMO Sports
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
    </section>
  );
}
