import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import MatchScoreView from '@/components/MatchScoreView';
import type { MatchStatusCode } from '@/lib/types';
import { getCompetitionRows, queryAdminMatches } from '@/lib/admin/service';
import { roleHasPermission } from '@/lib/auth/admin-session';
import { formatDateAr } from '../_lib/format';
import { Badge } from '../_components/ui';
import MatchRowActions from '../_components/match-row-actions';
import { adminMetadata, guardAdminPage } from '../_lib/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'المباريات', ...adminMetadata };

/**
 * قائمة المباريات: كل صف هو مباراة حقيقية في المخزن، مع مصدرها وهل عليها تثبيت يدوي.
 * الفلاتر تعمل على الخادم (نموذج GET عادي) فتعمل حتى بلا جافاسكربت.
 */
export default async function AdminMatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await guardAdminPage('matches:read', 'المباريات');
  if (!guard.allowed) return guard.denied;

  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value || '';
  };

  const limit = 50;
  const page = Math.max(1, Number(first('page')) || 1);
  const query = {
    search: first('search') || undefined,
    cairoDate: first('date') || undefined,
    competitionCode: first('competition') || undefined,
    status: first('status') || undefined,
    origin: (first('origin') as 'source' | 'manual' | 'all') || 'all',
    onlyOverridden: first('overridden') === '1',
    limit,
    offset: (page - 1) * limit,
  };
  const { rows, total } = queryAdminMatches(query);
  const competitions = getCompetitionRows();
  const canWrite = roleHasPermission(guard.identity!.role, 'matches:write');
  const pages = Math.max(1, Math.ceil(total / limit));
  const storage = (await import('@/lib/admin/manual-store')).getManualStatus();
  const disabledReasonAr = storage.writable
    ? 'دورك لا يملك صلاحية التعديل.'
    : 'التخزين غير قابل للكتابة على هذه البيئة — لن يُحفظ أي تعديل.';

  return (
    <>
      <section className="kl-admin-card">
        <div className="kl-admin-head">
          <h2>البحث والتصفية</h2>
          <Link className="kl-admin-btn kl-admin-btn-primary" href="/admin/matches/new">
            إضافة مباراة يدويًا
          </Link>
        </div>
        <form className="kl-admin-toolbar" method="get" action="/admin/matches">
          <div className="kl-admin-field">
            <label htmlFor="filter-search">بحث (فريق/بطولة/معرّف)</label>
            <input id="filter-search" name="search" defaultValue={first('search')} />
          </div>
          <div className="kl-admin-field">
            <label htmlFor="filter-date">تاريخ القاهرة</label>
            <input id="filter-date" name="date" defaultValue={first('date')} placeholder="2026-10-15" dir="ltr" />
          </div>
          <div className="kl-admin-field">
            <label htmlFor="filter-competition">البطولة</label>
            <select id="filter-competition" name="competition" defaultValue={first('competition')}>
              <option value="">الكل</option>
              {competitions.map((competition) => (
                <option key={competition.code} value={competition.code}>
                  {competition.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div className="kl-admin-field">
            <label htmlFor="filter-status">الحالة</label>
            <select id="filter-status" name="status" defaultValue={first('status')}>
              <option value="">الكل</option>
              <option value="scheduled">لم تبدأ</option>
              <option value="live">مباشر</option>
              <option value="finished">منتهية</option>
              <option value="postponed">مؤجّلة</option>
              <option value="cancelled">ملغاة</option>
            </select>
          </div>
          <div className="kl-admin-field">
            <label htmlFor="filter-origin">مصدر البيانات</label>
            <select id="filter-origin" name="origin" defaultValue={first('origin') || 'all'}>
              <option value="all">الكل</option>
              <option value="source">من المصادر</option>
              <option value="manual">إدخال يدوي</option>
            </select>
          </div>
          <div className="kl-admin-field">
            <label htmlFor="filter-overridden">المثبَّتة يدويًا فقط</label>
            <select id="filter-overridden" name="overridden" defaultValue={first('overridden')}>
              <option value="">لا</option>
              <option value="1">نعم</option>
            </select>
          </div>
          <div className="kl-admin-actions">
            <button type="submit" className="kl-admin-btn kl-admin-btn-primary">
              تصفية
            </button>
            <Link className="kl-admin-btn" href="/admin/matches">
              تفريغ الفلاتر
            </Link>
          </div>
        </form>
      </section>

      <section className="kl-admin-card">
        <div className="kl-admin-head">
          <h2>
            النتائج: {total} مباراة{' '}
            {total > limit ? <span className="kl-admin-identity">(صفحة {page} من {pages})</span> : null}
          </h2>
          <span className="kl-admin-identity">آخر قراءة: {formatDateAr(new Date().toISOString())}</span>
        </div>

        {rows.length === 0 ? (
          <p className="kl-admin-note">لا نتائج مطابقة للفلاتر الحالية.</p>
        ) : (
          <div className="kl-admin-table-wrap">
            <table className="kl-admin-table">
              <thead>
                <tr>
                  <th>المباراة</th>
                  <th>الموعد (القاهرة)</th>
                  <th>البطولة</th>
                  <th>الحالة</th>
                  <th>النتيجة</th>
                  <th>المصدر</th>
                  <th>آخر تحديث</th>
                  <th>التثبيت</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.homeNameAr} × {row.awayNameAr}
                      <div className="kl-admin-mono">{row.id}</div>
                    </td>
                    <td>
                      {row.cairoDate} — {row.cairoTime}
                    </td>
                    <td>{row.competitionNameAr}</td>
                    <td>
                      {row.status === 'live' ? (
                        <Badge tone="danger">{row.statusLabelAr}</Badge>
                      ) : row.status === 'finished' ? (
                        <Badge tone="ok">{row.statusLabelAr}</Badge>
                      ) : (
                        <Badge tone="info">{row.statusLabelAr}</Badge>
                      )}
                    </td>
                    {/* النتيجة عبر المكوّن المرجعي: رقم الأول ثم رقم الثاني بنفس ترتيب عمود «المباراة». */}
                    <td>
                      <MatchScoreView
                        score={{ home: row.scoreHome, away: row.scoreAway }}
                        status={row.status as MatchStatusCode}
                        homeTeam={{ nameAr: row.homeNameAr }}
                        awayTeam={{ nameAr: row.awayNameAr }}
                        containerTitle={`${row.homeNameAr} ${row.scoreHome ?? '—'} : ${row.scoreAway ?? '—'} ${row.awayNameAr}`}
                      />
                    </td>
                    <td>
                      {row.origin === 'manual' ? <Badge tone="warn">إدخال يدوي</Badge> : row.sourceLabelAr}
                      {/*
                        * السجل المُعلَّم كتكرار يبقى في اللوحة كامل البيانات حتى يراجعه المدير،
                        * لكنه لا يُعرض للزائر ولا يُعدّ في الجدول (والمصدر الأساسي في السجل الأساسي).
                      */}
                      {row.duplicateOfId ? (
                        <div className="kl-admin-identity" title={row.duplicateReasonAr ?? ''}>
                          <Badge tone="info">نسخة ثانية لنفس المباراة</Badge>
                          <div>
                            السجل الأساسي:{' '}
                            <a href={`/matches/${encodeURIComponent(row.duplicateOfId)}`} target="_blank" rel="noreferrer">
                              {row.duplicateOfId}
                            </a>
                          </div>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {formatDateAr(row.lastUpdatedAt)}
                      {row.staleHours !== null && row.staleHours > 24 ? (
                        <div className="kl-admin-identity">قبل {row.staleHours} ساعة</div>
                      ) : null}
                    </td>
                    <td>
                      {row.lockAll ? (
                        <Badge tone="warn">مجمّد بالكامل</Badge>
                      ) : row.hasManualOverride ? (
                        <Badge tone="info">{row.manualFields.length} حقل مثبَّت</Badge>
                      ) : (
                        <Badge tone="muted">تلقائي</Badge>
                      )}
                      {row.suppressedSources.length > 0 ? (
                        <div className="kl-admin-identity">مستبعد: {row.suppressedSources.join(' , ')}</div>
                      ) : null}
                    </td>
                    <td>
                      <MatchRowActions
                        matchId={row.id}
                        canWrite={canWrite}
                        disabledReasonAr={disabledReasonAr}
                        isManual={row.origin === 'manual'}
                      />
                      {row.landingPath ? (
                        <div className="kl-admin-identity">
                          <a href={row.landingPath} target="_blank" rel="noreferrer">
                            صفحة المباراة العامة
                          </a>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 ? (
          <div className="kl-admin-actions" style={{ marginTop: 10 }}>
            {Array.from({ length: pages }, (_, index) => index + 1).map((number) => {
              const query = new URLSearchParams({
                ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value || ''])),
                page: String(number),
              });
              return (
                <Link
                  key={number}
                  className={`kl-admin-btn${number === page ? ' kl-admin-btn-primary' : ''}`}
                  href={`/admin/matches?${query.toString()}`}
                >
                  {number}
                </Link>
              );
            })}
          </div>
        ) : null}
      </section>
    </>
  );
}
