import React from 'react';
import type { Metadata } from 'next';
import { getDashboard } from '@/lib/admin/service';
import { getManualStatus } from '@/lib/admin/manual-store';
import { roleHasPermission } from '@/lib/auth/admin-session';
import { formatDateAr } from '../_lib/format';
import { Badge } from '../_components/ui';
import SourceControls from '../_components/source-controls';
import { adminMetadata, guardAdminPage } from '../_lib/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'المصادر', ...adminMetadata };

/**
 * المصادر: ما هو موصول فعلًا (لا ما نتمنى أنه موصول).
 * كل سطر مبني على حالة المخزن الحقيقية: مفتاح مضبوط أو لا، متى نجح آخر مرة،
 * كم سجلًا جلب، وما هي آخر أخطائه. وكل مصدر معطّل يظهر «معطّل» بوضوح لا بقيم وهمية.
 */
export default async function AdminSourcesPage() {
  const guard = await guardAdminPage('sources:read', 'المصادر');
  if (!guard.allowed) return guard.denied;

  const dashboard = await getDashboard();
  const storage = getManualStatus();
  const canWrite = roleHasPermission(guard.identity!.role, 'sources:write');
  const canRun = roleHasPermission(guard.identity!.role, 'sync:run');

  const liveSources = dashboard.sources.filter((source) => source.providesMatches);
  const newsSources = dashboard.sources.filter((source) => source.providesNews);

  return (
    <>
      <section className="kl-admin-card">
        <h2>ملخّص المصادر</h2>
        <p className="kl-admin-note">
          المفعّل الآن: <strong>{dashboard.enabledSources}</strong> من <strong>{dashboard.sources.length}</strong>{' '}
          مصدرًا · المعطّل: <strong>{dashboard.disabledSources}</strong> · تقادم البيانات:{' '}
          <strong>{dashboard.staleSources.length}</strong>.
        </p>
        <p className="kl-admin-note">
          مصادر المباريات ({liveSources.length}):{' '}
          {liveSources.map((source) => `${source.id}${source.enabled ? '' : ' (معطّل)'}`).join(' , ') || 'لا يوجد'}
          <br />
          مصادر الأخبار ({newsSources.length}):{' '}
          {newsSources.map((source) => `${source.id}${source.enabled ? '' : ' (معطّل)'}`).join(' , ') || 'لا يوجد'}
        </p>
        <p className="kl-admin-note kl-admin-note-warn">
          لا نُعلن وجود مصدر احتياطي إلا إذا كان موصولًا فعلًا ويظهر أدناه بحالة حقيقية. عند فشل كل المصادر يظل
          الموقع يعرض آخر بيانات صحيحة محفوظة مع وقت تحديثها — ولا تُستبدل بأي بيانات مصنوعة.
        </p>
      </section>

      <section className="kl-admin-card">
        <h2>جدول الحالة</h2>
        <div className="kl-admin-table-wrap">
          <table className="kl-admin-table">
            <thead>
              <tr>
                <th>المصدر</th>
                <th>ما يوفّره</th>
                <th>الحالة</th>
                <th>آخر محاولة</th>
                <th>آخر نجاح</th>
                <th>زمن الاستجابة</th>
                <th>سجلات جُلبت</th>
                <th>أخطاء</th>
                <th>المفتاح</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.sources.map((source) => (
                <tr key={source.id}>
                  <td>
                    <a href={`/admin/sources/${encodeURIComponent(source.id)}`}>{source.nameAr}</a>
                    <div className="kl-admin-mono">{source.id}</div>
                  </td>
                  <td>
                    {[
                      source.providesMatches ? 'مباريات' : null,
                      source.providesNews ? 'أخبار' : null,
                      source.providesStandings ? 'ترتيب' : null,
                    ]
                      .filter(Boolean)
                      .join(' , ') || '—'}
                  </td>
                  <td>
                    {!source.enabled ? (
                      <Badge tone="muted">معطّل</Badge>
                    ) : source.stale ? (
                      <Badge tone="warn">متقادم {source.staleHours ? `(${source.staleHours} س)` : ''}</Badge>
                    ) : source.status === 'error' ? (
                      <Badge tone="danger">خطأ</Badge>
                    ) : (
                      <Badge tone="ok">{source.statusLabelAr}</Badge>
                    )}
                  </td>
                  <td>{source.lastSyncAt ? formatDateAr(source.lastSyncAt) : '—'}</td>
                  <td>{source.lastSuccessfulDataAt ? formatDateAr(source.lastSuccessfulDataAt) : '—'}</td>
                  <td>{source.lastLatencyMs === null ? '—' : `${source.lastLatencyMs} م.ث`}</td>
                  <td>{source.recordsImported}</td>
                  <td>{source.errorCount}</td>
                  <td>
                    {source.requiresKey ? (
                      source.isKeyConfigured ? (
                        <Badge tone="ok">مضبوط</Badge>
                      ) : (
                        <Badge tone="danger">غير مضبوط</Badge>
                      )
                    ) : (
                      <Badge tone="muted">لا يحتاج</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="kl-admin-card">
        <h2>التحكم التفصيلي</h2>
        <p className="kl-admin-note">
          التعطيل هنا لا يحذف أي إعداد ولا أي بيانات سابقة — يمنع النداء الشبكي فقط، ويمكن الرجوع عنه في أي
          وقت. الترتيب يحدّد أولوية المحاولة والاحتياط بين المصادر التي توفّر النوع نفسه.
        </p>
      </section>

      {dashboard.sources.map((source) => (
        <SourceControls
          key={source.id}
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
      ))}

      <section className="kl-admin-card">
        <h2>آخر أخطاء المصادر بالتفصيل</h2>
        {dashboard.sources.every((source) => source.recentErrors.length === 0) ? (
          <p className="kl-admin-note kl-admin-note-ok">لا أخطاء مسجّلة لأي مصدر.</p>
        ) : (
          <ul className="kl-admin-list">
            {dashboard.sources.flatMap((source) =>
              source.recentErrors.map((error, index) => (
                <li key={`${source.id}-${error.at}-${index}`}>
                  <span className="kl-admin-mono">{source.id}</span> — {formatDateAr(error.at)}: {error.messageAr}
                  {error.httpStatus ? ` (HTTP ${error.httpStatus})` : ''}{' '}
                  <span className="kl-admin-mono">{error.endpoint}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </section>
    </>
  );
}
