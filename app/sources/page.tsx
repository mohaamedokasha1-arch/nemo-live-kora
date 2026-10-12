import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatArabicTimestamp } from '@/lib/cairo-time';
import { SOURCE_CAPABILITIES } from '@/lib/news/capabilities';
import { getNewsAdminStats } from '@/lib/news/query';
import { getGatewayDatabase } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'حالة المصادر الخمسة المعتمدة وسجل المزامنة',
  description:
    'لوحة الشفافية التقنية للمصادر الخمسة المعتمدة مع التمييز بين مصادر المباريات ومصدر الأخبار، دون اعتبار استجابة HTTP وحدها نجاحًا.',
};

function sourcePublicState(sourceId: keyof typeof SOURCE_CAPABILITIES, lastHttp: number | null, lastSync: string | null, newsPublished: number) {
  const caps = SOURCE_CAPABILITIES[sourceId];
  if (caps.providesNews) {
    if (newsPublished > 0 && lastSync) return 'تم استيراد ونشر أخبار بعد التحقق';
    if (lastHttp && lastHttp >= 200 && lastHttp < 300 && lastSync) return 'تم الاتصال دون نشر أخبار بعد';
    if (!lastSync) return 'المصدر معروف ويحتاج مزامنة حية';
    return 'المصدر متعطل مؤقتًا أو لم تُجلب أخبار';
  }
  if (lastHttp && lastHttp >= 200 && lastHttp < 300) return 'مصدر مباريات — الاتصال يعمل للبيانات التي يدعمها';
  if (!lastSync) return 'المصدر معروف';
  return 'مصدر مباريات — تعذر التحديث الأخير مع الاحتفاظ بالبيانات السابقة';
}

