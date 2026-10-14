import React from 'react';
import type { Metadata } from 'next';
import { getAdminLogs, getAuditStats } from '@/lib/admin/service';
import { getManualStatus } from '@/lib/admin/manual-store';
import { formatDateAr } from '../_lib/format';
import { Badge, Kv } from '../_components/ui';
import { adminMetadata, guardAdminPage } from '../_lib/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'السجلات', ...adminMetadata };

/**
 * صفحتان في واحدة:
 *  • سجل العمليات الإدارية: من فعل ماذا، ومتى، وهل نجحت العملية — يُكتب من الخادم عند
 *    كل عملية حساسة (حفظ/تعطيل/حذف/استعادة) ويُحفظ في نفس طبقة الإدارة الدائمة.
 *  • سجل الأخطاء: أخطاء المصادر، وأخطاء استيراد الأخبار، ونتيجة آخر محاولة تحديث.
 */
export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await guardAdminPage('logs:read', 'السجلات');
  if (!guard.allowed) return guard.denied;

  const params = await searchParams;
  const rawLimit = Array.isArray(params.limit) ? params.limit[0] : params.limit;
  const limit = Math.min(200, Math.max(10, Number(rawLimit) || 60));

  const logs = getAdminLogs(limit);
  const stats = getAuditStats();
  const storage = getManualStatus();

  return (
    <>
      <section className="kl-admin-card">
        <div className="kl-admin-head">
          <h2>ملخّص</h2>
          <form className="kl-admin-actions" method="get" action="/admin/logs">
            <select name="limit" defaultValue={String(limit)} className="kl-admin-btn">
              <option value="30">30 سطرًا</option>
              <option value="60">60 سطرًا</option>
              <option value="120">120 سطرًا</option>
              <option value="200">200 سطر</option>
            </select>
            <button type="submit" className="kl-admin-btn kl-admin-btn-primary">
              تحديث العرض
            </button>
          </form>
        </div>
        <Kv
          items={[
            { label: 'عمليات إدارية مسجّلة', value: stats.total },
            { label: 'عمليات فاشلة', value: stats.failures },
            { label: 'آخر عملية', value: stats.lastAt ? formatDateAr(stats.lastAt) : 'لا يوجد' },
            { label: 'أخطاء المصادر المحفوظة', value: logs.sourceErrors.length },
            { label: 'أخطاء استيراد الأخبار', value: logs.newsImportErrors.length },
            { label: 'سجلات المزامنة', value: logs.syncLogs.length },
            { label: 'تخزين اللوحة', value: storage.labelAr },
            { label: 'إصدار المستند', value: `rev ${storage.revision}` },
          ]}
        />
        {!storage.durable ? (
          <p className="kl-admin-note kl-admin-note-warn">
            السجلات هنا محفوظة في التخزين المحلي المؤقت لهذه البيئة فقط: {storage.noteAr}
          </p>
        ) : null}
      </section>

      <section className="kl-admin-card">
        <h2>سجل العمليات الإدارية</h2>
        {logs.audit.length === 0 ? (
          <p className="kl-admin-note">لا عمليات إدارية مسجّلة بعد.</p>
        ) : (
          <div className="kl-admin-table-wrap">
            <table className="kl-admin-table">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المشرف</th>
                  <th>الدور</th>
                  <th>العملية</th>
                  <th>الهدف</th>
                  <th>الملخّص</th>
                  <th>النتيجة</th>
                </tr>
              </thead>
              <tbody>
                {logs.audit.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateAr(entry.at)}</td>
                    <td className="kl-admin-mono">{entry.actor}</td>
                    <td>{entry.role}</td>
                    <td className="kl-admin-mono">{entry.action}</td>
                    <td className="kl-admin-mono">{entry.target}</td>
                    <td>{entry.summaryAr}</td>
                    <td>{entry.ok ? <Badge tone="ok">نجحت</Badge> : <Badge tone="danger">فشلت</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="kl-admin-card">
        <h2>سجل أخطاء المصادر</h2>
        {logs.sourceErrors.length === 0 ? (
          <p className="kl-admin-note kl-admin-note-ok">لا أخطاء مسجّلة.</p>
        ) : (
          <ul className="kl-admin-list">
            {logs.sourceErrors.map((error) => (
              <li key={error.id}>
                {formatDateAr(error.timestamp)} — <span className="kl-admin-mono">{error.sourceId}</span>:{' '}
                {error.messageAr}
                {error.httpStatus ? ` (HTTP ${error.httpStatus})` : ''}{' '}
                <span className="kl-admin-mono">{error.endpoint}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="kl-admin-card">
        <h2>أخطاء استيراد الأخبار</h2>
        {logs.newsImportErrors.length === 0 ? (
          <p className="kl-admin-note kl-admin-note-ok">لا أخطاء مسجّلة.</p>
        ) : (
          <ul className="kl-admin-list">
            {logs.newsImportErrors.map((error) => (
              <li key={error.id}>
                {formatDateAr(error.timestamp)} — <span className="kl-admin-mono">{error.sourceId}</span>:{' '}
                {error.messageAr} {error.title ? `(${error.title})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
