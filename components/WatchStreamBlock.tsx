import React from 'react';
import AdSlot from './AdSlot';
import { shouldRenderAdSlot } from '@/lib/ads/config';
import WatchStreamCta from './WatchStreamCta';
import type { WatchDestination } from '@/lib/nemo-watch';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  كتلة المشاهدة الموحّدة: مساحة إعلانية ← زر البث ← مساحة إعلانية
 * ═══════════════════════════════════════════════════════════════════════════════
 *  هذه الكتلة هي **الموضع القياسي** لزر المشاهدة في كل صفحة مباراة على البوابة،
 *  وتضمن تلقائيًا:
 *    • مساحة إعلانية **فوق** الزر (leaderboard بعرض كامل).
 *    • زر المشاهدة الأحمر البارز.
 *    • مساحة إعلانية **تحت** الزر (in-article).
 *
 *  لماذا إعلانان حول الزر تحديدًا؟
 *  الزر هو أعلى نقطة تركيز في الصفحة (المستخدم ينظر إليه مباشرة وينقر)، فوضع مساحة
 *  إعلانية مباشرة قبله ومباشرة بعده يعطي أعلى معدل ظهور (Viewability) وأعلى عائد
 *  لكل ألف ظهور، وهو الشكل المعتاد في صفحات البث الرياضي.
 *
 *  المساحتان محجوزتان بارتفاع ثابت من `AdSlot` فلا تحدث إزاحة تخطيط (CLS) عند تحميل
 *  الإعلان — وهذا شرط قبول أساسي في برامج الناشرين وحراسة صريحة في اختبارات المشروع.
 *
 *  أرقام الوحدات الإعلانية تُقرأ من البيئة، فيمكن استخدام أرقام مختلفة للموضعين:
 *    NEXT_PUBLIC_ADSENSE_SLOT_ABOVE_WATCH
 *    NEXT_PUBLIC_ADSENSE_SLOT_BELOW_WATCH
 *  وقبل ضبطها لا يُرسم أي صندوق فارغ (AdSlot يعيد null)، فلا يرى الزائر أثرًا
 *  لمرحلة الإعداد ولا تتشوّه الصفحة — وعند التفعيل تظهر المساحتان محجوزتي الارتفاع
 *  في الموضعين نفسهما بالكود نفسه تمامًا. (وهذا مشروط بفحصين آليين في
 *  tests/watch-routing.test.ts: وجود AdSlot قبل الزر وآخر بعده، وغياب أي صندوق
 *  فارغ من الصفحة قبل التفعيل.)
 */
export default function WatchStreamBlock({ destination }: { destination: WatchDestination }) {
  // يُحسب على الخادم: عند عدم ضبط الإعلانات لا يُرسل المكوّن للمتصفح إطلاقًا.
  const aboveSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_ABOVE_WATCH;
  const belowSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_BELOW_WATCH;

  return (
    <div className="kl-watch-block">
      {shouldRenderAdSlot(aboveSlot) ? (
        <AdSlot
          format="leaderboard"
          slotId={aboveSlot}
          label="مساحة إعلانية أعلى زر البث المباشر"
        />
      ) : null}
      <WatchStreamCta destination={destination} />
      {shouldRenderAdSlot(belowSlot) ? (
        <AdSlot
          format="in-article"
          slotId={belowSlot}
          label="مساحة إعلانية أسفل زر البث المباشر"
        />
      ) : null}
    </div>
  );
}
