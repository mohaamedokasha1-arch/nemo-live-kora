import React from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ADMIN_COOKIE } from '@/lib/auth/cron-auth';
import {
  ROLE_LABEL_AR,
  isAdminLoginAvailable,
  readAdminSession,
  roleHasPermission,
  type AdminIdentity,
  type AdminPermission,
} from '@/lib/auth/admin-session';

/**
 * حماية صفحات الإدارة على الخادم.
 *
 * ⚠️ مبدأ غير قابل للتفاوض: إخفاء الزر ليس حماية. لذلك كل صفحة إدارية تُفحص هنا على
 * الخادم قبل إرسال أي HTML إلى المتصفح، والفشل يعني رسالة عربية واضحة بلا أي بيانات.
 * وكذلك كل مسار API إداري يفحص بنفسه (`requireAdminPermission`) ولا يعتمد على هذه
 * الدالة إطلاقًا.
 */

export const adminMetadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export async function getAdminPageIdentity(): Promise<AdminIdentity | null> {
  const store = await cookies();
  return readAdminSession(store.get(ADMIN_COOKIE)?.value);
}

export interface AdminPageGuard {
  identity: AdminIdentity | null;
  allowed: boolean;
  loginAvailable: boolean;
  /** العنصر الذي تُرجعه الصفحة عندما لا يُسمح بالمرور. */
  denied: React.ReactElement | null;
}

export function AdminDenied({ title, messageAr }: { title: string; messageAr: string }) {
  return (
    <section className="kl-admin-card">
      <h1>{title}</h1>
      <p className="kl-admin-note kl-admin-note-warn">{messageAr}</p>
    </section>
  );
}

/** فحص جاهز للاستخدام داخل أي صفحة إدارية: هوية + صلاحية، مع عنصر رفض جاهز. */
export async function guardAdminPage(permission: AdminPermission, titleAr: string): Promise<AdminPageGuard> {
  const identity = await getAdminPageIdentity();
  const loginAvailable = isAdminLoginAvailable();
  if (!identity) {
    return {
      identity: null,
      allowed: false,
      loginAvailable,
      denied: (
        <AdminDenied
          title={titleAr}
          messageAr="هذه الصفحة محمية وتحتاج تسجيل دخول. سجّل الدخول من أعلى الصفحة ثم أعد المحاولة."
        />
      ),
    };
  }
  if (!roleHasPermission(identity.role, permission)) {
    return {
      identity,
      allowed: false,
      loginAvailable,
      denied: (
        <AdminDenied
          title={titleAr}
          messageAr={`دورك الحالي (${ROLE_LABEL_AR[identity.role]}) لا يملك صلاحية «${permission}» لهذه الصفحة.`}
        />
      ),
    };
  }
  return { identity, allowed: true, loginAvailable, denied: null };
}
