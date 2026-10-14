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
  const hasNews = news && news.length > 0;
  const featured = hasNews ? news[0] : null;
  const rest = hasNews ? news.slice(1) : [];

  return (
    <section id="news" className="kl-news-section" aria-label="آخر الأخبار">
      <div className="kl-section-head kl-news-head">
        <div>
          <h2 className="kl-section-title">🔥 آخر أخبار كرة القدم</h2>
          {lastUpdatedLabel ? (
            <p className="kl-news-updated">آخر تحديث: {lastUpdatedLabel}</p>
          ) : null}
        </div>
        <Link href="/news" className="kl-news-all-link">
          كل الأخبار →
        </Link>
      </div>

      {!hasNews ? (
        <div className="kl-empty-box">
          <p className="kl-empty-title">لا توجد أخبار جديدة مؤكدة للعرض حاليًا</p>
          <p className="kl-news-empty-note">
            لا نعرض عناوين تجريبية أو نتائج مباريات باعتبارها أخبارًا. ستظهر الأخبار هنا بعد مزامنة ناجحة من المصدر المعتمد.
          </p>
        </div>
      ) : (
        <>
          {/* Featured (first) news card — larger layout */}
          {featured && (
            <Link
              href={isIndexableNewsArticle(featured) ? `/news/${featured.slug}` : featured.originalUrl || featured.link}
              className="kl-news-featured"
            >
              <span className="kl-news-featured-tag">
                {featured.publisherName}
              </span>
              <h3 className="kl-news-featured-title" dir={featured.language === 'en' ? 'ltr' : 'rtl'}>
                {featured.title}
              </h3>
              {featured.excerpt ? (
                <p className="kl-news-featured-excerpt" dir={featured.language === 'en' ? 'ltr' : 'rtl'}>
                  {featured.excerpt}
                </p>
              ) : null}
              <div className="kl-news-featured-meta">
                <span>🕐 {featured.cairoTimeLabel}</span>
                {featured.nemoRelatedUrl ? (
                  <a href={featured.nemoRelatedUrl} target="_blank" rel="noopener noreferrer">
                    🌐 NEMO Sports
                  </a>
                ) : null}
                <span style={{ color: 'var(--kl-accent-primary)', fontWeight: 800 }}>
                  اقرأ المزيد ←
                </span>
              </div>
            </Link>
          )}

          {/* Rest of the news — grid */}
          {rest.length > 0 && (
            <div className="kl-news-grid">
              {rest.map((item) => (
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
          )}
        </>
      )}
    </section>
  );
}