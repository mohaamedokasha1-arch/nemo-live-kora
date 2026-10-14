'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton, Field, ResultNote, adminApi, useAdminAction } from './ui';

export interface SettingsValues {
  matchesFreshnessMinutes: string;
  newsFreshnessMinutes: string;
  staleSourceWarningHours: string;
  ogImagePath: string;
  siteDescriptionAr: string;
  sitemapIncludeNews: boolean;
  bannerEnabled: boolean;
  bannerTextAr: string;
  bannerTone: 'info' | 'warning';
  contactEmail: string;
}

/**
 * الإعدادات العامة + SEO.
 *
 * أي تغيير يمسّ الفهرسة (وصف الموقع، صورة المشاركة، إدراج الأخبار في خريطة الموقع، شريط
 * التنبيه العام) يُطلب تأكيده أولًا: يُحسب الأثر على الخادم ويُعاد إلى هذه الصفحة قبل أي
 * كتابة، فلا يوجد تغيير صامت يؤثّر على ظهور الموقع في نتائج البحث.
 */
export default function SettingsForm({
  values,
  effectsAr,
  canWrite,
  disabledReasonAr,
  contactEmailFromEnv,
}: {
  values: SettingsValues;
  effectsAr: Record<string, string>;
  canWrite: boolean;
  disabledReasonAr?: string;
  contactEmailFromEnv: string | null;
}) {
  const router = useRouter();
  const { busy, result, run } = useAdminAction();
  const [form, setForm] = useState<SettingsValues>(values);
  const [pending, setPending] = useState<string[] | null>(null);
  const set = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const payload = (extra: Record<string, unknown> = {}) => ({
    matchesFreshnessMinutes: Number(form.matchesFreshnessMinutes || 0),
    newsFreshnessMinutes: Number(form.newsFreshnessMinutes || 0),
    staleSourceWarningHours: Number(form.staleSourceWarningHours || 0),
    ogImagePath: form.ogImagePath,
    siteDescriptionAr: form.siteDescriptionAr,
    sitemapIncludeNews: form.sitemapIncludeNews,
    banner: { enabled: form.bannerEnabled, textAr: form.bannerTextAr, tone: form.bannerTone },
    contactEmail: form.contactEmail || null,
    ...extra,
  });

  const save = (confirmSeo: boolean) =>
    run('save', async () => {
      const response = await adminApi<{ seoImpactAr?: string[] }>('/api/admin/settings', {
        method: 'PUT',
        json: payload({ confirmSeo }),
      });
      if (response.ok) {
        setPending(null);
        router.refresh();
        return { ok: true, messageAr: response.messageAr, seoImpactAr: response.seoImpactAr };
      }
      if (response.status === 409 && response.seoImpactAr?.length) {
        setPending(response.seoImpactAr);
        return {
          ok: false,
          messageAr: `${response.messageAr} — راجع الأثر أدناه ثم اضغط «تأكيد الحفظ مع الأثر».`,
          seoImpactAr: response.seoImpactAr,
        };
      }
      return { ok: false, messageAr: response.messageAr };
    });

  return (
    <div className="kl-admin-card">
      <h2>الإعدادات العامة</h2>

      <div className="kl-admin-form">
        <Field label="نافذة تحديث المباريات (دقائق)" hint={effectsAr.matchesFreshnessMinutes}>
          <input
            value={form.matchesFreshnessMinutes}
            onChange={(event) => set('matchesFreshnessMinutes', event.target.value)}
            inputMode="numeric"
          />
        </Field>
        <Field label="نافذة تحديث الأخبار (دقائق)" hint={effectsAr.newsFreshnessMinutes}>
          <input
            value={form.newsFreshnessMinutes}
            onChange={(event) => set('newsFreshnessMinutes', event.target.value)}
            inputMode="numeric"
          />
        </Field>
        <Field label="تنبيه تقادم المصدر (ساعات)" hint={effectsAr.staleSourceWarningHours}>
          <input
            value={form.staleSourceWarningHours}
            onChange={(event) => set('staleSourceWarningHours', event.target.value)}
            inputMode="numeric"
          />
        </Field>
        <Field label="بريد التواصل" hint={effectsAr.contactEmail}>
          <input
            value={form.contactEmail}
            onChange={(event) => set('contactEmail', event.target.value)}
            dir="ltr"
            placeholder={contactEmailFromEnv || 'support@example.com'}
          />
        </Field>
      </div>

      <h3>الشريط العام أعلى الموقع</h3>
      <p className="kl-admin-note">
        مفيد عند تعذّر التحديث التلقائي: يظهر تنبيه للزوار بدل أن تظهر بيانات قديمة بلا تفسير. اتركه مغلقًا في
        الأحوال العادية.
      </p>
      <div className="kl-admin-form">
        <Field label="تشغيل الشريط">
          <select value={form.bannerEnabled ? '1' : '0'} onChange={(event) => set('bannerEnabled', event.target.value === '1')}>
            <option value="0">مغلق</option>
            <option value="1">مُفعَّل</option>
          </select>
        </Field>
        <Field label="درجة التنبيه">
          <select
            value={form.bannerTone}
            onChange={(event) => set('bannerTone', event.target.value as 'info' | 'warning')}
          >
            <option value="info">معلوماتي</option>
            <option value="warning">تحذيري</option>
          </select>
        </Field>
        <Field label="نص الشريط" span>
          <input value={form.bannerTextAr} onChange={(event) => set('bannerTextAr', event.target.value)} />
        </Field>
      </div>

      <h3>SEO والمشاركة</h3>
      <div className="kl-admin-form">
        <Field label="وصف الموقع في نتائج البحث" hint={effectsAr.siteDescriptionAr} span>
          <textarea value={form.siteDescriptionAr} onChange={(event) => set('siteDescriptionAr', event.target.value)} />
        </Field>
        <Field label="صورة المشاركة الافتراضية" hint={effectsAr.ogImagePath}>
          <input value={form.ogImagePath} onChange={(event) => set('ogImagePath', event.target.value)} dir="ltr" />
        </Field>
        <Field label="إدراج صفحات الأخبار في خريطة الموقع" hint={effectsAr.sitemapIncludeNews}>
          <select
            value={form.sitemapIncludeNews ? '1' : '0'}
            onChange={(event) => set('sitemapIncludeNews', event.target.value === '1')}
          >
            <option value="1">نعم (الوضع الحالي)</option>
            <option value="0">لا — تُستثنى صفحات الأخبار من الخريطة</option>
          </select>
        </Field>
      </div>

      <div className="kl-admin-actions" style={{ marginTop: 12 }}>
        <ActionButton
          busyKey="save"
          busy={busy}
          tone="primary"
          disabled={!canWrite}
          disabledReasonAr={disabledReasonAr}
          onClick={() => save(false)}
        >
          حفظ الإعدادات
        </ActionButton>
        {pending?.length ? (
          <ActionButton
            busyKey="save"
            busy={busy}
            tone="danger"
            disabled={!canWrite}
            disabledReasonAr={disabledReasonAr}
            onClick={() => save(true)}
          >
            تأكيد الحفظ مع الأثر على الفهرسة
          </ActionButton>
        ) : null}
      </div>

      {pending?.length ? (
        <div className="kl-admin-note kl-admin-note-warn">
          <strong>أثر على الفهرسة والمشاركة — راجعه قبل التأكيد:</strong>
          <ul className="kl-admin-list">
            {pending.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ResultNote result={result} />

      <p className="kl-admin-note">
        محفوظات لا نلمسها من هنا: مسارات الصفحات، وسوم canonical، ملف robots، وسم hreflang، والبيانات المنظمة
        للمباريات. هذه الصفحة تُعدّل نصوصًا وإعدادات عرض فقط، وأي تغيير عليها يُسجَّل في سجل العمليات مع اسمك.
      </p>
    </div>
  );
}
