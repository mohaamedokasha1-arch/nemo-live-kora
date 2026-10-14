'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton, ResultNote, adminApi, useAdminAction } from './ui';

/** إجراءات سريعة على الخبر: نشر/إخفاء، وأرشفة، وحذف بتأكيد. */
export default function NewsRowActions({
  newsId,
  isManual,
  status,
  canWrite,
  disabledReasonAr,
}: {
  newsId: string;
  isManual: boolean;
  status: string;
  canWrite: boolean;
  disabledReasonAr?: string;
}) {
  const router = useRouter();
  const { busy, result, run } = useAdminAction();

  const setStatus = (next: string) =>
    run(`status-${next}`, async () => {
      const response = await adminApi(`/api/admin/news/${encodeURIComponent(newsId)}`, {
        method: 'PATCH',
        json: { status: next },
      });
      if (response.ok) router.refresh();
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  const remove = () =>
    run('delete', async () => {
      const response = await adminApi(
        `/api/admin/news/${encodeURIComponent(newsId)}?confirmation=${encodeURIComponent(newsId)}`,
        { method: 'DELETE' }
      );
      if (response.ok) router.refresh();
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  return (
    <div>
      <div className="kl-admin-row-actions">
        {isManual ? <a href={`/admin/news/manage/${encodeURIComponent(newsId)}`}>تعديل</a> : null}
        {status === 'published' ? (
          <ActionButton
            busyKey="status-pending"
            busy={busy}
            disabled={!canWrite}
            disabledReasonAr={disabledReasonAr}
            onClick={() => setStatus('pending')}
          >
            إخفاء (إرجاع للمراجعة)
          </ActionButton>
        ) : (
          <ActionButton
            busyKey="status-published"
            busy={busy}
            disabled={!canWrite}
            disabledReasonAr={disabledReasonAr}
            onClick={() => setStatus('published')}
          >
            نشر
          </ActionButton>
        )}
        {isManual ? (
          <ActionButton
            busyKey="delete"
            busy={busy}
            tone="danger"
            disabled={!canWrite}
            disabledReasonAr={disabledReasonAr}
            confirmAr={`حذف الخبر «${newsId}» نهائيًا؟ سيتوقف مساره العام عن العمل.`}
            onClick={remove}
          >
            حذف
          </ActionButton>
        ) : null}
      </div>
      <ResultNote result={result} />
    </div>
  );
}
