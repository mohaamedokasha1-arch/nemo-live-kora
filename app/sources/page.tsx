import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatArabicTimestamp } from '@/lib/cairo-time';
import { getGatewayDatabase } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'حالة المصادر الخمسة المعتمدة وسجل المزامنة',
  description:
    'لوحة الشفافية التقنية للمصادر الخمسة المعتمدة (SportScore, Football-Data.org, TheSportsDB, API-Football, Google News RSS) وجدول مطابقة روابط NEMO Sports.',
};

export default function SourcesPage() {
  const db = getGatewayDatabase();
  const sourcesList = Object.values(db.sources);

  return (
    <div className="container" style={{ paddingTop: '1.5rem', paddingBottom: '2rem' }}>
      <section className="sources-page-section">
        <div className="section-header-bar">
          <h1 className="section-title">🔌 لوحة حالة المصادر الخمسة المعتمدة وسجل المزامنة</h1>
          <p className="section-subtitle">
            توثيق حي وحقيقي لحالة كل مصدر من المصادر الخمسة المعتمدة ونوع البيانات المستوردة وحدود الاستخدام وجدول مطابقة الروابط مع NEMO Sports.
          </p>
        </div>

        {/* 5 Approved Sources Cards */}
        <div className="competition-groups-list">
          {sourcesList.map((src, idx) => (
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
                  السجلات المستوردة: {src.recordsImported} · آخر فحص:{' '}
                  {src.lastSyncAt ? formatArabicTimestamp(src.lastSyncAt) : 'غير متاح'}
                </span>
              </div>

              <div style={{ padding: '1rem', fontSize: '0.86rem' }}>
                <p style={{ marginBottom: '0.6rem', fontWeight: 700 }}>{src.notesAr}</p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: '0.75rem',
                  }}
                >
                  <div>
                    <strong>البيانات التي يغذيها المصدر:</strong>
                    <ul style={{ paddingRight: '1.2rem', marginTop: '0.25rem' }}>
                      {src.dataTypesProvided.map((dt) => (
                        <li key={dt}>{dt}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong>المسارات المختبرة فعليًا:</strong>
                    <ul
                      style={{
                        paddingRight: '1.2rem',
                        marginTop: '0.25rem',
                        direction: 'ltr',
                        textAlign: 'left',
                        fontSize: '0.78rem',
                      }}
                    >
                      {src.testedEndpoints.map((ep) => (
                        <li key={ep}>
                          <code>{ep}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong>سياسة التخزين المؤقت والحدود:</strong>
                    <p style={{ marginTop: '0.25rem' }}>{src.rateLimitPolicy}</p>
                    <p style={{ marginTop: '0.25rem' }}>
                      <strong>المفتاح البيئي:</strong>{' '}
                      <code>{src.keyEnvVar || 'لا يتطلب مفتاحًا (مجاني مفتوح)'}</code>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* NEMO Sports Verified Match Mapping Table */}
        <div className="standings-card" style={{ marginBottom: '1.5rem' }}>
          <div className="standings-card-header">
            <div>
              <h2 className="standings-card-title">
                🔗 جدول الربط والتحقق من مسارات المباريات على NEMO Sports
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