export default function SourcesPage() {
  const db = getGatewayDatabase();
  const sourcesList = Object.values(db.sources);
  const newsStats = getNewsAdminStats(db.news);

  return (
    <div className="container" style={{ paddingTop: '1.5rem', paddingBottom: '2rem' }}>
      <section className="sources-page-section">
        <div className="section-header-bar">
          <h1 className="section-title">حالة المصادر الخمسة المعتمدة</h1>
          <p className="section-subtitle">
            أربعة مصادر تغذي المباريات والترتيب. مصدر واحد فقط يوفّر أخبارًا (Google News RSS). لا تُعرض نتيجة مباراة باعتبارها خبرًا، ولا يُعد نجاح HTTP وحده دليل استيراد.
          </p>
          <p className="kl-news-updated">
            أخبار منشورة: {newsStats.published} · حديثة: {newsStats.latest} · مكررة: {newsStats.duplicates} · مرفوضة: {newsStats.rejected}
            {db.meta.lastSuccessfulNewsSyncAt
              ? ` · آخر مزامنة أخبار ناجحة: ${formatArabicTimestamp(db.meta.lastSuccessfulNewsSyncAt)}`
              : ' · لا توجد مزامنة أخبار ناجحة بعد'}
          </p>
        </div>

        <div className="competition-groups-list">
          {sourcesList.map((src, idx) => {
            const caps = SOURCE_CAPABILITIES[src.id];
            return (
              <div key={src.id} className="competition-group-box">
                <div className="competition-group-header">
                  <div className="comp-header-right">
                    <span className="comp-header-icon">#{idx + 1}</span>
                    <div>
                      <h2 className="comp-header-title">
                        {src.nameAr}
                        <span
                          className={`status-badge ${
                            src.status === 'active'
                              ? 'status-upcoming'
                              : src.status === 'partial_keyless' || src.status === 'requires_api_key'
                              ? 'status-warning'
                              : 'status-danger'
                          }`}
                        >
                          {src.statusLabelAr}
                        </span>
                      </h2>
                      <span className="comp-header-sub" dir="ltr">
                        {src.type} · {src.baseUrl}
                      </span>
                    </div>
                  </div>
                  <span className="comp-nemo-link">
                    {sourcePublicState(
                      src.id,
                      src.lastHttpStatus,
                      src.lastSyncAt,
                      src.newsPublishedCount || 0
                    )}
                  </span>
                </div>

                <div style={{ padding: '1rem', fontSize: '0.86rem' }}>
                  <p style={{ marginBottom: '0.6rem', fontWeight: 700 }}>{caps.newsAccessNoteAr}</p>
                  <p>
                    القدرات:{' '}
                    {caps.providesMatches ? 'مباريات' : 'ليست مباريات'}
                    {' · '}
                    {caps.providesStandings ? 'ترتيب' : 'بدون ترتيب'}
                    {' · '}
                    {caps.providesNews ? 'أخبار' : 'ليست مصدر أخبار'}
                  </p>
                  <p>
                    آخر مزامنة: {src.lastSyncAt ? formatArabicTimestamp(src.lastSyncAt) : 'غير متاحة'}
                    {src.lastHttpStatus ? ` · HTTP ${src.lastHttpStatus}` : ''}
                  </p>
                  {caps.providesNews ? (
                    <p>
                      أخبار منشورة من هذا المصدر: {src.newsPublishedCount || 0}
                      {src.lastSuccessfulNewsSyncAt
                        ? ` · آخر نجاح: ${formatArabicTimestamp(src.lastSuccessfulNewsSyncAt)}`
                        : ' · لم تُثبت مزامنة أخبار ناجحة بعد'}
                    </p>
                  ) : (
                    <p>إذا لم تظهر أخبار من هذا المصدر فالسبب أنه لا يوفّر خلاصة أخبار.</p>
                  )}
                  {src.requiresKey && !src.isKeyConfigured ? (
                    <p>يحتاج إلى إعداد المتغير البيئي {src.keyEnvVar} لتفعيل الجلب المباشر.</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="standings-card" style={{ marginBottom: '1.5rem' }}>
          <div className="standings-card-header">
            <div>
              <h2 className="standings-card-title">
                جدول الربط والتحقق من مسارات المباريات على NEMO Sports
              </h2>
              <span className="standings-card-source">
                يضمن عدم توجيه الزائر إلى مباراة قديمة في حال تشابه أسماء الفرق بين المواسم
              </span>
            </div>
            <Link href="/" className="standings-nemo-link">
              العودة إلى جدول المباريات ←
            </Link>
          </div>
          <div className="table-responsive">
            <table className="standings-table">
              <thead>
                <tr>
                  <th>معرّف المباراة في البوابة</th>
                  <th>التاريخ (القاهرة)</th>
                  <th>معرّف TheSportsDB</th>
                  <th>معرّف API-Football</th>
                  <th>المسار المباشر على NEMO Sports</th>
                  <th>نتيجة التحقق</th>
                </tr>
              </thead>
              <tbody>
                {db.nemoMappingTable.map((entry) => (
                  <tr key={entry.canonicalMatchId}>
                    <td dir="ltr" style={{ fontSize: '0.76rem' }}>
                      <code>{entry.canonicalMatchId}</code>
                    </td>
                    <td>{entry.cairoDate}</td>
                    <td dir="ltr">{entry.thesportsdbEventId || '—'}</td>
                    <td dir="ltr">{entry.apiFootballFixtureId || '—'}</td>
                    <td dir="ltr">
                      {entry.verifiedNemoMatchSlug ? (
                        <a
                          href={`https://nemo-sports.vercel.app/matches/${entry.verifiedNemoMatchSlug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="standings-team-link"
                        >
                          /matches/{entry.verifiedNemoMatchSlug} ↗
                        </a>
                      ) : (
                        <a
                          href={`https://nemo-sports.vercel.app/competitions/${entry.verifiedNemoCompetitionSlug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="standings-team-link"
                        >
                          /competitions/{entry.verifiedNemoCompetitionSlug} (بديل آمن) ↗
                        </a>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{entry.verificationNoteAr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
