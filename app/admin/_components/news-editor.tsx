'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton, Field, ResultNote, adminApi, useAdminAction } from './ui';

export interface NewsFormValues {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  bodyAr: string;
  imageUrl: string;
  canonicalUrl: string;
  publisherName: string;
  categoryAr: string;
  publishedAt: string;
  status: string;
  indexable: boolean;
  relatedMatchIds: string;
}

export const EMPTY_NEWS_FORM: NewsFormValues = {
  id: '',
  title: '',
  slug: '',
  excerpt: '',
  bodyAr: '',
  imageUrl: '',
  canonicalUrl: '',
  publisherName: 'بوابة NEMO Sports',
  categoryAr: 'الكرة المصرية',
  publishedAt: '',
  status: 'published',
  indexable: true,
  relatedMatchIds: '',
};

/**
 * محرّر خبر: إضافة أو تعديل. التعديل يستدعي مسار السجل نفسه (`/api/admin/news/{id}`)
 * فلا يُنشأ خبر مكرر، والرابط القصير (slug) يظل كما هو افتراضيًا حتى لا تتغيّر صفحة
 * منشورة ومفهرسة بلا داعٍ.
 */
export default function NewsEditor({
  mode,
  initial,
  newsId,
  canWrite,
  disabledReasonAr,
  accessNotesAr,
}: {
  mode: 'create' | 'edit';
  initial: NewsFormValues;
  newsId?: string;
  canWrite: boolean;
  disabledReasonAr?: string;
  accessNotesAr: Array<{ sourceId: string; nameAr: string; noteAr: string }>;
}) {
  const router = useRouter();
  const { busy, result, run } = useAdminAction();
  const [form, setForm] = useState<NewsFormValues>(initial);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const set = <K extends keyof NewsFormValues>(key: K, value: NewsFormValues[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const payload = () => ({
    title: form.title,
    slug: form.slug || undefined,
    excerpt: form.excerpt,
    bodyAr: form.bodyAr,
    imageUrl: form.imageUrl || null,
    canonicalUrl: form.canonicalUrl || null,
    publisherName: form.publisherName,
    categoryAr: form.categoryAr,
    publishedAt: form.publishedAt || undefined,
    status: form.status,
    indexable: form.indexable,
    relatedMatchIds: form.relatedMatchIds,
  });

  const save = () =>
    run('save', async () => {
      const response =
        mode === 'create'
          ? await adminApi<{ publicPath?: string | null }>('/api/admin/news', { method: 'POST', json: payload() })
          : await adminApi<{ publicPath?: string | null }>(`/api/admin/news/${encodeURIComponent(newsId || '')}`, {
              method: 'PATCH',
              json: payload(),
            });
      if (response.ok && response.data?.publicPath) setSavedPath(response.data.publicPath);
      if (response.ok) router.refresh();
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  return (
    <div className="kl-admin-card">
      <h2>{mode === 'create' ? 'كتابة خبر جديد' : `تعديل الخبر: ${newsId}`}</h2>
      <p className="kl-admin-note">
        خبر اللوحة لا يعتمد على أي مصدر خارجي — مسؤوليتك التحريرية، ويُنشر باسمك في سجل العمليات. لو أردت
        نصوصًا من مصدر خارجي فراجع شرط الاستخدام المعروض أسفل الصفحة قبل النسخ.
      </p>

      <div className="kl-admin-form">
        <Field label="العنوان" hint="10 أحرف على الأقل" span>
          <input value={form.title} onChange={(event) => set('title', event.target.value)} />
        </Field>
        <Field
          label="الرابط المختصر (slug)"
          hint={mode === 'edit' ? 'اتركه كما هو للحفاظ على الرابط المفهرس' : 'اتركه فارغًا ليُبنى من العنوان'}
        >
          <input value={form.slug} onChange={(event) => set('slug', event.target.value)} dir="ltr" />
        </Field>
        <Field label="التصنيف">
          <input value={form.categoryAr} onChange={(event) => set('categoryAr', event.target.value)} />
        </Field>
        <Field label="الناشر المعروض">
          <input value={form.publisherName} onChange={(event) => set('publisherName', event.target.value)} />
        </Field>
        <Field label="تاريخ النشر" hint="اتركه فارغًا لاستخدام وقت الحفظ">
          <input
            value={form.publishedAt}
            onChange={(event) => set('publishedAt', event.target.value)}
            placeholder="2026-10-14T18:00:00Z"
            dir="ltr"
          />
        </Field>
        <Field label="حالة النشر">
          <select value={form.status} onChange={(event) => set('status', event.target.value)}>
            <option value="published">منشور</option>
            <option value="pending">بانتظار المراجعة</option>
            <option value="stale">مؤرشف/قديم</option>
          </select>
        </Field>
        <Field label="صورة الخبر (رابط)">
          <input value={form.imageUrl} onChange={(event) => set('imageUrl', event.target.value)} dir="ltr" />
        </Field>
        <Field label="الرابط الأصلي/الأساسي (canonical)" hint="إن نُقل الخبر عن مصدر آخر">
          <input value={form.canonicalUrl} onChange={(event) => set('canonicalUrl', event.target.value)} dir="ltr" />
        </Field>
        <Field label="مباريات مرتبطة (معرّفات مفصولة بفواصل)">
          <input
            value={form.relatedMatchIds}
            onChange={(event) => set('relatedMatchIds', event.target.value)}
            className="kl-admin-mono"
          />
        </Field>
        <Field label="قابل للفهرسة">
          <select value={form.indexable ? '1' : '0'} onChange={(event) => set('indexable', event.target.value === '1')}>
            <option value="1">نعم (يظهر في خريطة الموقع)</option>
            <option value="0">لا (يبقى على الموقع بلا فهرسة)</option>
          </select>
        </Field>
        <Field label="الفكرة/الوصف المختصر" hint="20 حرفًا على الأقل — يُستخدم في البطاقة والبيانات الوصفية" span>
          <textarea value={form.excerpt} onChange={(event) => set('excerpt', event.target.value)} />
        </Field>
        <Field label="نص الخبر" hint="40 حرفًا على الأقل" span>
          <textarea
            value={form.bodyAr}
            onChange={(event) => set('bodyAr', event.target.value)}
            style={{ minHeight: 180 }}
          />
        </Field>
      </div>

      <div className="kl-admin-actions" style={{ marginTop: 12 }}>
        <ActionButton
          busyKey="save"
          busy={busy}
          tone="primary"
          disabled={!canWrite}
          disabledReasonAr={disabledReasonAr}
          onClick={save}
        >
          {mode === 'create' ? 'نشر الخبر' : 'حفظ التعديل على الخبر نفسه'}
        </ActionButton>
      </div>

      {savedPath ? (
        <p className="kl-admin-note kl-admin-note-ok">
          مسار الخبر العام: <a href={savedPath} target="_blank" rel="noreferrer">{savedPath}</a>
          {savedPath.includes('/pending') || form.status !== 'published'
            ? ' — الخبر غير منشور، ولن يظهر للزوار أو في خريطة الموقع حتى تنشره.'
            : ''}
        </p>
      ) : null}
      <ResultNote result={result} />

      {accessNotesAr.length > 0 ? (
        <details className="kl-admin-note" style={{ marginTop: 10 }}>
          <summary>شروط استخدام محتوى المصادر قبل النسخ</summary>
          <ul className="kl-admin-list">
            {accessNotesAr.map((note) => (
              <li key={note.sourceId}>
                <strong>{note.nameAr}:</strong> {note.noteAr}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
