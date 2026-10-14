import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSourceRows } from '@/lib/admin/service';
import { getManualStatus } from '@/lib/admin/manual-store';
import { getGatewayDatabase } from '@/lib/db/store';
import { roleHasPermission } from '@/lib/auth/admin-session';
import { formatDateAr } from '../../_lib/format';
import { Badge, Kv } from '../../_components/ui';
import SourceControls from '../../_components/source-controls';
import { adminMetadata, guardAdminPage } from '../../_lib/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'تفاصيل مصدر', ...adminMetadata };

/** صفحة مصدر واحد: الاسم، نوع البيانات، حالة الاتصال الحقيقية، الأخطاء، والتحكم الكامل. */
export default async function AdminSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPage('sources:read', 'تفاصيل مصدر');
  if (!guard.allowed) return guard.denied;

  const { id } = await params;
  const sourceId = decodeURIComponent(id);
  const source = getSourceRows().find((row) => row.id === sourceId);
  if (!source) notFound();

  const storage = getManualStatus();
  const db = getGatewayDatabase();
  const dbSource = db.sources?.[source.id as keyof typeof db.sources] ?? null;
  const canWrite = roleHasPermission(guard.identity!.role, 'sources:write');
  const canRun = roleHasPermission(guard.identity!.role, 'sync:run');

  return (
    <>
      <p className="kl-admin-note">
        <Link href="/admin/sources">← رجوع إلى المصادر</Link>
      </p>

      <section className="kl-admin-card">
        <div className="kl-admin-head">
          <h2>{source.nameAr}</h2>
          {source.enabled ? <Badge tone={source.stale ? 'warn' : 'ok'}>{source.statusLabelAr}</Badge> : <Badge tone="muted">معطّل</Badge>}
        </div>
        <Kv
          items={[
            { label: 'المعرّف', value: <span className="kl-admin-mono">{source.id}</span> },
            { label: 'نوع البيانات', value: source.type },
            { label: 'العنوان الأساسي', value: <span className="kl-admin-mono">{source.baseUrl}</span> },
            { label: 'يوفّر', value: [source.providesMatches ? 'مباريات' : null, source.providesNews ? 'أخبار' : null, source.providesStandings ? 'ترتيب' : null].filter(Boolean).join(' , ') || '—' },
            { label: 'يحتاج مفتاحًا', value: source.requiresKey ? 'نعم' : 'لا' },
            {
              label: 'المفتاح المضبوط',
              value: source.requiresKey ? (source.isKeyConfigured ? 'مضبوط على الخادم' : 'غير مضبوط') : 'لا يحتاج',
            },
            { label: 'متغيّر المفتاح', value: <span className="kl-admin-mono">{source.keyEnvVar || '—'}</span> },
            { label: 'آخر محاولة', value: source.lastSyncAt ? formatDateAr(source.lastSyncAt) : 'لم تُسجَّل' },
            { label: 'آخر نجاح', value: source.lastSuccessfulDataAt ? formatDateAr(source.lastSuccessfulDataAt) : 'لم يُسجَّل' },
            { label: 'آخر فشل', value: source.lastFailedDataAt ? formatDateAr(source.lastFailedDataAt) : 'لا يوجد' },
            { label: 'آخر رمز HTTP', value: source.lastHttpStatus ?? '—' },
            { label: 'زمن آخر استجابة', value: source.lastLatencyMs === null ? '—' : `${source.lastLatencyMs} م.ث` },
            { label: 'سجلات جُلبت', value: source.recordsImported },
            { label: 'أخبار جُلبت/نُشرت', value: `${source.newsImportedCount} / ${source.newsPublishedCount}` },
            { label: 'عدد الأخطاء', value: source.errorCount },
            { label: 'التقادم', value: source.stale ? `متقادم (${source.staleHours} ساعة)` : 'حديث' },
          ]}
        />
        <p className="kl-admin-note">{source.notesAr}</p>
        {source.requiresKey && !source.isKeyConfigured ? (
          <p className="kl-admin-note kl-admin-note-warn">
            هذا المصدر يحتاج متغيّر البيئة <span className="kl-admin-mono">{source.keyEnvVar}</span> على الخادم. بدون
            المفتاح لا يمكن تشغيله، ولن نُظهر بيانات وهمية مكانه — المصدر يبقى معطّلًا حتى يُضبط المفتاح.
          </p>
        ) : null}
      </section>

      <SourceControls
        source={{
          id: source.id,
          nameAr: source.nameAr,
          enabled: source.enabled,
          priority: source.priority,
          noteAr: source.controlNoteAr,
          isKeyConfigured: source.isKeyConfigured,
          requiresKey: source.requiresKey,
          keyEnvVar: source.keyEnvVar,
        }}
        canWrite={canWrite}
        canRun={canRun}
        storageDurable={storage.durable && storage.writable}
        disabledReasonAr="دورك الحالي لا يملك صلاحية تعديل المصادر."
      />

      {dbSource?.testedEndpoints && dbSource.testedEndpoints.length > 0 ? (
        <section className="kl-admin-card">
          <h2>نقاط النهاية المُختبرة لهذا المصدر</h2>
          <ul className="kl-admin-list">
            {dbSource.testedEndpoints.map((endpoint: string) => (
              <li key={endpoint} className="kl-admin-mono">
                {endpoint}
              </li>
            ))}
          </ul>
          <p className="kl-admin-note">
            هذه النقاط هي ما يستدعيه المحرّك فعلًا. آخر رمز HTTP للمصدر: {source.lastHttpStatus ?? '—'} · زمن آخر
            استجابة: {source.lastLatencyMs === null ? '—' : `${source.lastLatencyMs} م.ث`}.
          </p>
        </section>
      ) : null}

      <section className="kl-admin-card">
        <h2>آخر أخطاء هذا المصدر</h2>
        {source.recentErrors.length === 0 ? (
          <p className="kl-admin-note kl-admin-note-ok">لا أخطاء مسجّلة.</p>
        ) : (
          <div className="kl-admin-table-wrap">
            <table className="kl-admin-table">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>الرسالة</th>
                  <th>HTTP</th>
                  <th>النقطة</th>
                </tr>
              </thead>
              <tbody>
                {source.recentErrors.map((error, index) => (
                  <tr key={`${error.at}-${index}`}>
                    <td>{formatDateAr(error.at)}</td>
                    <td>{error.messageAr}</td>
                    <td>{error.httpStatus ?? '—'}</td>
                    <td className="kl-admin-mono">{error.endpoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
