import React from 'react';
import type { Metadata } from 'next';
import { getManualStatus, getSiteSettings } from '@/lib/admin/manual-store';
import { roleHasPermission } from '@/lib/auth/admin-session';
import { describeSettingEffects } from '@/lib/admin/setting-effects';
import SettingsForm from '../_components/settings-form';
import { adminMetadata, guardAdminPage } from '../_lib/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'الإعدادات وSEO', ...adminMetadata };

/** إعدادات الموقع: ما تُغيّره هنا وأثره الفعلي على كل صفحة — مع تحذير قبل أي أثر على الفهرسة. */
export default async function AdminSettingsPage() {
  const guard = await guardAdminPage('settings:write', 'الإعدادات وSEO');
  if (!guard.allowed) return guard.denied;

  const settings = getSiteSettings();
  const storage = getManualStatus();
  const canWrite = roleHasPermission(guard.identity!.role, 'settings:write');
  const effectsAr = describeSettingEffects();

  return (
    <>
      <SettingsForm
        values={{
          matchesFreshnessMinutes: String(settings.matchesFreshnessMinutes),
          newsFreshnessMinutes: String(settings.newsFreshnessMinutes),
          staleSourceWarningHours: String(settings.staleSourceWarningHours),
          ogImagePath: settings.ogImagePath,
          siteDescriptionAr: settings.siteDescriptionAr,
          sitemapIncludeNews: settings.sitemapIncludeNews,
          bannerEnabled: settings.banner.enabled,
          bannerTextAr: settings.banner.textAr,
          bannerTone: settings.banner.tone,
          contactEmail: settings.contactEmail || '',
        }}
        effectsAr={effectsAr}
        canWrite={canWrite && storage.writable && storage.durable}
        disabledReasonAr={
          storage.writable
            ? 'دورك الحالي (محجوز للقراءة) لا يملك صلاحية تعديل الإعدادات.'
            : 'التخزين غير قابل للكتابة على هذه البيئة — لن تُحفظ الإعدادات.'
        }
        contactEmailFromEnv={process.env.NEXT_PUBLIC_CONTACT_EMAIL || null}
      />

      <section className="kl-admin-card">
        <h2>ما يقرأ هذه الإعدادات فعلًا</h2>
        <ul className="kl-admin-list">
          <li>
            نافذة تحديث المباريات: <span className="kl-admin-mono">lib/sync/engine.ts#ensureFreshMatches</span> —
            تحدد متى يُعاد الجلب عند طلب الزائر.
          </li>
          <li>
            نافذة تحديث الأخبار: <span className="kl-admin-mono">lib/sync/engine.ts#ensureFreshNews</span>.
          </li>
          <li>
            تنبيه التقادم: يُحسب في لوحة النظرة العامة وفي صفحة المصادر، ويظهر للمشغّل فقط.
          </li>
          <li>
            الوصف وصورة المشاركة: <span className="kl-admin-mono">app/layout.tsx#generateMetadata</span>.
          </li>
          <li>
            خريطة الموقع: <span className="kl-admin-mono">app/sitemap.ts</span> — إدراج الأخبار فقط، ومسارات
            المباريات لا تتغيّر.
          </li>
          <li>
            الشريط العام: <span className="kl-admin-mono">components/SiteBanner.tsx</span> أعلى كل صفحة.
          </li>
        </ul>
      </section>
    </>
  );
}
