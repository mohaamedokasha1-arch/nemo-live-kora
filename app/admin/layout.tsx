import React from 'react';
import type { Metadata } from 'next';
import { getManualStatus, getSiteSettings, loadManualDocument } from '@/lib/admin/manual-store';
import { ROLE_LABEL_AR, hasPasswordAdmin, isAdminLoginAvailable, roleHasPermission } from '@/lib/auth/admin-session';
import { hasConfiguredAdminSecret } from '@/lib/auth/cron-auth';
import AdminLoginForm from './_components/login-form';
import LogoutButton from './_components/logout-button';
import { adminMetadata, getAdminPageIdentity } from './_lib/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'لوحة الإدارة',
  ...adminMetadata,
};

const NAV: Array<{ href: string; labelAr: string; hintAr: string; permission: Parameters<typeof roleHasPermission>[1] }> = [
  { href: '/admin', labelAr: 'نظرة عامة', hintAr: 'حالة النظام الآن', permission: 'dashboard:read' },
  { href: '/admin/matches', labelAr: 'المباريات', hintAr: 'تعديل وإدخال يدوي', permission: 'matches:read' },
  { href: '/admin/sources', labelAr: 'المصادر', hintAr: 'الحالة وإعادة المحاولة', permission: 'sources:read' },
  { href: '/admin/sync', labelAr: 'التحديث و«أوقات الكرون»', hintAr: 'تشغيل يدوي ومراقبة', permission: 'sync:run' },
  { href: '/admin/news/manage', labelAr: 'الأخبار', hintAr: 'إضافة وتعديل ونشر', permission: 'news:read' },
  { href: '/admin/catalog', labelAr: 'البطولات والفرق', hintAr: 'ترتيب وموسم وفرق', permission: 'catalog:read' },
  { href: '/admin/settings', labelAr: 'الإعدادات وSEO', hintAr: 'مع تحذير الأثر', permission: 'settings:read' },
  { href: '/admin/logs', labelAr: 'السجلات', hintAr: 'عمليات الإدارة والأخطاء', permission: 'logs:read' },
  { href: '/admin/backups', labelAr: 'النسخ الاحتياطية', hintAr: 'إنشاء وفحص واستعادة', permission: 'backups:read' },
  { href: '/admin/news', labelAr: 'مراقبة الأخبار', hintAr: 'جودة المصادر المنشورة', permission: 'news:read' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await loadManualDocument();
  const identity = await getAdminPageIdentity();
  const storage = getManualStatus();
  const settings = getSiteSettings();

  if (!identity) {
    const requiredEnv: string[] = [];
    if (!isAdminLoginAvailable()) {
      requiredEnv.push('NEMO_ADMIN_USER', 'NEMO_ADMIN_PASSWORD_HASH');
    }
    return (
      <div className="kl-container">
        <main className="kl-admin-main" style={{ paddingBlock: '10px 40px' }}>
          {!isAdminLoginAvailable() ? (
            <div className="kl-admin-banner kl-admin-banner-danger" role="alert">
              <div>
                <strong>لوحة الإدارة غير مهيّأة على هذه البيئة.</strong> اضبط اسم المستخدم وhash كلمة المرور
                (أو الرمز المشترك) في متغيّرات البيئة ثم أعد النشر — لا يوجد أي حساب افتراضي في الكود.
              </div>
              <div className="kl-admin-mono">{requiredEnv.join(' , ')}</div>
            </div>
          ) : null}
          <AdminLoginForm
            passwordLoginConfigured={hasPasswordAdmin()}
            sharedSecretConfigured={hasConfiguredAdminSecret()}
            storageNoteAr={
              storage.durable
                ? `التخزين الحالي: ${storage.labelAr}. كل تعديل يُحفظ في المستودع الخاص بالموقع.`
                : 'تنبيه: تعديلات الإدارة لن تكون دائمة على هذه البيئة حتى يُضبط تخزين دائم (GITHUB_TOKEN + GITHUB_REPO).'
            }
          />
        </main>
      </div>
    );
  }

  const visibleNav = NAV.filter((item) => roleHasPermission(identity.role, item.permission));

  return (
    <div className="kl-container">
      <div className="kl-admin-shell">
        <nav className="kl-admin-nav" aria-label="أقسام لوحة الإدارة">
          <p className="kl-admin-nav-title">لوحة إدارة NEMO Sports</p>
          {visibleNav.map((item) => (
            <a key={item.href} href={item.href} title={item.hintAr}>
              <span>{item.labelAr}</span>
            </a>
          ))}
        </nav>

        <main className="kl-admin-main">
          <div className="kl-admin-head">
            <h1>لوحة الإدارة</h1>
            <div className="kl-admin-identity">
              <span>
                {identity.displayNameAr} · {ROLE_LABEL_AR[identity.role]} · الجلسة تنتهي{' '}
                {new Intl.DateTimeFormat('ar-EG', { timeStyle: 'short', dateStyle: 'short', timeZone: 'Africa/Cairo' }).format(
                  new Date(identity.expiresAt)
                )}
              </span>
              <LogoutButton />
              <a className="kl-admin-btn" href="/" target="_blank" rel="noreferrer">
                عرض الموقع
              </a>
            </div>
          </div>

          {!storage.durable || !storage.writable ? (
            <div className="kl-admin-banner kl-admin-banner-danger" role="alert">
              <div>
                <strong>تعديلات الإدارة غير مضمونة على هذه البيئة.</strong> {storage.labelAr}:{' '}
                {storage.durable ? 'قابل للكتابة لكن غير دائم' : 'غير دائم'} — الموقع العام يعمل بآخر لقطة
                محفوظة، وأزرار الحفظ ترفض العمل حتى يُضبط تخزين دائم.
              </div>
              {storage.requiredEnv.length > 0 ? (
                <div className="kl-admin-mono">المتغيّرات المطلوبة: {storage.requiredEnv.join(' , ')}</div>
              ) : null}
            </div>
          ) : (
            <div className="kl-admin-note kl-admin-note-ok">
              تخزين التعديلات: {storage.labelAr} — دائم. أي تعديل تحفظه هنا يُكتب فعليًا ويظهر على الموقع
              العام بعد إعادة التحقق.
            </div>
          )}

          {settings.banner.enabled && settings.banner.textAr ? (
            <div className="kl-admin-note">
              شريط التنبيه العام مُفعَّل حاليًا: «{settings.banner.textAr}» — يظهر أعلى الموقع لكل الزوار.
            </div>
          ) : null}

          {children}
        </main>
      </div>
    </div>
  );
}
