import React from 'react';
import Link from 'next/link';
import type { MatchIdHint } from '@/lib/matches/match-id-hints';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  حالة عدم توفّر بيانات المباراة — Fallback UI أنيق (بلا 404 جامد)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * تظهر هذه الصفحة عندما يحمل المعرّف هوية مباراة حقيقية من مزوّد (SportScore /
 * TheSportsDB / API-Football) لكن بياناته غير متاحة الآن: السجل خارج نافذة المزامنة،
 * أو المزوّد لا يستجيب، أو أُزيلت المباراة من المصدر.
 *
 * القواعد المقصودة:
 *   • لا نُخترع أي معلومة عن المباراة (لا فرق ولا موعد ولا نتيجة) — نُعلن الحدود بصراحة.
 *   • نبقي الزائر داخل الموقع: روابط واضحة لجدول اليوم وجدول المباريات والأخبار.
 *   • لا نعد بموعد وصول البيانات (لا نملك هذه المعلومة) — فقط نشرح ما حدث بلغة واثقة.
 *   • هذه الصفحة `noindex` (تُضبط من الصفحة نفسها) فلا تُصنَّف كـ soft-404 في نتائج البحث.
 */
export default function MatchUnavailableView({ hint }: { hint: MatchIdHint }) {
  return (
    <div className="kl-empty-box">
      <h1 className="kl-empty-title">تفاصيل المباراة غير متاحة الآن</h1>
      <p>
        حمل رابط هذه المباراة هوية سجل رياضي حقيقي، لكن بياناتها لم تُسترجع من المصادر
        (SportScore / TheSportsDB) أثناء فتح الصفحة. قد تكون المباراة خارج نافذة التحديث
        الحالية، أو أُزيلت من المصدر، أو تعذّر الاتصال بالمزوّد لحظة طلبك.
      </p>
      <p>يمكنك العودة إلى جدول المباريات حيث تُعرض المباريات المتاحة بنتائجها ومواعيدها المحدّثة.</p>
      <div className="kl-empty-links">
        <Link href="/" className="kl-day-btn kl-day-btn-active">
          جدول مباريات اليوم
        </Link>
        <Link href="/matches" className="kl-day-btn">
          جدول المباريات
        </Link>
        <Link href="/news" className="kl-day-btn">
          الأخبار
        </Link>
      </div>
      <p>
        <small>
          معرّف المباراة المطلوب: <code dir="ltr">{hint.raw}</code>
          {hint.provider !== 'unknown' && hint.provider !== 'synthetic' ? (
            <> (مصدر المعرّف: {hint.provider})</>
          ) : null}
        </small>
      </p>
    </div>
  );
}
