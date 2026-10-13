import TeamCrest from './TeamCrest';
import Link from 'next/link';
import type { MatchRecord } from '@/lib/types';
import { formatArabicFullDate, formatArabicTimestamp, toCairoTimeArabic } from '@/lib/cairo-time';
import { getGatewayDatabase, guardStaleLiveStatus } from '@/lib/db/store';
import { findCatalogEntryForMatch } from '@/lib/matches/match-links';

/** Data-only details: deliberately no inferred venue, broadcast, end time or ticket offer. */
export default function SourceMatchDetails({ record }: { record: MatchRecord }) {
  const match = guardStaleLiveStatus(record);
  const related = getGatewayDatabase().matches.filter((m) => m.id !== match.id &&
    [m.homeTeam.id, m.awayTeam.id].some((id) => [match.homeTeam.id, match.awayTeam.id].includes(id)))
    .sort((a, b) => Math.abs(Date.parse(a.utcKickoff) - Date.parse(match.utcKickoff)) - Math.abs(Date.parse(b.utcKickoff) - Date.parse(match.utcKickoff))).slice(0, 6);
  return <article className="kl-news-article">
    <nav><Link href="/">الرئيسية</Link> / <Link href={`/matches/${match.cairoDate}`}>جدول اليوم</Link></nav>
    <div style={{ display: 'flex', gap: 24 }}><TeamCrest nameAr={match.homeTeam.nameAr} logoUrl={match.homeTeam.logoUrl} /><TeamCrest nameAr={match.awayTeam.nameAr} logoUrl={match.awayTeam.logoUrl} /></div>
    <h1>{match.homeTeam.nameAr} ضد {match.awayTeam.nameAr}</h1>
    <p>{match.competitionNameAr} — {match.seasonLabel}{match.roundLabelAr ? ` — ${match.roundLabelAr}` : ''}</p>
    <p>{formatArabicFullDate(match.cairoDate)} — {match.kickoffConfirmed ? `${toCairoTimeArabic(match.utcKickoff)} بتوقيت القاهرة` : 'وقت الانطلاق غير مؤكد'}</p>
    <p>{match.statusLabelAr}{match.score.home !== null && match.score.away !== null ? ` — ${match.score.home} : ${match.score.away}` : ''}</p>
    {match.statusNoteAr && <p>{match.statusNoteAr}</p>}
    {match.venue && <p>الملعب: {match.venue}</p>}
    {match.incidents && match.incidents.length > 0 && <section><h2>أحداث المباراة</h2><ul>{match.incidents.map((event, i) => <li key={i}>{event.minute}′ — {event.player} — {event.type}{event.detail ? ` — ${event.detail}` : ''}</li>)}</ul></section>}
    <p>آخر تحديث للبيانات: {formatArabicTimestamp(match.lastUpdatedAt)}</p>
    <p>مصادر البيانات: {match.contributingSources.join('، ')}</p>
    <p>لا تتوفر في هذا السجل بيانات موثقة إضافية عن التشكيلات أو الحكم أو القنوات.</p>
    {related.length > 0 && <section><h2>مباريات مرتبطة بالفريقين</h2><ul>{related.map((m) => <li key={m.id}><Link href={`/matches/${findCatalogEntryForMatch(m)?.id || m.id}`}>{m.homeTeam.nameAr} ضد {m.awayTeam.nameAr} — {m.cairoDate}</Link></li>)}</ul></section>}
  </article>;
}
