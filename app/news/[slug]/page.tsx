import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hydrateStore } from '@/lib/db/store';
import { findNewsBySlug, getRelatedPublishedNews } from '@/lib/news/query';
import { isIndexableNewsArticle } from '@/lib/news/validate';
import { GATEWAY_SITE_URL } from '@/lib/site-url';
import { serializeJsonLd } from '@/lib/seo/match-structured-data';
import AdsterraBanner from '@/components/AdsterraBanner';
import AdsterraNative from '@/components/AdsterraNative';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const db = await hydrateStore();
  const item = findNewsBySlug(db.news, slug);
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
      url: `${GATEWAY_SITE_URL}/news/${item.slug}`,
      siteName: 'نيمو كورة لايف — NEMO Sports',
    },
    robots: { index: isIndexableNewsArticle(item), follow: true },
  };
}

export default async function NewsArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = await hydrateStore();
  const item = findNewsBySlug(db.news, slug);
  if (!item) notFound();

  const related = getRelatedPublishedNews(db.news, item, 4);
  // نصّ الخبر المكتوب في لوحة الإدارة: يُعرض على الصفحة العامة فعلًا (محتوى الموقع نفسه).
  // أخبار المصادر لا نصّ كاملًا لها لدينا، فلا نخترع نصًّا: المقتطف وحده هو المتاح.
  const firstPartyBody = item.origin === 'manual' ? (item.bodyText || '').trim() : '';
  const bodyParagraphs = firstPartyBody
    ? firstPartyBody
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
    : [];
  const relatedMatches = db.matches.filter((match) => item.relatedMatchIds.includes(match.id));
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: item.title,
    inLanguage: item.language === 'en' ? 'en' : 'ar',
    mainEntityOfPage: `${GATEWAY_SITE_URL}/news/${item.slug}`,
    author: {
      '@type': 'Organization',
      name: item.publisherName,
      url: item.publisherUrl || undefined,
    },
    publisher: {
      '@type': 'Organization',
      name: 'نيمو كورة لايف',
      url: GATEWAY_SITE_URL,
    },
    description: item.excerpt || item.title,
    url: `${GATEWAY_SITE_URL}/news/${item.slug}`,
  };
  if (item.publishedAtKnown && item.publishedAt) {
    jsonLd.datePublished = item.publishedAt;
  }
  if (item.updatedAt) {
    jsonLd.dateModified = item.updatedAt;
  }
  if (firstPartyBody) {
    jsonLd.articleBody = firstPartyBody;
  }

  return (
    <article className="kl-news-article">
      {isIndexableNewsArticle(item) ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      ) : null}
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
      ) : bodyParagraphs.length > 0 ? null : (
        <p className="kl-article-excerpt kl-article-excerpt-note">
          لم يوفّر المصدر مقتطفًا إضافيًا غير العنوان. لا نولّد تفاصيل غير موجودة في الخلاصة.
        </p>
      )}

      {/*
        وحدة إعلانية جانبية بمقاس 300×250: على شاشات الكمبيوتر تطفو إلى جانب نص
        الخبر (موضع العمود الجانبي المعتاد في صفحات المقالات)، وعلى الهاتف تصبح
        وحدة مركزيّة بعرض كامل بعد المقتطف — بلا تمرير أفقي وبلا إزاحة تخطيط.
      */}
      <AdsterraBanner
        size="300x250"
        className="kl-ad-article-side"
        label="مساحة إعلانية جانبية في صفحة الخبر"
      />

      {bodyParagraphs.length > 0 ? (
        <div className="kl-article-body" dir={item.language === 'en' ? 'ltr' : 'rtl'}>
          {bodyParagraphs.map((paragraph, index) => (
            <p key={`${item.id}-p${index}`}>{paragraph}</p>
          ))}
        </div>
      ) : null}

      {/*
        الإعلان المدمج (Native) بعد نص الخبر: يظهر كأنه بطاقة محتوى إضافية داخل
        تدفّق الصفحة، ووسم «إعلان» الصغير يفصله بصراحة عن محتوى الموقع.
      */}
      <AdsterraNative className="kl-ad-native-article" label="مساحة إعلانية مدفوعة بعد نص الخبر" />

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
                {/* Plain text: the news item has no independently verified match destination. */}
                <span>
                  {match.homeTeam.nameAr} ضد {match.awayTeam.nameAr} — {match.cairoDate}
                </span>
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
