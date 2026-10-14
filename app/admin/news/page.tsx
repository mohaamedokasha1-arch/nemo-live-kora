import React from 'react';
import type { Metadata } from 'next';
import { SOURCE_CAPABILITIES } from '@/lib/news/capabilities';
import { getNewsAdminStats } from '@/lib/news/query';
import { hydrateStore } from '@/lib/db/store';
import { formatArabicTimestamp } from '@/lib/cairo-time';
import { getAdminPageIdentity } from '../_lib/guard';
import AdminNewsClient from './AdminNewsClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'لوحة مراقبة الأخبار',
  robots: { index: false, follow: false },
};

export default async function AdminNewsPage() {
  /**
   * الحماية كلها في مكان واحد: بوابة لوحة الإدارة (`app/admin/layout.tsx`) تتحقق من الجلسة
   * الموقَّعة على الخادم. لم يبقَ أي نموذج دخول قديم يضع رمز الإدارة المشترك داخل كوكي المتصفح.
   */
  const identity = await getAdminPageIdentity();
  if (!identity) return null;

  const db = await hydrateStore();
  const stats = getNewsAdminStats(db.news);

  return (
    <div className="kl-news-page kl-admin-page">
      <h1 className="kl-section-title">لوحة مراقبة الأخبار</h1>
      <AdminNewsClient />

      <section className="kl-admin-grid">
        <article><strong>المنشورة</strong><span>{stats.published}</span></article>
        <article><strong>الحديثة</strong><span>{stats.latest}</span></article>
        <article><strong>المكررة</strong><span>{stats.duplicates}</span></article>
        <article><strong>المرفوضة</strong><span>{stats.rejected}</span></article>
        <article><strong>بانتظار التحقق</strong><span>{stats.pending}</span></article>
        <article><strong>بدون تاريخ نشر</strong><span>{stats.unknownPublishDate}</span></article>
      </section>

      <section className="competition-groups-list">
        {Object.values(db.sources).map((source) => {
          const caps = SOURCE_CAPABILITIES[source.id];
          return (
            <div key={source.id} className="competition-group-box">
              <h2>{source.nameAr}</h2>
              <p>{source.statusLabelAr}</p>
              <p>{caps.newsAccessNoteAr}</p>
              <ul>
                <li>آخر مزامنة: {source.lastSyncAt ? formatArabicTimestamp(source.lastSyncAt) : 'لا توجد'}</li>
                <li>
                  آخر مزامنة أخبار ناجحة:{' '}
                  {source.lastSuccessfulNewsSyncAt
                    ? formatArabicTimestamp(source.lastSuccessfulNewsSyncAt)
                    : 'لا توجد'}
                </li>
                <li>أخبار مستوردة: {source.newsImportedCount}</li>
                <li>أخبار منشورة: {source.newsPublishedCount}</li>
                <li>HTTP: {source.lastHttpStatus ?? '—'}</li>
                <li>أخطاء: {source.errorCount}</li>
              </ul>
            </div>
          );
        })}
      </section>

      <section className="kl-section-head">
        <h2>آخر عمليات مزامنة الأخبار</h2>
        {db.newsSourceSyncs.length === 0 ? (
          <p>لا يوجد سجل مزامنة أخبار بعد.</p>
        ) : (
          <ul>
            {db.newsSourceSyncs.slice(0, 8).map((sync) => (
              <li key={sync.id}>
                {formatArabicTimestamp(sync.finishedAt)} — {sync.messageAr}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
