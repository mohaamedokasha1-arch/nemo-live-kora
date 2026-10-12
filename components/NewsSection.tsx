import React from 'react';
import { NewsItemRecord } from '@/lib/types';

export default function NewsSection({ news }: { news: NewsItemRecord[] }) {
  if (!news || news.length === 0) return null;

  return (
    <section id="news" className="kl-news-section" aria-label="آخر الأخبار">
      <div className="kl-section-head">
        <h2 className="kl-section-title">آخر الأخبار الرياضية</h2>
      </div>

      <div className="kl-news-grid">
        {news.slice(0, 6).map((item) => (
          <a
            key={item.id}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="kl-news-card"
          >
            <div className="kl-news-thumb">
              <span className="kl-news-tag">{item.publisherName}</span>
              <span className="kl-news-date">{item.cairoTimeLabel}</span>
            </div>
            <h3 className="kl-news-title" dir={item.language === 'en' ? 'ltr' : 'rtl'}>
              {item.title}
            </h3>
          </a>
        ))}
      </div>
    </section>
  );
}
