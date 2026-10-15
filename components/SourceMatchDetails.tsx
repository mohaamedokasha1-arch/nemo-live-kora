import React from 'react';
import TeamCrest from './TeamCrest';
import Link from 'next/link';
import type { MatchRecord } from '@/lib/types';
import { formatArabicFullDate, formatArabicTimestamp, toCairoTimeArabic } from '@/lib/cairo-time';
import { getActiveMatches, getGatewayDatabase, guardStaleLiveStatus, isGenericCountryAr } from '@/lib/db/store';
import { resolveTeamDisplayIdentity } from '@/lib/catalog';
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
  // المباريات المرتبطة تُبنى من السجلات المعروضة فقط: لا رابط إلى سجل أُثبت أنه تكرار.
  const related = sortMatchesByKickoffProximity(
    getActiveMatches(getGatewayDatabase()).filter(
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
  /**
   * أسماء الفريقين: العربي الموثّق إن وُجد، وإلا اسم المصدر (بلا اختراع ترجمة)، مع عزل
   * اتجاه النص حتى لا ينقلب الاسم اللاتيني داخل تخطيط RTL. والقيمة التقنية من المصدر
   * (`Team dj2ryoh2w90q1zp`) تُعرض كعبارة واضحة لا كاسم نادٍ.
   */
  const homeName = resolveTeamDisplayIdentity(match.homeTeam);
  const awayName = resolveTeamDisplayIdentity(match.awayTeam);
  /** بطولة/موسم/جولة: تُبنى من الأجزاء المتاحة فقط، فلا يظهر فاصل معلَّق بلا قيمة. */
  const competitionLine = [match.competitionNameAr, match.seasonLabel, match.roundLabelAr]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' — ');
  /**
   * الدولة: تُعرض فقط عندما تحمل معلومة فعلية («الولايات المتحدة»، «مصر»). القيم العامة
   * («دولي») لا تُعرض لأنها لا تخبر الزائر بشيء — ولا تُستبدل بقيمة مُخمَّنة.
   */
  const countryLabel = isGenericCountryAr(match.countryAr) ? null : (match.countryAr || '').trim();

  return <article className="kl-news-article">
    <nav><Link href="/">الرئيسية</Link> / <Link href={`/matches/${match.cairoDate}`}>جدول اليوم</Link></nav>
    <div style={{ display: 'flex', gap: 24 }}><TeamCrest nameAr={homeName.displayName} logoUrl={match.homeTeam.logoUrl} /><TeamCrest nameAr={awayName.displayName} logoUrl={match.awayTeam.logoUrl} /></div>
    <h1><span dir="auto">{homeName.displayName}</span> ضد <span dir="auto">{awayName.displayName}</span></h1>
    <p>{competitionLine}</p>
    <p>{formatArabicFullDate(match.cairoDate)} — {match.kickoffConfirmed ? `${toCairoTimeArabic(match.utcKickoff)} بتوقيت القاهرة` : 'وقت الانطلاق غير مؤكد'}</p>
    <p>{match.statusLabelAr}{match.score.home !== null && match.score.away !== null ? ` — ${match.score.home} : ${match.score.away}` : ''}</p>
    {match.statusNoteAr && <p>{match.statusNoteAr}</p>}
    {/*
      * الملعب: لا يُخترع ولا يُستنتج. إن لم يُرسله المصدر نُعلن ذلك صراحةً بدل إسكات السطر،
      * لأن غيابه من هذه المباراة معلومة صحيحة عن حدود بيانات المصدر.
    */}
    <p>{match.venue ? `الملعب: ${match.venue}` : 'الملعب: غير متاح من المصادر لهذه المباراة.'}</p>
    {countryLabel ? <p>الدولة: {countryLabel}</p> : null}

    {/* نظام التوجيه الموحّد: إعلان ← زر المشاهدة ← إعلان، في كل صفحة مباراة بلا استثناء */}
    <WatchStreamBlock destination={destination} />

    {match.incidents && match.incidents.length > 0 && <section><h2>أحداث المباراة</h2><ul>{match.incidents.map((event, i) => <li key={i}>{event.minute}′ — {event.player} — {event.type}{event.detail ? ` — ${event.detail}` : ''}</li>)}</ul></section>}
    <p>آخر تحديث للبيانات: {formatArabicTimestamp(match.lastUpdatedAt)}</p>
    {/* SportScore يشترط رابطًا مرئيًا إليه في كل صفحة تعرض بياناته (شروط الاستخدام المجاني). */}
    <p>مصادر البيانات: {match.contributingSources.map((source, index) => (
      <React.Fragment key={source}>
        {index > 0 ? '، ' : null}
        {source === 'sportscore'
          ? <a href="https://sportscore.com/" rel="dofollow" title="Sports data by SportScore">SportScore</a>
          : source}
      </React.Fragment>
    ))}</p>
    <p>لا تتوفر في هذا السجل بيانات موثقة إضافية عن التشكيلات أو الحكم أو القنوات.</p>

    {shouldRenderAdSlot(process.env.NEXT_PUBLIC_ADSENSE_SLOT_MATCH_BODY) ? (
          <AdSlot format="in-article" label="مساحة إعلانية داخل صفحة المباراة" slotId={process.env.NEXT_PUBLIC_ADSENSE_SLOT_MATCH_BODY} />
        ) : null}

    {related.length > 0 && <section><h2>مباريات مرتبطة بالفريقين</h2><ul>{related.map((m) => {
      // نفس طبقة اسم العرض المستخدمة في الصفحة: لا اسم تقني في قائمة المباريات المرتبطة.
      const relatedHome = resolveTeamDisplayIdentity(m.homeTeam).displayName;
      const relatedAway = resolveTeamDisplayIdentity(m.awayTeam).displayName;
      return (
        <li key={m.id}>
          <Link href={`/matches/${findServedCatalogEntryForMatch(m)?.id || m.id}`}>
            {relatedHome} ضد {relatedAway} — {m.cairoDate}
          </Link>
        </li>
      );
    })}</ul></section>}
  </article>;
}
