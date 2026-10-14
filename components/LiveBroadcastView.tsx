import React from 'react';
import Link from 'next/link';
import { formatArabicTimestamp } from '@/lib/cairo-time';
import { getMatchSourceLabelAr } from '@/lib/catalog';
import type { ResolvedMatchView } from '@/lib/matches/types';
import { resolveWatchDestinationForView } from '@/lib/nemo-watch';
import AdSlot from './AdSlot';
import { shouldRenderAdSlot } from '@/lib/ads/config';
import TeamCrest from './TeamCrest';
import WatchStreamBlock from './WatchStreamBlock';

/**
 * صفحة البث الداخلية /live/[match-id]
 * بوابة المشاهدة الرسمية على الموقع: بطاقة المباراة كاملة (الفريقان والشعارات والوقت
 * والبطولة) ثم **زر المشاهدة الأحمر الموحّد** الذي يفتح صفحة المشاهدة على منصة NEMO
 * Sports في نافذة جديدة — لكل مباراة بالكود نفسه، بلا أي كود خاص بمباراة بعينها،
 * ولا أي نص يشكّك الزائر في الموقع أو يُظهر مرحلة إعداد.
 */
export default function LiveBroadcastView({ view }: { view: ResolvedMatchView }) {
  const { entry } = view;
  const matchLabel = `${entry.homeTeam.nameAr} ضد ${entry.awayTeam.nameAr}`;
  const sourceLabel = view.sourceMatch
    ? getMatchSourceLabelAr(view.sourceMatch.primarySource)
    : 'بيانات رسمية من مصادر رياضية معتمدة';
  const score =
    view.score && Number.isFinite(view.score.home) && Number.isFinite(view.score.away)
      ? `${view.score.home} - ${view.score.away}`
      : null;
  /**
   * وجهة المشاهدة الموحّدة لهذه المباراة.
   *
   * هذا هو جوهرالنظام: صفحة المشاهدة الداخلية **لا تحتوي رابطًا خارجيًا واحدًا فقط**،
   * بل تعرض دائمًا زر المشاهدة الموحّد إلى منصة NEMO Sports في نافذة جديدة — لكل
   * مباراة بلا استثناء، سواء كان لها بث مُتحقَّق منه أم لا. وعند وجود بث مُتحقَّق
   * منه تحديدًا يظهر زر إضافي مباشر إليه أعلى الكتلة.
   */
  const destination = resolveWatchDestinationForView(view);

  return (
    <div className="kl-live-page">
      <nav className="kl-breadcrumb" aria-label="مسار التنقل">
        <Link href="/">الرئيسية</Link>
        <span aria-hidden="true">/</span>
        <Link href={view.canonicalPath}>{matchLabel}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">المشاهدة المباشرة</span>
      </nav>

      <header className="kl-live-header">
        <div className="kl-live-head-top">
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

        <h1 className="kl-live-title">
          مشاهدة {matchLabel} — {entry.competition.nameAr}
        </h1>
        <p className="kl-live-meta">
          {view.cairoDateLabelAr} — {view.kickoffTimeAr} بتوقيت القاهرة
          {view.venueName ? ` — ${view.venueName}` : ''}
        </p>

        <div className="kl-live-teams">
          <div className="kl-live-team">
            <TeamCrest
              nameAr={entry.homeTeam.nameAr}
              logoUrl={entry.homeTeam.logoUrl ?? null}
              isEgyptian={entry.homeTeam.countryCode === 'EG'}
              size={56}
            />
            <span>{entry.homeTeam.nameAr}</span>
          </div>
          <span className="kl-live-score">{score ?? 'VS'}</span>
          <div className="kl-live-team">
            <TeamCrest
              nameAr={entry.awayTeam.nameAr}
              logoUrl={entry.awayTeam.logoUrl ?? null}
              isEgyptian={entry.awayTeam.countryCode === 'EG'}
              size={56}
            />
            <span>{entry.awayTeam.nameAr}</span>
          </div>
        </div>
      </header>

      {shouldRenderAdSlot(process.env.NEXT_PUBLIC_ADSENSE_SLOT_LIVE_TOP) ? (
        <AdSlot
          format="leaderboard"
          slotId={process.env.NEXT_PUBLIC_ADSENSE_SLOT_LIVE_TOP}
          label="مساحة إعلانية أعلى صفحة البث"
        />
      ) : null}

      <section className="kl-live-player" aria-label="مشغل البث">
        {/*
          كتلة المشاهدة الموحّدة: مساحة إعلانية فوق الزر ← الزر الأحمر ← مساحة إعلانية
          تحته. وهي تظهر في هذه الصفحة لكل مباراة، ولها بث مُتحقَّق منه أو لم يكن.
        */}
        <WatchStreamBlock destination={destination} />

        {view.verifiedBroadcastUrl ? (
          <>
            <a
              href={view.verifiedBroadcastUrl}
              className="kl-cta-btn kl-cta-btn-live kl-cta-btn-external"
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label={`فتح البث المباشر لمباراة ${matchLabel} عند ${entry.broadcast.providerNameAr || 'المزوّد'}`}
            >
              <span className="kl-cta-icon" aria-hidden="true">
                ▶
              </span>
              <span className="kl-cta-text">{entry.broadcast.labelAr}</span>
            </a>
            <p className="kl-cta-note">
              مزوّد البث: {entry.broadcast.providerNameAr || 'مزوّد خارجي'} —{' '}
              {entry.broadcast.isFree === false ? 'المشاهدة باشتراك' : 'المشاهدة مجانية'}.
              {entry.broadcast.notesAr ? ` ${entry.broadcast.notesAr}` : ''}
            </p>
          </>
        ) : (
          <div className="kl-live-unverified" role="status">
            <h2>شاهد المباراة مباشرة</h2>
            <p>
              اضغط الزر الأحمر بالأعلى لفتح صفحة المشاهدة على منصة NEMO Sports واختيار المباراة
              التي تريد متابعتها.
            </p>
            <ul>
              <li>
                موعد المباراة وملعبها والنتيجة في{' '}
                <Link href={view.canonicalPath}>صفحة تفاصيل المباراة</Link>.
              </li>
              <li>
                جدول اليوم كامل في{' '}
                <Link href={`/matches/${entry.cairoDate}`}>مباريات {entry.cairoDate}</Link>.
              </li>
              <li>تُحدَّث النتائج وحالات المباريات تلقائيًا من مصادر رياضية معتمدة.</li>
            </ul>
          </div>
        )}

        {entry.broadcast.embedUrl ? (
          <div className="kl-live-embed">
            <iframe
              src={entry.broadcast.embedUrl}
              title={`بث مباراة ${matchLabel}`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              referrerPolicy="no-referrer"
              loading="lazy"
              allowFullScreen
            />
          </div>
        ) : null}

        {!view.verifiedBroadcastUrl && view.verifiedNemoMatchUrl ? (
          <p className="kl-live-nemo">
            صفحة هذه المباراة على منصة NEMO Sports:{' '}
            <a href={view.verifiedNemoMatchUrl} target="_blank" rel="noopener noreferrer">
              فتح صفحة المباراة
            </a>{' '}
            — التغطية والمشاهدة من المنصة مباشرة.
          </p>
        ) : null}
      </section>

      {shouldRenderAdSlot(process.env.NEXT_PUBLIC_ADSENSE_SLOT_LIVE_BODY) ? (
        <AdSlot
          format="in-article"
          slotId={process.env.NEXT_PUBLIC_ADSENSE_SLOT_LIVE_BODY}
          label="مساحة إعلانية داخل محتوى صفحة البث"
        />
      ) : null}

      <section className="kl-live-facts" aria-label="بيانات المباراة">
        <h2 className="kl-section-subtitle">بيانات المباراة</h2>
        <dl className="kl-details-grid">
          <div>
            <dt>الفريقان</dt>
            <dd>
              {entry.homeTeam.nameAr} (المستضيف) × {entry.awayTeam.nameAr} (الضيف)
            </dd>
          </div>
          <div>
            <dt>البطولة</dt>
            <dd>{entry.competition.nameAr}</dd>
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
            <dt>الحالة</dt>
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

      <section className="kl-live-notes" aria-label="ملاحظات مهمة">
        <h2 className="kl-section-subtitle">قبل أن تبدأ المشاهدة</h2>
        <ul>
          <li>الموقع يعرض تغطية ومعلومات، وحقوق البث تخص الجهة المرخّصة فقط.</li>
          <li>لا نطلب بيانات دفع داخل هذا الموقع، ولا نستضيف ملفات بث غير مرخّصة.</li>
          <li>تُحدّث حالة المباراة من مصادر رياضية موثّقة، ويُذكر مصدر كل بيان أسفل البطاقة.</li>
        </ul>
        <p className="kl-live-back">
          <Link href={view.canonicalPath}>→ العودة إلى صفحة تفاصيل المباراة</Link>
        </p>
      </section>
    </div>
  );
}
