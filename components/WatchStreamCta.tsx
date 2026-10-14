import React from 'react';
import type { WatchDestination } from '@/lib/nemo-watch';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  زر المشاهدة الرئيسي (Primary Watch CTA) — المكوّن الموحّد لكل المباريات
 * ═══════════════════════════════════════════════════════════════════════════════
 *  زر أحمر بارز بأيقونة بث، يفتح بوابة المشاهدة على منصة NEMO Sports في **نافذة
 *  جديدة** (`target="_blank"`).
 *
 *  لماذا مكوّن واحد لكل الصفحات؟
 *  لأن كل المباريات — الحالية والقادمة والمنتهية، ومن الكتالوج أو من سجلات المصادر —
 *  تستخدم هذا المكوّن نفسه، فيستحيل أن تختلف وجهة زر في صفحة عن أخرى أو أن تُنسى
 *  مباراة بلا زر. الوجهة تُحسب من `lib/nemo-watch.ts` ولا تُكتب يدويًا هنا أبدًا.
 *
 *  لون الزر أحمر لأن الأحمر هو المتعارف عليه عربيًا وعالميًا لزر «البث المباشر»،
 *  وهو أعلى تباينًا مع خلفية الصفحة الفاتحة والداكنة في الوقت نفسه.
 */

export default function WatchStreamCta({
  destination,
  /** نص بديل عند عدم توفّر وجهة (لا يحدث عمليًا لأن النظام يملك بديلًا دائمًا). */
  fallbackNote,
}: {
  destination: WatchDestination;
  fallbackNote?: string;
}) {
  return (
    <div className="kl-watch-cta">
      <a
        href={destination.url}
        target="_blank"
        rel="noopener noreferrer"
        className="kl-watch-btn"
        data-watch-kind={destination.kind}
        aria-label={destination.labelAr}
        title={destination.labelAr}
      >
        <span className="kl-watch-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M10 8.5l6 3.5-6 3.5v-7z" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <span className="kl-watch-text">{destination.labelAr}</span>
        <span className="kl-watch-open" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3h7v7" />
            <path d="M13 3 6.5 9.5" />
            <path d="M12 11.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1.5" />
          </svg>
        </span>
      </a>
      <p className="kl-watch-note">{destination.noteAr || fallbackNote}</p>
      {/*
        رابط ثانوي — لا يُزاحم الزر أبدًا.
        عندما تكون لدينا صفحة هذه المباراة تحديدًا مُتحقَّقًا منها على المنصة، لا تُهمَل:
        تُعرض هنا كخيار أدق لمن يريده، بينما يبقى الزر الأحمر الأساسي على البوابة الموحّدة
        `.../watch?id=<المعرّف>` لكل مباراة بلا استثناء (النظام الدائم المعتمد).
      */}
      {destination.exactMatchUrl && destination.kind !== 'verified_match_page' ? (
        <p className="kl-watch-exact">
          <a href={destination.exactMatchUrl} target="_blank" rel="noopener noreferrer">
            أو افتح صفحة هذه المباراة تحديدًا على NEMO Sports
          </a>
        </p>
      ) : null}
    </div>
  );
}
