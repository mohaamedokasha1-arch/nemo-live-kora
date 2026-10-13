import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';
import { buildStaticPageMetadata } from '@/lib/seo/metadata';

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || '';

export const metadata: Metadata = buildStaticPageMetadata({
  title: 'اتصل بنا',
  description:
    'طرق التواصل مع فريق نيمو كورة لايف: تصحيح بيانات المباريات، الإبلاغ عن رابط لا يعمل، الاستفسارات الإعلانية وحقوق المحتوى.',
  path: '/contact',
});

export default function ContactPage() {
  return (
    <LegalPage
      title="اتصل بنا"
      updatedAt="13 أكتوبر 2026"
      intro="يسعدنا سماعك. نراجع كل رسالة، ونتعامل بجدية مع أي تصحيح لبيانات مباراة أو إبلاغ عن رابط لا يعمل."
    >
      <h2>البريد الإلكتروني</h2>
      {CONTACT_EMAIL ? (
        <p>
          راسلنا على <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> وسنرد عليك في أقرب وقت
          ممكن. لتسريع الرد، اذكر رابط الصفحة المعنية في رسالتك.
        </p>
      ) : (
        <p className="kl-contact-pending">
          أضف بريد التواصل بضبط متغيّر البيئة <code>NEXT_PUBLIC_CONTACT_EMAIL</code> على الخادم
          (Vercel → Settings → Environment Variables)، وسيظهر هنا تلقائيًا كرابط مباشر. هذا يحمي
          البريد من الرسائل المزعجة ويجعله قابلًا للتغيير بدون تعديل الكود.
        </p>
      )}

      <h2>ما الذي يمكنك مراسلتنا بشأنه؟</h2>
      <ul>
        <li>
          <strong>تصحيح بيانات:</strong> نتيجة أو موعد أو ملعب غير صحيح — أرفق رابط صفحة المباراة.
        </li>
        <li>
          <strong>روابط البث:</strong> الإبلاغ عن رابط لا يفتح، أو اقتراح رابط رسمي تملكه الجهة
          المرخّصة.
        </li>
        <li>
          <strong>حقوق المحتوى:</strong> طلب تصحيح أو إزالة شعار/صورة/نص — نستجيب للطلبات الموثّقة.
        </li>
        <li>
          <strong>الإعلانات:</strong> استفسارات الإعلان والتواصل التجاري مع البوابة.
        </li>
        <li>
          <strong>الأمان والخصوصية:</strong> أي ملاحظة تخص الكوكيز أو البيانات، راجع{' '}
          <Link href="/privacy-policy">سياسة الخصوصية</Link> أولًا.
        </li>
      </ul>

      <h2>قبل أن تراسلنا</h2>
      <p>
        الموقع لا يستضيف بثًا مباشرًا ولا يبيع تذاكر؛ لذلك لا يمكننا حل مشكلات التشغيل داخل منصات
        خارجية. لكننا نُحدّث حالة الرابط على صفحاتنا فور تأكّدنا من تغيّره، ونُبلّغ بالمشكلة للمصدر
        المعني عند الحاجة.
      </p>
      <p>
        لمتابعة حالة المصادر وتفاصيل آخر مزامنة، زُر <Link href="/sources">صفحة المصادر</Link>.
      </p>
    </LegalPage>
  );
}
