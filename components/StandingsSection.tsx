import React from 'react';
import { CompetitionStandingTable } from '@/lib/types';

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
                  {egyptTable.rows.map((row) => (
                    <tr key={row.teamId}>
                      <td className="pos-cell">{row.position}</td>
                      <td className="team-cell">
                        <div className="standings-team-wrap">
                          {row.teamLogo && (
                            <img
                              src={row.teamLogo}
                              alt={row.teamNameAr}
                              className="standings-team-logo"
                              loading="lazy"
                            />
                          )}
                          {row.nemoTeamUrl ? (
                            <a
                              href={row.nemoTeamUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="standings-team-link"
                            >
                              {row.teamNameAr}
                            </a>
                          ) : (
                            <span>{row.teamNameAr}</span>
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
                  ))}
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
                    {cafTable.rows.map((row) => (
                      <tr key={row.teamId}>
                        <td className="pos-cell">{row.position}</td>
                        <td className="team-cell">
                          {row.nemoTeamUrl ? (
                            <a
                              href={row.nemoTeamUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="standings-team-link"
                            >
                              {row.teamNameAr}
                            </a>
                          ) : (
                            <span>{row.teamNameAr}</span>
                          )}
                        </td>
                        <td>{row.played}</td>
                        <td dir="ltr">
                          {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                        </td>
                        <td className="pts-cell">{row.points}</td>
                      </tr>
                    ))}
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
                    {splTable.rows.map((row) => (
                      <tr key={row.teamId}>
                        <td className="pos-cell">{row.position}</td>
                        <td className="team-cell">{row.teamNameAr}</td>
                        <td>{row.played}</td>
                        <td dir="ltr">
                          {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                        </td>
                        <td className="pts-cell">{row.points}</td>
                      </tr>
                    ))}
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
