import React from 'react';
import type { Metadata } from 'next';
import { getDashboard } from '@/lib/admin/service';
import { roleHasPermission } from '@/lib/auth/admin-session';
import { formatDateAr } from './_lib/format';
import { Badge, Kv } from './_components/ui';
import SyncControls from './_components/sync-controls';
import { adminMetadata, guardAdminPage } from './_lib/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'نظرة عامة', ...adminMetadata };

/**
 * نظرة عامة: كل رقم هنا مقروء من مخزن الموقع ومستند الإدارة الفعليين، وكل تحذير
 * ناتج عن فحص حقيقي (تقادم بيانات، غياب تخزين دائم، تعطيل كل المصادر…). لا يوجد
 * رقم واحد «تقديري» في هذه الصفحة.
 */
export default async function AdminHomePage() {
  const guard = await guardAdminPage('dashboard:read', 'نظرة عامة');
  if (!guard.allowed) return guard.denied;
  const dashboard = await getDashboard();
  const { counts, sync, storage, settings } = dashboard;

  return (
    <>
      <section className="kl-admin-card">
        <h2>حالة النظام الآن</h2>
        <Kv
          items={[
            { label: 'وقت القراءة', value: formatDateAr(dashboard.generatedAt) },
            { label: 'تخزين تعديلات الإدارة', value: storage.labelAr },
            { label: 'الكتابة متاحة', value: storage.writable && storage.durable ? 'نعم' : 'لا' },
            { label: 'إصدار مستند الإدارة', value: `rev ${storage.revision}` },
            { label: 'مصادر مفعّلة', value: `${dashboard.enabledSources} من ${dashboard.sources.length}` },
            { label: 'آخر مزامنة كاملة', value: formatDateAr(sync.lastFullSyncAt) },
            { label: 'آخر مزامنة مباشرة', value: formatDateAr(sync.lastLiveSyncAt) },
            { label: 'آخر مزامنة أخبار', value: sync.lastNewsSyncAt ? formatDateAr(sync.lastNewsSyncAt) : 'لم تُسجَّل بعد' },
            {
              label: 'آخر محاولة تحديث مباريات',
              value: sync.lastMatchesSyncAttemptAt ? formatDateAr(sync.lastMatchesSyncAttemptAt) : 'لم تُسجَّل بعد',
            },
            {
              label: 'آخر تحديث ناجح للمباريات',
              value: sync.lastSuccessfulMatchesSyncAt ? formatDateAr(sync.lastSuccessfulMatchesSyncAt) : 'لم يُسجَّل بعد',
            },
          ]}
        />
      </section>

      {dashboard.warnings.length > 0 ? (
        <section className="kl-admin-banner" role="status">
          <strong>تحذيرات مبنية على فحص فعلي:</strong>
          <ul className="kl-admin-list">
            {dashboard.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="kl-admin-note kl-admin-note-ok">لا تحذيرات: التخزين دائم، والمصادر المفعّلة حديثة.</div>
      )}

      <section className="kl-admin-card">
        <h2>محتوى الموقع</h2>
        <div className="kl-admin-grid">
          <Stat labelAr="مباريات في المخزن" value={counts.matches} />
          <Stat labelAr="مباشرة الآن" value={counts.liveMatches} />
          <Stat labelAr="مباريات اليوم (توقيت القاهرة)" value={counts.todayMatches} />
          <Stat labelAr="مباريات أُدخلت يدويًا" value={counts.manualMatches} />
          <Stat labelAr="سجلات عليها تثبيت/استبعاد" value={counts.overriddenMatches} />
          <Stat labelAr="فرق" value={counts.teams} />
          <Stat labelAr="بطولات" value={counts.competitions} />
          <Stat labelAr="مواسم" value={counts.seasons} />
          <Stat labelAr="أخبار منشورة" value={counts.newsPublished} />
          <Stat labelAr="أخبار مكتوبة في اللوحة" value={counts.newsManual} />
          <Stat labelAr="جداول ترتيب محفوظة" value={counts.standings} />
        </div>
      </section>

      <SyncControls
        canRun={roleHasPermission(guard.identity!.role, 'sync:run') && storage.writable}
        disabledReasonAr={
          !roleHasPermission(guard.identity!.role, 'sync:run')
            ? 'دورك لا يملك صلاحية تشغيل المزامنة.'
            : 'التخزين غير قابل للكتابة على هذه البيئة — لن تُحفظ نتيجة التشغيل.'
        }
      />

      <section className="kl-admin-card">
        <h2>آخر نتيجة تحديث للمباريات</h2>
        {sync.lastMatchesSyncResult ? (
          <>
            <Kv
              items={[
                { label: 'نجحت المحاولة', value: sync.lastMatchesSyncResult.ok ? 'نعم' : 'لا' },
                {
                  label: 'وقت المحاولة',
                  value: sync.lastMatchesSyncAttemptAt ? formatDateAr(sync.lastMatchesSyncAttemptAt) : '—',
                },
                { label: 'المُشغِّل', value: sync.lastMatchesSyncResult.trigger },
                { label: 'مباريات جُلبت', value: sync.lastMatchesSyncResult.matchesFetched },
                { label: 'أُضيفت', value: sync.lastMatchesSyncResult.matchesInserted ?? 0 },
                { label: 'حُدِّثت', value: sync.lastMatchesSyncResult.matchesUpdated ?? 0 },
                { label: 'مصادر نجحت', value: (sync.lastMatchesSyncResult.sourcesOk || []).join(' , ') || '—' },
                { label: 'مصادر فشلت', value: (sync.lastMatchesSyncResult.sourcesFailed || []).join(' , ') || '—' },
              ]}
            />
            {sync.lastMatchesSyncResult.messageAr ? (
              <p className="kl-admin-note">{sync.lastMatchesSyncResult.messageAr}</p>
            ) : null}
            {sync.lastMatchesSyncResult.sourceStatus ? (
              <div className="kl-admin-table-wrap">
                <table className="kl-admin-table">
                  <thead>
                    <tr>
                      <th>المصدر</th>
                      <th>النتيجة</th>
                      <th>HTTP</th>
                      <th>ملاحظة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(sync.lastMatchesSyncResult.sourceStatus).map(([sourceId, status]) => (
                      <tr key={sourceId}>
                        <td className="kl-admin-mono">{sourceId}</td>
                        <td>{status?.ok ? 'نجح' : 'فشل'}</td>
                        <td>{status?.httpStatus ?? '—'}</td>
                        <td>{status?.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <p className="kl-admin-note">لا توجد نتيجة تحديث مسجّلة بعد — أول تشغيل سيُسجّل نتيجته هنا.</p>
        )}
        {sync.lastSyncLog ? (
          <p className="kl-admin-note">
            آخر سجل مزامنة: {formatDateAr(sync.lastSyncLog.at)} · الوضع {sync.lastSyncLog.mode} · المُشغِّل{' '}
            {sync.lastSyncLog.trigger} · مباريات في المخزن {sync.lastSyncLog.totalMatchesInStore}
          </p>
        ) : null}
      </section>

      <div className="kl-admin-split">
        <section className="kl-admin-card">
          <h2>المصادر (حالة مختصرة)</h2>
          <div className="kl-admin-table-wrap">
            <table className="kl-admin-table">
              <thead>
                <tr>
                  <th>المصدر</th>
                  <th>مفعّل</th>
                  <th>الحالة</th>
                  <th>آخر نجاح</th>
                  <th>سجلات</th>
                  <th>أخطاء</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.sources.map((source) => (
                  <tr key={source.id}>
                    <td>
                      {source.nameAr}
                      <div className="kl-admin-mono">{source.id}</div>
                    </td>
                    <td>{source.enabled ? 'نعم' : 'لا'}</td>
                    <td>
                      {source.stale ? (
                        <Badge tone="warn">بيانات متقادمة</Badge>
                      ) : source.status === 'ok' ? (
                        <Badge tone="ok">سليم</Badge>
                      ) : source.status === 'error' ? (
                        <Badge tone="danger">خطأ</Badge>
                      ) : (
                        <Badge tone="muted">{source.statusLabelAr}</Badge>
                      )}
                    </td>
                    <td>{source.lastSuccessfulDataAt ? formatDateAr(source.lastSuccessfulDataAt) : '—'}</td>
                    <td>{source.recordsImported}</td>
                    <td>{source.errorCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="kl-admin-card">
          <h2>آخر عمليات الإدارة</h2>
          {dashboard.audit.length === 0 ? (
            <p className="kl-admin-note">لا عمليات إدارية مسجّلة بعد.</p>
          ) : (
            <ul className="kl-admin-list">
              {dashboard.audit.slice(0, 12).map((entry) => (
                <li key={`${entry.at}-${entry.action}-${entry.target}`}>
                  {formatDateAr(entry.at)} — {entry.summaryAr || `${entry.action} على ${entry.target}`}{' '}
                  <span className="kl-admin-mono">({entry.actor})</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="kl-admin-card">
        <h2>آخر أخطاء المصادر</h2>
        {dashboard.recentErrors.length === 0 ? (
          <p className="kl-admin-note kl-admin-note-ok">لا أخطاء مسجّلة من المصادر.</p>
        ) : (
          <ul className="kl-admin-list">
            {dashboard.recentErrors.map((error, index) => (
              <li key={`${error.at}-${index}`}>
                {formatDateAr(error.at)} — <strong>{error.sourceId}</strong>: {error.messageAr}
                {error.httpStatus ? ` (HTTP ${error.httpStatus})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="kl-admin-note">
        إعدادات نشطة: صلاحية المباريات {settings.matchesFreshnessMinutes} دقيقة · صلاحية الأخبار{' '}
        {settings.newsFreshnessMinutes} دقيقة · تحذير تقادم المصدر بعد {settings.staleSourceWarningHours} ساعة.
      </p>
    </>
  );
}

function Stat({ labelAr, value }: { labelAr: string; value: number }) {
  return (
    <div className="kl-admin-stat">
      <strong>{value}</strong>
      <span>{labelAr}</span>
    </div>
  );
}
