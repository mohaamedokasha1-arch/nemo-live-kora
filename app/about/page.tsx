import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';
import { resolveUpcomingMatchViews } from '@/lib/matches/match-catalog';
import { buildStaticPageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildStaticPageMetadata({
  title: 'من نحن',
  description:
    'نيمو كورة لايف بوابة رياضية عربية تعرض مواعيد المباريات ونتائجها بتوقيت القاهرة مع إسناد كل بيان إلى مصدره، وبلا استضافة أي بث غير مرخّص.',
  path: '/about',
});

export default function AboutPage() {
  const upcoming = resolveUpcomingMatchViews(4);

  return (
    <LegalPage
      title="من نحن"
      updatedAt="13 أكتوبر 2026"
      intro="نيمو كورة لايف بوابة رياضية عربية مستقلة، هدفها أن يصل الزائر إلى معلومة المباراة الصحيحة في أقل عدد نقرات، ثم إلى صفحة المشاهدة الرسمية بخطوة واحدة واضحة."
    >
      <h2>ماذا نقدّم؟</h2>
      <ul>
        <li>جدول مباريات يومي بتوقيت القاهرة (اليوم، الأمس، والغد) مع إمكانية اختيار أي تاريخ.</li>
        <li>صفحة تفصيلية لكل مباراة تحتوي الفريقين والبطولة والجولة والملعب والموعد والحالة.</li>
        <li>زر مشاهدة موحّد في كل صفحة مباراة ينقلك إلى منصة NEMO Sports لاختيار المباراة ومتابعتها.</li>
        <li>أخبار رياضية مُنتقاة من مصادرها مع بيان الجهة الناشرة.</li>
      </ul>

      <h2>من أين تأتي البيانات؟</h2>
      <p>
        نعتمد على مصادر رياضية متعدّدة (منها TheSportsDB وSportScore وAPI-Football وFootball-Data
        وأخبار Google News) ثم نوحّدها ونزيل التكرار بينها. تُحدَّث الجداول والنتائج والأخبار
        تلقائيًا على مدار اليوم، وكل بطاقة مباراة تُبيّن مصدرها الأساسي.
      </p>

      <h2>سياستنا التحريرية</h2>
      <ul>
        <li>لا نعرض بثًا غير مرخّص، ولا نستضيف ملفات بث على أجهزتنا.</li>
        <li>لا نُنشئ بيانات من الظن: تُعرض النتائج والحالات كما تصل من المصادر المعتمدة دون اختراع أي رقم.</li>
        <li>النتائج وحالات المباريات تُحدَّث آليًا مع كل مزامنة، بلا أي تعديل يدوي.</li>
        <li>نرحّب بأي تصحيح لبيان خاطئ عبر صفحة التواصل، ويُنشر التصحيح بعد مراجعته.</li>
      </ul>

      {upcoming.length > 0 ? (
        <>
          <h2>مباريات مرتبطة الآن</h2>
          <ul className="kl-about-links">
            {upcoming.map((view) => (
              <li key={view.entry.id}>
                <Link href={view.canonicalPath}>
                  {view.entry.homeTeam.nameAr} ضد {view.entry.awayTeam.nameAr}
                </Link>{' '}
                — {view.entry.competition.nameAr} ({view.cairoDateLabelAr})
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h2>الإعلانات</h2>
      <p>
        يعتمد الموقع على الإعلانات لتغطية التكاليف، ونحرص على ألا تعطّل تجربة القراءة: مساحات ثابتة،
        بلا نوافذ منبثقة، وبلا محتوى مضلّل. يمكنك معرفة تفاصيل الكوكيز والإعلانات من{' '}
        <Link href="/privacy-policy">سياسة الخصوصية</Link>.
      </p>
    </LegalPage>
  );
}
