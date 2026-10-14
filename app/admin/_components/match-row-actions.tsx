'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton, ResultNote, adminApi, useAdminAction } from './ui';

/**
 * إجراءات السجل الواحد من القائمة: تحديث الصفحات العامة فورًا، أو حذف السجل اليدوي
 * بتأكيد مكتوب. «إعادة التحقق» تنادي الخادم فعلًا وتعيد قائمة المسارات التي حُدِّثت،
 * فلا ندّعي تحديثًا لم يحدث.
 */
export default function MatchRowActions({
  matchId,
  canWrite,
  disabledReasonAr,
  isManual,
}: {
  matchId: string;
  canWrite: boolean;
  disabledReasonAr?: string;
  isManual: boolean;
}) {
  const router = useRouter();
  const { busy, result, run } = useAdminAction();
  const [revalidatedPaths, setRevalidatedPaths] = useState<string[] | null>(null);

  const revalidate = () =>
    run('revalidate', async () => {
      const response = await adminApi<{ paths?: string[] }>(
        `/api/admin/matches/${encodeURIComponent(matchId)}/revalidate`,
        { method: 'POST' }
      );
      setRevalidatedPaths(response.data?.paths ?? null);
      router.refresh();
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  const remove = () =>
    run('delete', async () => {
      const response = await adminApi(
        `/api/admin/matches/${encodeURIComponent(matchId)}?confirmation=${encodeURIComponent(matchId)}`,
        { method: 'DELETE' }
      );
      if (response.ok) router.refresh();
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  return (
    <div>
      <div className="kl-admin-row-actions">
        <a href={`/admin/matches/${encodeURIComponent(matchId)}`}>تعديل</a>
        <ActionButton busyKey="revalidate" busy={busy} onClick={revalidate}>
          نشر التحديث
        </ActionButton>
        {isManual ? (
          <ActionButton
            busyKey="delete"
            busy={busy}
            tone="danger"
            disabled={!canWrite}
            disabledReasonAr={disabledReasonAr}
            confirmAr={`حذف السجل اليدوي «${matchId}» نهائيًا من الموقع؟`}
            onClick={remove}
          >
            حذف
          </ActionButton>
        ) : null}
      </div>
      {revalidatedPaths ? (
        <p className="kl-admin-note kl-admin-note-ok" style={{ marginTop: 6 }}>
          أُعيد التحقق من: <span className="kl-admin-mono">{revalidatedPaths.join(' , ')}</span>
        </p>
      ) : null}
      <ResultNote result={result} />
    </div>
  );
}
