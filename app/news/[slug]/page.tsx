import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGatewayDatabase } from '@/lib/db/store';
import { findNewsBySlug, getRelatedPublishedNews } from '@/lib/news/query';

export const dynamic = 'force-dynamic';

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://nemo-live-kora.vercel.app';

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const db = getGatewayDatabase();
  const item = findNewsBySlug(db.news, params.slug);
  if (!item) {
    return {
      title: 'الخبر غير موجود',
      robots: { index: false, follow: false },
    };
  }

  const description =
    item.excerpt ||
    `${item.title} — خبر من ${item.publisherName}${item.publishedAtKnown ? '' : ' — تاريخ النشر غير معروف'}.`;

  return {
    title: item.title,
    description,
    alternates: { canonical: `/news/${item.slug}` },
    openGraph: {
      type: 'article',
      locale: item.language === 'en' ? 'en_US' : 'ar_EG',
      title: item.title,
      description,
      url: `${GATEWAY_URL}/news/${item.slug}`,
      siteName: 'نيمو كورة لايف — NEMO Sports',
    },
    robots: { index: true, follow: true },
  };
}

export default async function NewsArticlePage({
  params,
}: {
  params: { slug: string };
}) {
  const db = getGatewayDatabase();
  const item = findNewsBySlug(db.news, params.slug);
  if (!item) notFound();

  const related = getRelatedPublishedNews(db.news, item, 4);
  const relatedMatches = db.matches.filter((match) => item.relatedMatchIds.includes(match.id));
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: item.title,
    inLanguage: item.language === 'en' ? 'en' : 'ar',
    mainEntityOfPage: `${GATEWAY_URL}/news/${item.slug}`,
    author: {
      '@type': 'Organization',
      name: item.publisherName,
      url: item.publisherUrl || undefined,
    },
    publisher: {
      '@type': 'Organization',
      name: 'نيمو كورة لايف',
      url: GATEWAY_URL,
    },
    description: item.excerpt || item.title,
    url: `${GATEWAY_URL}/news/${item.slug}`,
  };
  if (item.publishedAtKnown && item.publishedAt) {
    jsonLd.datePublished = item.publishedAt;
  }
  if (item.updatedAt) {
    jsonLd.dateModified = item.updatedAt;
  }

  return (
    <article className="kl-news-article">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="kl-section-head">
        <p className="kl-breadcrumb">
          <Link href="/">الرئيسية</Link>
          <span> / </span>
          <Link href="/news">الأخبار</Link>
          <span> / </span>
          <span>{item.publisherName}</span>
        </p>
        <h1 className="kl-article-title" dir={item.language === 'en' ? 'ltr' : 'rtl'}>
          {item.title}
        </h1>
        <p className="kl-article-meta">
          <span>{item.publisherName}</span>
          <span>·</span>
          <span>{item.cairoTimeLabel}</span>
          <span>·</span>
          <span>{item.categoryAr}</span>
        </p>
      </header>

      {item.excerpt ? (
        <p className="kl-article-excerpt" dir={item.language === 'en' ? 'ltr' : 'rtl'}>
          {item.excerpt}
        </p>
      ) : (
        <p className="kl-article-excerpt kl-article-excerpt-note">
          لم يوفّر المصدر مقتطفًا إضافيًا غير العنوان. لا نولّد تفاصيل غير موجودة في الخلاصة.
        </p>
      )}

      <div className="kl-article-actions">
        {item.originalUrl ? (
          <a
            className="kl-nav-cta"
            href={item.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            اقرأ الخبر من المصدر الأصلي
          </a>
        ) : null}
        {item.nemoRelatedUrl ? (
          <a
            className="kl-day-btn"
            href={item.nemoRelatedUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {item.nemoRelatedLabelAr || 'صفحة ذات صلة على NEMO Sports'}
          </a>
        ) : null}
      </div>

      {relatedMatches.length > 0 ? (
        <section className="kl-article-context">
          <h2>سياق من جدول المباريات</h2>
          <p>هذه الروابط مبنية على بيانات المباريات الموثقة في البوابة، وليست نصًا منسوبًا إلى مصدر الخبر.</p>
          <ul>
            {relatedMatches.slice(0, 3).map((match) => (
              <li key={match.id}>
                {match.nemoLink.url ? (
                  <a href={match.nemoLink.url} target="_blank" rel="noopener noreferrer">
                    {match.homeTeam.nameAr} ضد {match.awayTeam.nameAr} — {match.cairoDate}
                  </a>
                ) : (
                  <span>
                    {match.homeTeam.nameAr} ضد {match.awayTeam.nameAr} — {match.cairoDate}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {related.length > 0 ? (
        <section className="kl-article-related">
          <h2>أخبار ذات صلة</h2>
          <ul>
            {related.map((rel) => (
              <li key={rel.id}>
                <Link href={`/news/${rel.slug}`}>{rel.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
