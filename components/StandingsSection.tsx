import React from 'react';
import Image from 'next/image';
import { CompetitionStandingTable } from '@/lib/types';
import { resolveTeamDisplayIdentity } from '@/lib/catalog';

/**
 * اسم النادي المعروض داخل صف الجدول + هل يصحّ ربطه بصفحة النادي على NEMO Sports؟
 *
 * مصدر الترتيب نفسه قد يرسل قيمة تقنية في خانة الاسم (نفس عيب «Team dj2ryoh2w90q1zp»
 * المُثبت في جدول المباريات). القيمة التقنية تُعرض بعبارة واضحة، و**لا** يُبنى منها رابط
 * نادٍ على منصة NEMO Sports لأن `…/teams/Team%20dj2ryoh2w90q1zp` ليس صفحة موجودة.
 * أما الأسماء الحقيقية فتبقى كما هي بنفس الرابط تمامًا — لا تغيير في أي وجهة قائمة.
 */
function rowTeamDisplay(row: CompetitionStandingTable['rows'][number]) {
  const identity = resolveTeamDisplayIdentity({
    id: row.teamId,
    nameAr: row.teamNameAr,
    nameEn: row.teamNameEn,
  });
  return {
    displayName: identity.displayName,
    isArabicName: identity.isArabicName,
    href: identity.isPlaceholder ? null : row.nemoTeamUrl || null,
  };
}

export default function StandingsSection({
  standings,
}: {
  standings: Record<string, CompetitionStandingTable>;
}) {
  const egyptTable = standings['EGY'];
  const cafTable = standings['CAF'];
  const splTable = standings['SPL'];

  if (!egyptTable && !cafTable && !splTable) {
    return null;
  }

  return (
    <section id="standings" className="standings-section" aria-label="جدول ترتيب البطولات">
      <div className="section-header-bar">
        <div>
          <h2 className="section-title">📊 جدول ترتيب الدوري المصري والبطولات الكبرى</h2>
          <p className="section-subtitle">
            بيانات حقيقية موثقة من مصدر SportScore مع روابط مباشرة لصفحات الأندية والبطولات على NEMO Sports
          </p>
        </div>
      </div>

      <div className="standings-grid">
        {egyptTable && (
          <div className="standings-card standings-card-primary">
            <div className="standings-card-header">
              <div>
                <h3 className="standings-card-title">
                  🇪🇬 {egyptTable.competitionNameAr} ({egyptTable.seasonLabel})
                </h3>
                <span className="standings-card-source">
                  المصدر: SportScore · أول 10 مراكز
                </span>
              </div>
              {egyptTable.nemoCompetitionUrl && (
                <a
                  href={egyptTable.nemoCompetitionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="standings-nemo-link"
                >
                  الجدول الكامل والهدافون على NEMO Sports ↗
                </a>
              )}
            </div>

            <div className="table-responsive">
              <table className="standings-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>النادي</th>
                    <th>لعب</th>
                    <th>فوز</th>
                    <th>تعادل</th>
                    <th>خسارة</th>
                    <th>له/عليه</th>
                    <th>الفارق</th>
                    <th>النقاط</th>
                  </tr>
                </thead>
                <tbody>
                  {egyptTable.rows.map((row) => {
                    const team = rowTeamDisplay(row);
                    return (
                    <tr key={row.teamId}>
                      <td className="pos-cell">{row.position}</td>
                      <td className="team-cell">
                        <div className="standings-team-wrap">
                          {row.teamLogo && (
                            <Image
                              src={row.teamLogo}
                              alt={team.displayName}
                              width={24}
                              height={24}
                              unoptimized
                              className="standings-team-logo"
                              loading="lazy"
                            />
                          )}
                          {team.href ? (
                            <a
                              href={team.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="standings-team-link"
                              dir="auto"
                              lang={team.isArabicName ? 'ar' : 'en'}
                            >
                              {team.displayName}
                            </a>
                          ) : (
                            <span dir="auto" lang={team.isArabicName ? 'ar' : 'en'}>{team.displayName}</span>
                          )}
                        </div>
                      </td>
                      <td>{row.played}</td>
                      <td>{row.won}</td>
                      <td>{row.drawn}</td>
                      <td>{row.lost}</td>
                      <td dir="ltr">
                        {row.goalsFor}:{row.goalsAgainst}
                      </td>
                      <td dir="ltr">{row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
                      <td className="pts-cell">{row.points}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="standings-side-stack">
          {cafTable && (
            <div className="standings-card">
              <div className="standings-card-header">
                <div>
                  <h3 className="standings-card-title">
                    🌍 {cafTable.competitionNameAr} ({cafTable.seasonLabel})
                  </h3>
                  <span className="standings-card-source">
                    أبرز الأندية المصرية والأفريقية
                  </span>
                </div>
                {cafTable.nemoCompetitionUrl && (
                  <a
                    href={cafTable.nemoCompetitionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="standings-nemo-link"
                  >
                    صفحة البطولة ↗
                  </a>
                )}
              </div>
              <div className="table-responsive">
                <table className="standings-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>الفريق</th>
                      <th>لعب</th>
                      <th>الفارق</th>
                      <th>النقاط</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cafTable.rows.map((row) => {
                      const team = rowTeamDisplay(row);
                      return (
                      <tr key={row.teamId}>
                        <td className="pos-cell">{row.position}</td>
                        <td className="team-cell">
                          {team.href ? (
                            <a
                              href={team.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="standings-team-link"
                              dir="auto"
                              lang={team.isArabicName ? 'ar' : 'en'}
                            >
                              {team.displayName}
                            </a>
                          ) : (
                            <span dir="auto" lang={team.isArabicName ? 'ar' : 'en'}>{team.displayName}</span>
                          )}
                        </td>
                        <td>{row.played}</td>
                        <td dir="ltr">
                          {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                        </td>
                        <td className="pts-cell">{row.points}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {splTable && (
            <div className="standings-card">
              <div className="standings-card-header">
                <div>
                  <h3 className="standings-card-title">
                    🇸🇦 {splTable.competitionNameAr} ({splTable.seasonLabel})
                  </h3>
                  <span className="standings-card-source">صدارة الترتيب</span>
                </div>
                {splTable.nemoCompetitionUrl && (
                  <a
                    href={splTable.nemoCompetitionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="standings-nemo-link"
                  >
                    صفحة البطولة ↗
                  </a>
                )}
              </div>
              <div className="table-responsive">
                <table className="standings-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>النادي</th>
                      <th>لعب</th>
                      <th>الفارق</th>
                      <th>النقاط</th>
                    </tr>
                  </thead>
                  <tbody>
                    {splTable.rows.map((row) => {
                      const team = rowTeamDisplay(row);
                      return (
                      <tr key={row.teamId}>
                        <td className="pos-cell">{row.position}</td>
                        <td className="team-cell" dir="auto" lang={team.isArabicName ? 'ar' : 'en'}>
                          {team.displayName}
                        </td>
                        <td>{row.played}</td>
                        <td dir="ltr">
                          {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                        </td>
                        <td className="pts-cell">{row.points}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
