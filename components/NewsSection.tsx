import { isIndexableNewsArticle } from '@/lib/news/validate';
import React from 'react';
import Link from 'next/link';
import { NewsItemRecord } from '@/lib/types';
import AdsterraNative from './AdsterraNative';

export default function NewsSection({
  news,
  lastUpdatedLabel,
  withNativeAd = false,
}: {
  news: NewsItemRecord[];
  lastUpdatedLabel?: string | null;
  /**
   * إعلان مدمج واحد في وسط شبكة الأخبار (يأخذ عرض الصف كاملًا).
   *
   * لماذا خاصية صريحة (opt-in) بدل تشغيله دائمًا؟
   * لأن حاوية الإعلان المدمج معرّف HTML فريد لا يجوز تكراره في الصفحة نفسها:
   * الصفحة الرئيسية وصفحات التواريخ تعرض هذا القسم **مع** جدول المباريات الذي
   * يحمل إعلانًا مدمجًا بالفعل، فلو أضفنا ثانيًا هنا لتكرّر المعرّف وذهب الإعلان
   * هدرًا. لذلك يُفعَّل هنا في صفحة الأخبار وحدها (حيث لا جدول مباريات)، ويُترك
   * مُعطَّلًا افتراضيًا في كل موضع آخر.
   */
  withNativeAd?: boolean;
}) {
  /*
   * بلا أخبار: لا يُرسم أي شيء — لا عنوان قسم فارغ ولا نص «ستظهر الأخبار هنا».
   * قسم فارغ يوحي بأن الموقع لا يعمل، وإخفاؤه يعرض صفحة نظيفة كاملة.
   */
  if (!news || news.length === 0) return null;

  /** موضع الإعلان المدمج: وسط الأخبار (بعد الخبر الثالث) وشريطة وجود أخبار كافية. */
  const nativeAdIndex = withNativeAd && news.length >= 5 ? 2 : -1;

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
          {news.map((item, index) => (
            <React.Fragment key={item.id}>
            {index === nativeAdIndex ? (
              <AdsterraNative
                className="kl-ad-native-grid-item"
                label="مساحة إعلانية مدفوعة داخل قسم الأخبار"
              />
            ) : null}
            <article className="kl-news-card">
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
            </React.Fragment>
          ))}
        </div>
    </section>
  );
}
