import TeamCrest from './TeamCrest';
import Link from 'next/link';
import type { MatchRecord } from '@/lib/types';
import { formatArabicFullDate, formatArabicTimestamp, toCairoTimeArabic } from '@/lib/cairo-time';
import { getGatewayDatabase, guardStaleLiveStatus } from '@/lib/db/store';
import { findServedCatalogEntryForMatch } from '@/lib/admin/served-catalog';
import { resolveWatchDestinationForRecord } from '@/lib/nemo-watch';
import { sortMatchesByKickoffProximity } from '@/lib/matches/related-matches';
import AdSlot from './AdSlot';
import { shouldRenderAdSlot } from '@/lib/ads/config';
import WatchStreamBlock from './WatchStreamBlock';

/**
 * صفحة تفاصيل سجل مباراة من المخزن (خارج كتالوج `data/matches.ts`).
 *
 * تعرض هذه الصفحة بيانات المصدر فقط بلا أي معلومة مُخترعة (لا ملعب ولا بث ولا وقت
 * نهاية ولا تذكرة مُفترضة). ومع ذلك فهي **ليست استثناءً** من نظام التوجيه الموحّد:
 * تحمل نفس زر المشاهدة الأحمر الموحّد إلى منصة NEMO Sports في نافذة جديدة، وتحته
 * وفوقه مساحتان إعلانيتان — تمامًا كصفحات هبوط الكتالوج. الهدف: ألا توجد مباراة على
 * البوابة بلا مسار مشاهدة واضح، مهما كان مصدر سجلها.
 */
export default function SourceMatchDetails({ record }: { record: MatchRecord }) {
  const match = guardStaleLiveStatus(record);
  const related = sortMatchesByKickoffProximity(
    getGatewayDatabase().matches.filter(
      (candidate) =>
        candidate.id !== match.id &&
        [candidate.homeTeam.id, candidate.awayTeam.id].some((teamId) =>
          [match.homeTeam.id, match.awayTeam.id].includes(teamId)
        )
    ),
    match.utcKickoff
  ).slice(0, 6);
  // وجهة المشاهدة الموحّدة: معرّف المباراة يختاره المحرّك المركزي من معرّفات المصادر
  // (sportscore ← api-football ← thesportsdb ← معرّف السجل)، وإن وُجد رابط NEMO مُتحقَّق
  // منه لصفحة هذه المباراة تحديدًا فهو الأسبق. لا كود خاص بأي مباراة بعينها هنا.
  const destination = resolveWatchDestinationForRecord(match);

  return <article className="kl-news-article">
    <nav><Link href="/">الرئيسية</Link> / <Link href={`/matches/${match.cairoDate}`}>جدول اليوم</Link></nav>
    <div style={{ display: 'flex', gap: 24 }}><TeamCrest nameAr={match.homeTeam.nameAr} logoUrl={match.homeTeam.logoUrl} /><TeamCrest nameAr={match.awayTeam.nameAr} logoUrl={match.awayTeam.logoUrl} /></div>
    <h1>{match.homeTeam.nameAr} ضد {match.awayTeam.nameAr}</h1>
    <p>{match.competitionNameAr} — {match.seasonLabel}{match.roundLabelAr ? ` — ${match.roundLabelAr}` : ''}</p>
    <p>{formatArabicFullDate(match.cairoDate)} — {match.kickoffConfirmed ? `${toCairoTimeArabic(match.utcKickoff)} بتوقيت القاهرة` : 'وقت الانطلاق غير مؤكد'}</p>
    <p>{match.statusLabelAr}{match.score.home !== null && match.score.away !== null ? ` — ${match.score.home} : ${match.score.away}` : ''}</p>
    {match.statusNoteAr && <p>{match.statusNoteAr}</p>}
    {match.venue && <p>الملعب: {match.venue}</p>}

    {/* نظام التوجيه الموحّد: إعلان ← زر المشاهدة ← إعلان، في كل صفحة مباراة بلا استثناء */}
    <WatchStreamBlock destination={destination} />

    {match.incidents && match.incidents.length > 0 && <section><h2>أحداث المباراة</h2><ul>{match.incidents.map((event, i) => <li key={i}>{event.minute}′ — {event.player} — {event.type}{event.detail ? ` — ${event.detail}` : ''}</li>)}</ul></section>}
    <p>آخر تحديث للبيانات: {formatArabicTimestamp(match.lastUpdatedAt)}</p>
    <p>مصادر البيانات: {match.contributingSources.join('، ')}</p>
    <p>لا تتوفر في هذا السجل بيانات موثقة إضافية عن التشكيلات أو الحكم أو القنوات.</p>

    {shouldRenderAdSlot(process.env.NEXT_PUBLIC_ADSENSE_SLOT_MATCH_BODY) ? (
          <AdSlot format="in-article" label="مساحة إعلانية داخل صفحة المباراة" slotId={process.env.NEXT_PUBLIC_ADSENSE_SLOT_MATCH_BODY} />
        ) : null}

    {related.length > 0 && <section><h2>مباريات مرتبطة بالفريقين</h2><ul>{related.map((m) => <li key={m.id}><Link href={`/matches/${findServedCatalogEntryForMatch(m)?.id || m.id}`}>{m.homeTeam.nameAr} ضد {m.awayTeam.nameAr} — {m.cairoDate}</Link></li>)}</ul></section>}
  </article>;
}
