'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton, Field, ResultNote, adminApi, formatDateAr, useAdminAction } from './ui';

export interface BackupRow {
  id: string;
  createdAt: string;
  createdBy: string;
  kind: string;
  labelAr: string;
  bytes: number;
  checksumShort: string;
  counts: {
    manualMatches: number;
    overrides: number;
    manualNews: number;
    teams: number;
    audit: number;
    storeMatches: number;
    storeNews: number;
    standings: number;
  };
}

/**
 * إدارة النسخ الاحتياطية:
 *  • إنشاء نسخة كاملة عند الطلب (مستند الإدارة + لقطة مخزن الموقع + ملخّص الإعدادات).
 *  • فحص السلامة بإعادة حساب البصمة (SHA-256) على محتوى النسخة نفسه — فحص حقيقي لا شعار.
 *  • استعادة بدور المالك فقط، بتأكيد مكتوب بمعرّف النسخة، مع نسخة وقائية إلزامية قبلها.
 *  • حذف وتقليم بقواعد أمان: لا تُحذف أحدث نسخة، والاحتفاظ قابل للضبط (NEMO_BACKUP_RETENTION).
 */
export default function BackupsClient({
  backups,
  retention,
  durableStorage,
  storageNoteAr,
  canWrite,
  canRestore,
  disabledReasonAr,
}: {
  backups: BackupRow[];
  retention: number;
  durableStorage: boolean;
  storageNoteAr: string;
  canWrite: boolean;
  canRestore: boolean;
  disabledReasonAr?: string;
}) {
  const router = useRouter();
  const { busy, result, run } = useAdminAction();
  const [labelAr, setLabelAr] = useState('');
  const [verification, setVerification] = useState<Record<string, string>>({});
  const [restoreId, setRestoreId] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const createBackup = () =>
    run('create', async () => {
      const response = await adminApi<{ summary?: { id: string } }>('/api/admin/backups', {
        method: 'POST',
        json: { labelAr: labelAr || undefined },
      });
      if (response.ok) {
        setLabelAr('');
        router.refresh();
      }
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  const verify = (id: string) =>
    run(`verify-${id}`, async () => {
      const response = await adminApi<{ verification?: { ok: boolean; messageAr: string; checksum?: string } }>(
        `/api/admin/backups/${encodeURIComponent(id)}`,
        { method: 'GET' }
      );
      const outcome = response.data?.verification;
      setVerification((current) => ({
        ...current,
        [id]: outcome ? `${outcome.ok ? 'سليمة' : 'تالفة'} — ${outcome.messageAr}` : 'تعذّر الفحص',
      }));
      return { ok: response.ok && Boolean(outcome?.ok), messageAr: response.messageAr || outcome?.messageAr };
    });

  const remove = (id: string) =>
    run(`delete-${id}`, async () => {
      const response = await adminApi(`/api/admin/backups/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (response.ok) router.refresh();
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  const restore = () =>
    run('restore', async () => {
      const response = await adminApi(`/api/admin/backups/${encodeURIComponent(restoreId)}/restore`, {
        method: 'POST',
        json: { confirmation },
      });
      if (response.ok) {
        setRestoreId('');
        setConfirmation('');
        router.refresh();
      }
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  return (
    <>
      <section className="kl-admin-card">
        <div className="kl-admin-head">
          <h2>إنشاء نسخة الآن</h2>
          <span className="kl-admin-identity">الاحتفاظ: {retention} نسخة</span>
        </div>
        <p className="kl-admin-note">
          النسخة الكاملة تشمل: مستند الإدارة (المباريات اليدوية وتثبيتاتها + الأخبار + الفرق + البطولات +
          الإعدادات + سجل العمليات) + لقطة مخزن الموقع (المباريات والأخبار والترتيب وحالة كل مزوّد بيانات) + ملخّص
          الإعدادات بلا أي مفتاح سري. وهذا ليس تصديرًا جزئيًا من الواجهة.
        </p>
        {!durableStorage ? (
          <p className="kl-admin-note kl-admin-note-danger">
            لا يوجد تخزين دائم لهذه النسخ على البيئة الحالية: {storageNoteAr} — لذلك يُرفض إنشاء النسخة بدل
            إيهامك بنسخة ستضيع. اضبط GITHUB_TOKEN وGITHUB_REPO (أو NEMO_DATA_DIR على قرص دائم) ثم أعد المحاولة.
          </p>
        ) : null}
        <div className="kl-admin-form">
          <Field label="وصف النسخة (اختياري)">
            <input value={labelAr} onChange={(event) => setLabelAr(event.target.value)} />
          </Field>
        </div>
        <div className="kl-admin-actions" style={{ marginTop: 10 }}>
          <ActionButton
            busyKey="create"
            busy={busy}
            tone="primary"
            disabled={!canWrite || !durableStorage}
            disabledReasonAr={disabledReasonAr}
            onClick={createBackup}
          >
            إنشاء نسخة كاملة
          </ActionButton>
        </div>
        <ResultNote result={result} />
      </section>

      <section className="kl-admin-card">
        <h2>النسخ المحفوظة ({backups.length})</h2>
        {backups.length === 0 ? (
          <p className="kl-admin-note">لا نسخ محفوظة بعد.</p>
        ) : (
          <div className="kl-admin-table-wrap">
            <table className="kl-admin-table">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>النوع</th>
                  <th>الوصف</th>
                  <th>من</th>
                  <th>الحجم</th>
                  <th>المحتوى</th>
                  <th>السلامة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.id}>
                    <td>
                      {formatDateAr(backup.createdAt)}
                      <div className="kl-admin-mono">{backup.id}</div>
                    </td>
                    <td>{backup.kind === 'manual' ? 'يدوية' : backup.kind === 'auto' ? 'مجدولة' : 'وقائية قبل استعادة'}</td>
                    <td>{backup.labelAr}</td>
                    <td className="kl-admin-mono">{backup.createdBy}</td>
                    <td>{Math.max(1, Math.round(backup.bytes / 1024))} ك.ب</td>
                    <td className="kl-admin-identity">
                      مخزن: {backup.counts.storeMatches} مباراة و{backup.counts.storeNews} خبرًا · يدوي:{' '}
                      {backup.counts.manualMatches} مباراة و{backup.counts.manualNews} خبرًا · تثبيتات{' '}
                      {backup.counts.overrides} · فرق {backup.counts.teams} · عمليات {backup.counts.audit}
                    </td>
                    <td>
                      <span className="kl-admin-mono" title="بصمة مختصرة تُحسب عند الحفظ">
                        {backup.checksumShort}
                      </span>
                      <div className="kl-admin-identity">
                        {verification[backup.id] || 'اضغط «فحص السلامة» لإعادة حساب البصمة من المحتوى.'}
                      </div>
                    </td>
                    <td>
                      <div className="kl-admin-row-actions">
                        <ActionButton busyKey={`verify-${backup.id}`} busy={busy} onClick={() => verify(backup.id)}>
                          فحص السلامة
                        </ActionButton>
                        <a href={`/api/admin/backups/${encodeURIComponent(backup.id)}?download=1`}>تنزيل</a>
                        <ActionButton
                          busyKey={`delete-${backup.id}`}
                          busy={busy}
                          tone="danger"
                          disabled={!canWrite}
                          disabledReasonAr={disabledReasonAr}
                          confirmAr={`حذف النسخة «${backup.id}»؟`}
                          onClick={() => remove(backup.id)}
                        >
                          حذف
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="kl-admin-card">
        <h2>الاستعادة</h2>
        <p className="kl-admin-note">
          الاستعادة تُعيد مستند الإدارة ولقطة المخزن إلى لحظة النسخة. تُنشئ اللوحة تلقائيًا نسخة وقائية من
          الحالة الحالية قبل أي كتابة، ولو تعذّرت النسخة الوقائية تُرفض الاستعادة كاملة.
        </p>
        {!canRestore ? (
          <p className="kl-admin-note kl-admin-note-warn">
            الاستعادة متاحة لدور «المالك» فقط — دورك الحالي لا يملك صلاحية backups:restore.
          </p>
        ) : null}
        <div className="kl-admin-form">
          <Field label="معرّف النسخة" hint="انسخه من الجدول أعلاه">
            <input value={restoreId} onChange={(event) => setRestoreId(event.target.value)} dir="ltr" />
          </Field>
          <Field label="اكتب المعرّف نفسه للتأكيد" hint="خطوة تأكيد إضافية إلزامية">
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} dir="ltr" />
          </Field>
        </div>
        <div className="kl-admin-actions" style={{ marginTop: 10 }}>
          <ActionButton
            busyKey="restore"
            busy={busy}
            tone="danger"
            disabled={!canRestore || !durableStorage || !restoreId || confirmation !== restoreId}
            disabledReasonAr={
              !canRestore
                ? 'الاستعادة لدور المالك فقط.'
                : !durableStorage
                  ? 'لا يوجد تخزين دائم لتنفيذ الاستعادة بأمان.'
                  : 'أدخل معرّف النسخة واكتبه مرة ثانية للتأكيد.'
            }
            onClick={restore}
          >
            استعادة هذه النسخة
          </ActionButton>
        </div>
        <ResultNote result={result} />
      </section>
    </>
  );
}
