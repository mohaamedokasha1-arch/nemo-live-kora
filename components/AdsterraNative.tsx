import React from 'react';
import Script from 'next/script';
import {
  ADSTERRA_NATIVE_CONTAINER_ID,
  ADSTERRA_NATIVE_SCRIPT_URL,
  isAdsterraFormatEnabled,
} from '@/lib/ads/adsterra';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Adsterra Native Banner — الإعلان المدمج الذي يظهر كأنه محتوى طبيعي
 * ═══════════════════════════════════════════════════════════════════════════════
 *  المواضع المُعتمدة: وسط قسم الأخبار، وبين كروت المباريات في جدول اليوم.
 *  الشكل يتبع تنسيق الموقع نفسه (بطاقة بيضاء بنفس الحدود والزوايا) فلا يبدو جسيمًا
 *  غريبًا في الصفحة، مع سطر صغير «إعلان» يحفظ ثقة الزائر ويفصل المحتوى التجاري عن
 *  محتوى الموقع.
 *
 *  طريقة التركيب: الحاوية بالمعرّف الذي يطلبه سكربت الشبكة (المعرّف مبني في
 *  `lib/ads/adsterra.ts` من المصدر نفسه) ثم السكربت `async` + `data-cfasync="false"`
 *  كما ورد في كود Adsterra بالحرف.
 *
 *  ⚠️ قاعدة واحدة يجب احترامها: **حاوية واحدة لكل صفحة**.
 *  المعرّف `container-…` معرّف HTML فريد، وسكربت الشبكة يبحث عنه في المستند ويعبّئه.
 *  لذلك لا يُركَّب هذا المكوّن في صفحة واحدة مرتين: الصفحة الرئيسية وصفحات التواريخ
 *  تُظهره بين كروت المباريات (وتمرّر صفحة الأخبار التفعيل لقسم الأخبار بدلًا من ذلك).
 *  ولهذا السبب أيضًا لم يُوضع داخل إطار معزول: الإعلان المدمج يجب أن يتمدّد بارتفاع
 *  محتواه الحقيقي ويتجاوب مع عرض العمود، والإطار يقصّ المحتوى عند ارتفاع ثابت.
 *
 *  التحميل `lazyOnload`: السكربت لا يُطلب إلا بعد خمول الصفحة، فلا ينافس المحتوى
 *  ولا يؤثر على سرعة التحميل، والارتفاع محجوز مسبقًا في CSS لمنع إزاحة التخطيط.
 */
export default function AdsterraNative({
  className,
  label = 'محتوى إعلاني مدفوع',
}: {
  /** أصناف إضافية للموضع (شبكة الأخبار، قائمة المباريات…). */
  className?: string;
  /** وصف القسم لقارئات الشاشة. */
  label?: string;
}) {
  if (!isAdsterraFormatEnabled('native')) return null;

  return (
    <aside
      className={['kl-ad-native', className].filter(Boolean).join(' ')}
      aria-label={label}
      data-ad-network="adsterra"
      data-ad-unit="native"
    >
      <span className="kl-ad-native-caption">إعلان</span>
      <div id={ADSTERRA_NATIVE_CONTAINER_ID} className="kl-ad-native-container" />
      <Script
        id="adsterra-native-banner"
        src={ADSTERRA_NATIVE_SCRIPT_URL}
        strategy="lazyOnload"
        async
        data-cfasync="false"
      />
    </aside>
  );
}
