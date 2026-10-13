import React from 'react';
import Link from 'next/link';
import type { ResolvedMatchView } from '@/lib/matches/types';

/**
 * زر التحويل الأساسي (Landing Gateway CTA): ينقل الزائر مباشرة إلى صفحة البث
 * الداخلية /live/[match-id] — وهي بوابة المشاهدة الرسمية على الموقع.
 */
export default function StreamCta({
  view,
  variant = 'hero',
  block,
}: {
  view: ResolvedMatchView;
  variant?: 'hero' | 'inline';
  block?: boolean;
}) {
  const { entry } = view;
  const matchLabel = `${entry.homeTeam.nameAr} ضد ${entry.awayTeam.nameAr}`;

  const label = view.isFinished
    ? 'النتيجة والملخص — صفحة المشاهدة'
    : view.isLive
    ? 'المباراة جارية الآن — ادخل صفحة المشاهدة'
    : 'شاهد البث المباشر الآن';

  const note = view.verifiedBroadcastUrl
    ? `بث مُتحقَّق منه${entry.broadcast.isFree === false ? ' (باشتراك)' : ' ومجاني'} — ${entry.broadcast.labelAr}`
    : 'تفتح صفحة المشاهدة داخل الموقع، وتُعرض حالة البث الفعلية فقط عند التحقق منها.';

  return (
    <div className={`kl-cta kl-cta-${variant}${block ? ' kl-cta-block' : ''}`}>
      <Link
        href={view.livePath}
        className={`kl-cta-btn${view.isLive ? ' kl-cta-btn-live' : ''}`}
        aria-label={`${label} — ${matchLabel}`}
        title={`${label} — ${matchLabel}`}
      >
        <span className="kl-cta-icon" aria-hidden="true">
          {view.isLive ? <span className="kl-live-dot" /> : '▶'}
        </span>
        <span className="kl-cta-text">{label}</span>
        <span className="kl-cta-arrow" aria-hidden="true">
          ←
        </span>
      </Link>
      <p className="kl-cta-note">{note}</p>
    </div>
  );
}
