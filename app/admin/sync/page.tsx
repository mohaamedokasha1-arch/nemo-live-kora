import React from 'react';
import type { Metadata } from 'next';
import { getAdminLogs, getDashboard } from '@/lib/admin/service';
import { roleHasPermission } from '@/lib/auth/admin-session';
import { formatDateAr } from '../_lib/format';
import { Badge, Kv } from '../_components/ui';
import SyncControls from '../_components/sync-controls';
import { adminMetadata, guardAdminPage } from '../_lib/guard';
import { getCronTable } from '@/lib/admin/cron-info';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'التحديث التلقائي', ...adminMetadata };

/**
 * التحكم في التحديث التلقائي: جدول الكرون الفعلي (مقروء من `vercel.json` في نفس
 * المستودع، فلا يوجد ادعاء بمواعيد غير مضمونة)، وسجل كل محاولة، وزر تشغيل يدوي حقيقي
 * يستخدم نفس محرّك المزامنة. الكرون لا يُعطَّل — التشغيل اليدوي إضافة فوقه لا بديل عنه.
 */
export default async function AdminSyncPage() {
  const guard = await guardAdminPage('sync:run', 'التحديث التلقائي');
  if (!guard.allowed) return guard.denied;

  const dashboard = await getDashboard();
  const logs = getAdminLogs(40);
  const cron = await getCronTable();
  const canRun = roleHasPermission(guard.identity!.role, 'sync:run');

  return (
    <>
      <section className="kl-admin-card">
        <h2>مهام الكرون في بيئة النشر</h2>
        {cron.ok ? (
          <>
            <p className="kl-admin-note">
              هذه هي المهام المضبوطة فعليًا في <span className="kl-admin-mono">vercel.json</span> داخل المستودع، وهي
              التي تُشغّلها منصة Vercel تلقائيًا بعد النشر. لم نُعطّل أي مهمة، والتشغيل اليدوي أدناه إضافة فوقها.
            </p>
            <div className="kl-admin-table-wrap">
              <table className="kl-admin-table">
                <thead>
                  <tr>
                    <th>المهمة</th>
                    <th>المسار</th>
                    <th>الموعد (UTC)</th>
                    <th>التوقيت المحلي (Africa/Cairo)</th>
                  </tr>
                </thead>
                <tbody>
                  {cron.jobs.map((job) => (
                    <tr key={job.path}>
                      <td>{job.titleAr}</td>
                      <td className="kl-admin-mono">{job.path}</td>
                      <td className="kl-admin-mono">{job.schedule}</td>
                      <td>{job.localTimeAr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {cron.noteAr ? <p className="kl-admin-note">{cron.noteAr}</p> : null}
          </>
        ) : (
          <p className="kl-admin-note kl-admin-note-warn">{cron.messageAr}</p>
        )}
      </section>

      <section className="kl-admin-card">
        <h2>آخر تشغيلات المزامنة (من سجل المخزن)</h2>
        <Kv
          items={[
            { label: 'آخر مزامنة كاملة', value: formatDateAr(dashboard.sync.lastFullSyncAt) },
            { label: 'آخر مزامنة مباشرة', value: formatDateAr(dashboard.sync.lastLiveSyncAt) },
            { label: 'آخر مزامنة أخبار', value: dashboard.sync.lastNewsSyncAt ? formatDateAr(dashboard.sync.lastNewsSyncAt) : 'لم تُسجَّل' },
            { label: 'مصادر مفعّلة', value: dashboard.enabledSources },
            { label: 'مصادر معطّلة', value: dashboard.disabledSources },
          ]}
        />
        <p className="kl-admin-note">
          «آخر مزامنة» تُقرأ من المخزن المحفوظ، وليست قيمًا متوقّعة. لو توقّف الكرون عند مزوّد الاستضافة فستبقى
          هذه المواعيد ثابتة — وهذا أول ما يظهر في هذه الصفحة.
        </p>
      </section>

      <SyncControls canRun={canRun} disabledReasonAr="دورك لا يملك صلاحية تشغيل المزامنة." />

      <section className="kl-admin-card">
        <h2>سجل عمليات المزامنة</h2>
        {logs.syncLogs.length === 0 ? (
          <p className="kl-admin-note">لا سجلات مزامنة محفوظة بعد.</p>
        ) : (
          <div className="kl-admin-table-wrap">
            <table className="kl-admin-table">
              <thead>
                <tr>
                  <th>الانتهاء</th>
                  <th>الوضع</th>
                  <th>المُشغِّل</th>
                  <th>مباريات</th>
                  <th>أخبار</th>
                  <th>نجحت</th>
                  <th>المصادر</th>
                </tr>
              </thead>
              <tbody>
                {logs.syncLogs.map((log, index) => {
                  const okSources = (log.sourceResults || []).filter((item) => item.status === 'active').length;
                  const failed = (log.sourceResults || []).filter((item) => item.status === 'error' || item.status === 'degraded').length;
                  return (
                    <tr key={`${log.finishedAt}-${index}`}>
                      <td>{formatDateAr(log.finishedAt)}</td>
                      <td>{log.mode}</td>
                      <td>{log.trigger}</td>
                      <td>{log.totalMatchesInStore}</td>
                      <td>{log.totalNewsInStore}</td>
                      <td>
                        {failed === 0 ? <Badge tone="ok">{okSources} مصدرًا بلا فشل</Badge> : <Badge tone="danger">{failed} فشل</Badge>}
                      </td>
                      <td className="kl-admin-mono">
                        {(log.sourceResults || []).map((item) => `${item.sourceId}:${item.status}`).join(' , ') || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
