import React from 'react';
import { toCairoIsoWithOffset } from '@/lib/cairo-time';
import type { ResolvedMatchView } from '@/lib/matches/types';
import { serializeJsonLd } from '@/lib/seo/json-ld';
import { buildMatchLandingJsonLd } from '@/lib/seo/sports-event';

/**
 * مكوّن JSON-LD مخصص لمباريات SportsEvent.
 *
 * يولّد — من سجل المباراة نفسه — كائنًا كامل الحقول:
 * location (Place/VirtualLocation) • description ديناميكي • performer (الفريقان)
 * organizer (البطولة) • startDate/endDate بصيغة ISO 8601 مع إزاحة القاهرة
 * offers (سعر 0 + InStock) • eventStatus (EventScheduled/EventPostponed/EventCancelled…)
 *
 * يُستخدم داخل صفحة الهبوط (Server Component) بدون أي جافاسكربت على العميل.
 */
export default function SportsEventJsonLd({
  view,
  scriptId,
}: {
  view: ResolvedMatchView;
  scriptId?: string;
}) {
  const startIso = toCairoIsoWithOffset(view.kickoffUtc);
  const endIso = toCairoIsoWithOffset(view.endDateUtc);

  // لا نُخرج بيانات منظمة بتواريخ غير صالحة: الأفضل عدم الإخراج من إخراج بيانات خاطئة.
  if (!startIso || !endIso) return null;

  const jsonLd = buildMatchLandingJsonLd(view, { startIso, endIso });

  return (
    <script
      id={scriptId ?? `sports-event-${view.entry.id}`}
      type="application/ld+json"
      // JSON-LD يُهَرَّب بواسطة serializeJsonLd لمنع كسر وسم السكربت.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
    />
  );
}
