import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getManualStatus } from '@/lib/admin/manual-store';
import { queryAdminNews } from '@/lib/admin/service';
import { SOURCE_CAPABILITIES } from '@/lib/news/capabilities';
import { getGatewayDatabase } from '@/lib/db/store';
import { roleHasPermission } from '@/lib/auth/admin-session';
import { formatDateAr } from '../../_lib/format';
import { Badge } from '../../_components/ui';
import NewsEditor, { EMPTY_NEWS_FORM } from '../../_components/news-editor';
import NewsRowActions from '../../_components/news-row-actions';
import { adminMetadata, guardAdminPage } from '../../_lib/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'إدارة الأخبار', ...adminMetadata };

/**
 * الأخبار: كتابة خبر جديد من اللوحة، وتعديل/نشر/أرشفة الموجود، مع عرض شرط استخدام
 * محتوى كل مصدر قبل النشر. لا يُنشر أي خبر من مصدر خارجي دون اجتياز فحوص
 * `lib/news/validate.ts`، وصفحات الأخبار المنشورة تبقى على مساراتها نفسها.
 */
export default async function AdminNewsManagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await guardAdminPage('news:read', 'إدارة الأخبار');
  if (!guard.allowed) return guard.denied;

  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value || '';
  };

  const { rows, total } = queryAdminNews({
    search: first('search') || undefined,
    status: first('status') || undefined,
    origin: (first('origin') as 'source' | 'manual' | 'all') || 'all',
    limit: 60,
  });
  const storage = getManualStatus();
  const db = getGatewayDatabase();
  const canWrite = roleHasPermission(guard.identity!.role, 'news:write');
  const disabledReasonAr = storage.writable
    ? 'دورك لا يحمل صلاحية الكتابة في الأخبار.'
    : 'التخزين غير قابل للكتابة على هذه البيئة — لن يُحفظ الخبر.';
  const accessNotesAr = Object.values(db.sources)
    .filter((source) => source.providesNews)
    .map((source) => ({
      sourceId: source.id,
      nameAr: source.nameAr,
      noteAr: SOURCE_CAPABILITIES[source.id]?.newsAccessNoteAr ?? 'لم يُسجَّل شرط استخدام لهذا المصدر.',
    }));

  return (
    <>
      <section className="kl-admin-card">
        <div className="kl-admin-head">
          <h2>أخبار الموقع ({total})</h2>
          <span className="kl-admin-identity">
            آخر مزامنة أخبار: {db.meta.lastNewsSyncAt ? formatDateAr(db.meta.lastNewsSyncAt) : 'لم تُسجَّل'}
          </span>
        </div>
        <form className="kl-admin-toolbar" method="get" action="/admin/news/manage">
          <div className="kl-admin-field">
            <label htmlFor="news-search">بحث في العنوان/الرابط</label>
            <input id="news-search" name="search" defaultValue={first('search')} />
          </div>
          <div className="kl-admin-field">
            <label htmlFor="news-status">الحالة</label>
            <select id="news-status" name="status" defaultValue={first('status')}>
              <option value="">الكل</option>
              <option value="published">منشور</option>
              <option value="pending">بانتظار المراجعة</option>
              <option value="stale">قديم</option>
              <option value="rejected">مرفوض</option>
              <option value="duplicate">مكرر</option>
            </select>
          </div>
          <div className="kl-admin-field">
            <label htmlFor="news-origin">المصدر</label>
            <select id="news-origin" name="origin" defaultValue={first('origin') || 'all'}>
              <option value="all">الكل</option>
              <option value="manual">مكتوب في اللوحة</option>
              <option value="source">من المصادر</option>
            </select>
          </div>
          <div className="kl-admin-actions">
            <button type="submit" className="kl-admin-btn kl-admin-btn-primary">
              تصفية
            </button>
            <Link className="kl-admin-btn" href="/admin/news/manage">
              تفريغ
            </Link>
          </div>
        </form>
      </section>

      <NewsEditor
        mode="create"
        initial={{
          ...EMPTY_NEWS_FORM,
          categoryAr: first('category') || EMPTY_NEWS_FORM.categoryAr,
        }}
        canWrite={canWrite && storage.writable && storage.durable}
        disabledReasonAr={disabledReasonAr}
        accessNotesAr={accessNotesAr}
      />

      <section className="kl-admin-card">
        <h2>قائمة الأخبار</h2>
        {rows.length === 0 ? (
          <p className="kl-admin-note">لا أخبار مطابقة للفلاتر.</p>
        ) : (
          <div className="kl-admin-table-wrap">
            <table className="kl-admin-table">
              <thead>
                <tr>
                  <th>العنوان</th>
                  <th>الحالة</th>
                  <th>المصدر</th>
                  <th>الناشر</th>
                  <th>تاريخ النشر</th>
                  <th>الرابط العام</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.title}
                      {row.reasonAr ? <div className="kl-admin-identity">سبب: {row.reasonAr}</div> : null}
                    </td>
                    <td>
                      {row.status === 'published' ? (
                        <Badge tone="ok">منشور</Badge>
                      ) : row.status === 'pending' ? (
                        <Badge tone="warn">بانتظار المراجعة</Badge>
                      ) : row.status === 'rejected' ? (
                        <Badge tone="danger">مرفوض</Badge>
                      ) : (
                        <Badge tone="muted">{row.status}</Badge>
                      )}
                      {row.indexable ? <div className="kl-admin-identity">قابل للفهرسة</div> : null}
                    </td>
                    <td>{row.origin === 'manual' ? <Badge tone="info">اللوحة</Badge> : row.publisherName}</td>
                    <td>{row.publisherName}</td>
                    <td>{row.publishedAt ? formatDateAr(row.publishedAt) : 'غير معروف'}</td>
                    <td>
                      {row.status === 'published' ? (
                        <a href={`/news/${row.slug}`} target="_blank" rel="noreferrer" className="kl-admin-mono">
                          /news/{row.slug}
                        </a>
                      ) : (
                        <span className="kl-admin-identity">لا يظهر للزوار</span>
                      )}
                    </td>
                    <td>
                      <NewsRowActions
                        newsId={row.id}
                        isManual={row.origin === 'manual'}
                        status={row.status}
                        canWrite={canWrite && storage.writable && storage.durable}
                        disabledReasonAr={disabledReasonAr}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="kl-admin-card">
        <h2>ملاحظات مهمة قبل النشر</h2>
        <ul className="kl-admin-list">
          <li>لا يُنشر خبر المصدر إلا بعد رابط مقال حقيقي وناشر معروف (فحوص `lib/news/validate.ts`).</li>
          <li>الخبر المكتوب في اللوحة مسؤوليتك التحريرية ويُسجَّل باسمك في سجل العمليات.</li>
          <li>لا نغيّر روابط الأخبار المنشورة؛ أرشفة خبر تُبقيه على مساره وتخفيه من الواجهة وخريطة الموقع فقط.</li>
        </ul>
      </section>
    </>
  );
}
