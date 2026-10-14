import React from 'react';
import Link from 'next/link';
import { formatArabicTimestamp, shiftDateString } from '@/lib/cairo-time';
import { getMatchSourceLabelAr } from '@/lib/catalog';
import type { ResolvedMatchView } from '@/lib/matches/types';
import { resolveWatchDestinationForView } from '@/lib/nemo-watch';
import AdSlot from './AdSlot';
import { shouldRenderAdSlot } from '@/lib/ads/config';
import StreamCta from './StreamCta';
import TeamCrest from './TeamCrest';
import WatchStreamBlock from './WatchStreamBlock';

/**
 * صفحة هبوط المباراة (Landing Gateway):
 * كل تفاصيل المباراة + الكلمات المفتاحية + زر تحويل واضح إلى صفحة البث الداخلية.
 * كل ما يظهر هنا مبني على بيانات المُحرّك المركزي (data/matches.ts) مدموجة مع المصادر الحيّة.
 */
export default function MatchLandingView({
  view,
  related = [],
}: {
  view: ResolvedMatchView;
  related?: ResolvedMatchView[];
}) {
  const { entry } = view;
  const previousDay = shiftDateString(entry.cairoDate, -1);
  const nextDay = shiftDateString(entry.cairoDate, 1);
  const sourceLabel = view.sourceMatch
    ? getMatchSourceLabelAr(view.sourceMatch.primarySource)
    : 'بيانات رسمية من مصادر رياضية معتمدة';
  const keywords = [...new Set([...(entry.keywords || []), ...(entry.seo?.keywords || [])])];
  // وجهة المشاهدة الموحّدة لهذه المباراة — تُحسب مرة واحدة وتُستخدم في كل أزرار الصفحة.
  const destination = resolveWatchDestinationForView(view);

  const score =
    view.score && Number.isFinite(view.score.home) && Number.isFinite(view.score.away)
      ? `${view.score.home} - ${view.score.away}`
      : null;

  return (
    <article className="kl-match-page" itemScope itemType="https://schema.org/SportsEvent">
      <nav className="kl-breadcrumb" aria-label="مسار التنقل">
        <Link href="/">الرئيسية</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/matches/${entry.cairoDate}`}>مباريات {entry.cairoDate}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">
          {entry.homeTeam.nameAr} ضد {entry.awayTeam.nameAr}
        </span>
      </nav>

      <header className="kl-match-hero">
        <div className="kl-match-hero-top">
          <span className="kl-competition-chip">
            {entry.competition.nameAr}
            {entry.competition.roundLabelAr ? ` — ${entry.competition.roundLabelAr}` : ''}
          </span>
          <span
            className={`kl-status-pin ${
              view.isLive
                ? 'kl-pin-live'
                : view.isFinished
                ? 'kl-pin-finished'
                : view.status === 'postponed' || view.status === 'cancelled'
                ? 'kl-pin-warn'
                : 'kl-pin-upcoming'
            }`}
          >
            {view.isLive && <span className="kl-live-dot" aria-hidden="true" />}
            {view.statusLabelAr}
          </span>
        </div>

        <h1 className="kl-match-title">
          {entry.homeTeam.nameAr} ضد {entry.awayTeam.nameAr}
        </h1>
        <p className="kl-match-subtitle" itemProp="description">
          مباراة {entry.homeTeam.nameAr} و{entry.awayTeam.nameAr} في {entry.competition.nameAr} —{' '}
          {view.cairoDateLabelAr} الساعة {view.kickoffTimeAr} بتوقيت القاهرة
          {view.venueName ? ` على ${view.venueName}` : ''}.
        </p>

        <div className="kl-match-teams">
          <div className="kl-match-team">
            <TeamCrest
              nameAr={entry.homeTeam.nameAr}
              logoUrl={entry.homeTeam.logoUrl ?? null}
              isEgyptian={entry.homeTeam.countryCode === 'EG'}
              size={72}
            />
            <span className="kl-match-team-name">{entry.homeTeam.nameAr}</span>
            <span className="kl-match-team-role">المستضيف</span>
          </div>

          <div className="kl-match-center">
            {score ? <span className="kl-score-badge">{score}</span> : null}
            <span className="kl-match-time">{view.kickoffTimeAr}</span>
            <span className="kl-match-datetime">{view.cairoDateLabelAr}</span>
          </div>

          <div className="kl-match-team">
            <TeamCrest
              nameAr={entry.awayTeam.nameAr}
              logoUrl={entry.awayTeam.logoUrl ?? null}
              isEgyptian={entry.awayTeam.countryCode === 'EG'}
              size={72}
            />
            <span className="kl-match-team-name">{entry.awayTeam.nameAr}</span>
            <span className="kl-match-team-role">الضيف</span>
          </div>
        </div>

        {view.statusNoteAr ? (
          <p className="kl-match-status-note" role="status">
            {view.statusNoteAr}
          </p>
        ) : null}

        {/*
          زر المشاهدة الرئيسي الموحّد: أحمر بارز، يفتح بوابة المشاهدة على منصة NEMO
          Sports في نافذة جديدة، وتحته مباشرة ملاحظة صادقة عن حالة البث.
          الوجهة تُحسب من lib/nemo-watch.ts لكل مباراة بلا استثناء.
        */}
        <WatchStreamBlock destination={destination} />

        {/*
          الرابط الداخلي الثانوي: يحتفظ ببوابة المشاهدة على البوابة نفسها
          (/live/[match-id]) لمن يفضّل البقاء داخل الموقع — وهي صفحة تحمل بيانات
          المباراة ومساحاتها الإعلانية.
        */}
        <p className="kl-watch-internal">
          أو تابع التفاصيل داخل البوابة:{' '}
          <Link href={view.livePath}>صفحة المشاهدة على نيمو كورة لايف</Link>
        </p>
      </header>

      <section className="kl-match-details" aria-label="تفاصيل المباراة">
        <h2 className="kl-section-subtitle">تفاصيل المباراة</h2>
        <dl className="kl-details-grid">
          <div>
            <dt>البطولة</dt>
            <dd>{entry.competition.nameAr}</dd>
          </div>
          <div>
            <dt>الجولة</dt>
            <dd>{entry.competition.roundLabelAr || 'غير محددة'}</dd>
          </div>
          <div>
            <dt>الموعد</dt>
            <dd>
              {view.cairoDateLabelAr} — {view.kickoffTimeAr} بتوقيت القاهرة
            </dd>
          </div>
          <div>
            <dt>الملعب</dt>
            <dd>{view.venueName}</dd>
          </div>
          <div>
            <dt>المدينة</dt>
            <dd>{entry.venue.cityAr || entry.venue.cityEn || 'غير محددة'}</dd>
          </div>
          <div>
            <dt>حالة المباراة</dt>
            <dd>{view.statusLabelAr}</dd>
          </div>
          <div>
            <dt>مصدر البيانات</dt>
            <dd>{sourceLabel}</dd>
          </div>
          <div>
            <dt>آخر تحديث</dt>
            <dd>{formatArabicTimestamp(view.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="kl-match-how" aria-label="كيف تشاهد المباراة">
        <h2 className="kl-section-subtitle">كيف تشاهد المباراة؟</h2>
        <ol className="kl-steps">
          <li>
            ادخل إلى <strong>صفحة المشاهدة</strong> من الزر بالأسفل — الصفحة داخل الموقع ولا تحتاج أي
            تسجيل أو تحميل برامج.
          </li>
          <li>
            تعرّف على حالة البث الفعلية: نعرض رابطًا خارجيًا فقط بعد التحقق منه، وإلا نوضّح ذلك بصراحة
            بدلًا من فتح صفحة عامة.
          </li>
          <li>
            تابع النتيجة والحالة المحدّثة لحظة بلحظة، ثم عد إلى هذه الصفحة لكل التفاصيل والتشكيلات
            والملخص.
          </li>
        </ol>
        <StreamCta view={view} variant="inline" />
      </section>

      {shouldRenderAdSlot(process.env.NEXT_PUBLIC_ADSENSE_SLOT_MATCH_BODY) ? (
          <AdSlot
            format="in-article"
            slotId={process.env.NEXT_PUBLIC_ADSENSE_SLOT_MATCH_BODY}
            label="مساحة إعلانية داخل صفحة المباراة"
          />
        ) : null}

      <section className="kl-match-keywords" aria-label="كلمات مفتاحية">
        <h2 className="kl-section-subtitle">كل ما يتعلق بالمباراة</h2>
        <ul className="kl-keyword-list">
          {keywords.map((keyword) => (
            <li key={keyword}>{keyword}</li>
          ))}
        </ul>
      </section>

      <section className="kl-match-related" aria-label="مباريات أخرى">
        <h2 className="kl-section-subtitle">مباريات أخرى على البوابة</h2>
        <div className="kl-related-grid">
          <Link href={`/matches/${previousDay}`} className="kl-related-link">
            جدول مباريات {previousDay}
          </Link>
          <Link href={`/matches/${nextDay}`} className="kl-related-link">
            جدول مباريات {nextDay}
          </Link>
          {related
            .filter((item) => item.entry.id !== entry.id)
            .map((item) => (
              <Link
                key={item.entry.id}
                href={item.canonicalPath}
                className="kl-related-link kl-related-match"
              >
                {item.entry.homeTeam.nameAr} ضد {item.entry.awayTeam.nameAr}
                <small>
                  {item.entry.competition.nameAr} — {item.cairoDateLabelAr}
                </small>
              </Link>
            ))}
        </div>
      </section>
    </article>
  );
}
