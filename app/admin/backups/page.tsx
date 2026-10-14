import React from 'react';
import type { Metadata } from 'next';
import { backupRetention, listBackups } from '@/lib/admin/backups';
import { getManualStatus } from '@/lib/admin/manual-store';
import { roleHasPermission } from '@/lib/auth/admin-session';
import { adminMetadata, guardAdminPage } from '../_lib/guard';
import BackupsClient from '../_components/backups-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'النسخ الاحتياطية', ...adminMetadata };

/**
 * النسخ الاحتياطية: قائمة ما هو محفوظ فعلًا على التخزين الدائم.
 *
 * لو لم يوجد تخزين دائم (وهو حال Vercel بلا GITHUB_TOKEN/GITHUB_REPO، لأن قرص الدالة
 * مؤقت) نقول ذلك صراحة ونمنع الإنشاء، بدل إنشاء ملف في /tmp يوهمك بنسخة ثم يضيع.
 */
export default async function AdminBackupsPage() {
  const guard = await guardAdminPage('backups:read', 'النسخ الاحتياطية');
  if (!guard.allowed) return guard.denied;

  const storage = getManualStatus();
  const backups = await listBackups();
  const canWrite = roleHasPermission(guard.identity!.role, 'backups:write');
  const canRestore = roleHasPermission(guard.identity!.role, 'backups:restore');

  return (
    <BackupsClient
      backups={backups.map((backup) => ({
        id: backup.id,
        createdAt: backup.createdAt,
        createdBy: backup.createdBy,
        kind: backup.kind,
        labelAr: backup.labelAr,
        bytes: backup.bytes,
        checksumShort: backup.checksumShort,
        counts: backup.counts,
      }))}
      retention={backupRetention()}
      durableStorage={storage.durable && storage.writable}
      storageNoteAr={storage.noteAr}
      canWrite={canWrite}
      canRestore={canRestore}
      disabledReasonAr={
        !storage.durable
          ? 'لا يوجد تخزين دائم على هذه البيئة — النسخ الاحتياطية تحتاج GITHUB_TOKEN + GITHUB_REPO أو قرصًا دائمًا.'
          : 'دورك الحالي لا يملك صلاحية إنشاء النسخ.'
      }
    />
  );
}
