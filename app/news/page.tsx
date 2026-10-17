import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatArabicTimestamp, getTodayCairoDate } from '@/lib/cairo-time';
import { getGatewayDatabase, hydrateStore } from '@/lib/db/store';
import { getArchiveNews, getNewsListingItems } from '@/lib/news/query';
import { isIndexableNewsArticle } from '@/lib/news/validate';
import { ensureFreshNews } from '@/lib/sync/engine';
import NewsSection from '@/components/NewsSection';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const db = await hydrateStore();
  const hasIndexableCurrentNews = getNewsListingItems(db.news, 24).some(isIndexableNewsArticle);
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
  const displayed = getNewsListingItems(db.news, 24);
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
          نجمع الأخبار الرياضية تلقائيًا من مصادر موثوقة، ويظهر كل خبر بعنوانه ومصدره وتاريخ نشره
          الأصلي — بلا كتابة يدوية وبلا تكرار.
        </p>
        {lastOk ? (
          <p className="kl-news-updated">{`آخر تحديث للأخبار: ${formatArabicTimestamp(lastOk)}`}</p>
        ) : null}
      </header>
      {/*
        * لا رسالة سلبية ولا تأخير للمهمة أبدًا: القسم يعرض ما لدينا، وإن لم يكن هناك أي خبر
        * منشور بعد فالصفحة تقود الزائر إلى ما هو متاح دائمًا (جدول مباريات اليوم) مع سطر
        * واحد يوضّح آلية التحديث التلقائي بثقة.
        */}
      {displayed.length === 0 ? (
        <section className="kl-news-empty" aria-label="حالة الأخبار">
          <h2 className="kl-section-subtitle">الأخبار قيد الجلب الآن</h2>
          <p>
            تُجلب الأخبار الرياضية تلقائيًا من مصادر موثوقة وتظهر هنا فور اعتمادها، فلا حاجة لأي
            إضافة يدوية.
          </p>
          <Link className="kl-cta-btn" href={`/matches/${getTodayCairoDate()}`}>
            تابع جدول مباريات اليوم
          </Link>
        </section>
      ) : null}
      {/*
        إعلان مدمج واحد وسط الأخبار. هذه الصفحة لا تحمل جدول مباريات، فهي الموضع
        الوحيد الذي يُفعَّل فيه الإعلان المدمج داخل قسم الأخبار (معرّف حاوية واحد
        لكل صفحة كما تشترط الشبكة).
      */}
      <NewsSection
        news={displayed}
        lastUpdatedLabel={lastOk ? formatArabicTimestamp(lastOk) : null}
        withNativeAd
      />
      {archiveCount > 0 ? (
        <p className="kl-news-archive-link">
          <Link href="/news/archive">أرشيف الأخبار السابقة ({archiveCount})</Link>
        </p>
      ) : null}
    </div>
  );
}
