import React from 'react';
import Link from 'next/link';
import { getMatchSourceLabelAr } from '@/lib/catalog';
import { resolveUpcomingMatchViews } from '@/lib/matches/match-catalog';
import TeamCrest from './TeamCrest';

/**
 * قسم «بوابة المباريات» في الصفحة الرئيسية:
 * يربط الزائر داخليًا بصفحات هبوط المباريات (وهي التي تحمل البيانات المنظمة الكاملة
 * وزر التحويل إلى صفحة البث). روابط داخلية واضحة = فهرسة أفضل + وصول أسرع للمشاهدة.
 */
export default function FeaturedMatches({ limit = 4 }: { limit?: number }) {
  const views = resolveUpcomingMatchViews(limit);
  if (views.length === 0) return null;

  return (
    <section className="kl-featured" aria-label="مباريات مميزة على البوابة">
      <div className="kl-section-head">
        <h2 className="kl-section-title">بوابة المباريات — صفحات كاملة لكل لقاء</h2>
        <span className="kl-date-pill">مواعيد بتوقيت القاهرة</span>
      </div>

      <div className="kl-featured-grid">
        {views.map((view) => {
          const { entry } = view;
          return (
            <article key={entry.id} className="kl-featured-card">
              <div className="kl-featured-top">
                <span className="kl-competition-chip">{entry.competition.nameAr}</span>
                <span
                  className={`kl-status-pin ${
                    view.isLive ? 'kl-pin-live' : view.isFinished ? 'kl-pin-finished' : 'kl-pin-upcoming'
                  }`}
                >
                  {view.isLive && <span className="kl-live-dot" aria-hidden="true" />}
                  {view.statusLabelAr}
                </span>
              </div>

              <div className="kl-featured-teams">
                <div className="kl-featured-team">
                  <TeamCrest
                    nameAr={entry.homeTeam.nameAr}
                    logoUrl={entry.homeTeam.logoUrl ?? null}
                    isEgyptian={entry.homeTeam.countryCode === 'EG'}
                    size={44}
                  />
                  <span>{entry.homeTeam.nameAr}</span>
                </div>
                <span className="kl-featured-vs">×</span>
                <div className="kl-featured-team">
                  <TeamCrest
                    nameAr={entry.awayTeam.nameAr}
                    logoUrl={entry.awayTeam.logoUrl ?? null}
                    isEgyptian={entry.awayTeam.countryCode === 'EG'}
                    size={44}
                  />
                  <span>{entry.awayTeam.nameAr}</span>
                </div>
              </div>

              <dl className="kl-featured-meta">
                <div>
                  <dt>الموعد</dt>
                  <dd>
                    {view.cairoDateLabelAr} — {view.kickoffTimeAr}
                  </dd>
                </div>
                <div>
                  <dt>الملعب</dt>
                  <dd>{view.venueName}</dd>
                </div>
                <div>
                  <dt>المصدر</dt>
                  <dd>
                    {view.sourceMatch
                      ? getMatchSourceLabelAr(view.sourceMatch.primarySource)
                      : 'كتالوج المباريات'}
                  </dd>
                </div>
              </dl>

              <div className="kl-featured-actions">
                <Link href={view.canonicalPath} className="kl-day-btn">
                  تفاصيل المباراة
                </Link>
                <Link href={view.livePath} className="kl-day-btn kl-day-btn-active">
                  {view.isFinished ? 'النتيجة والملخص' : 'المشاهدة المباشرة'}
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
