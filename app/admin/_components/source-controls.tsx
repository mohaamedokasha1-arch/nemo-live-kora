'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton, Field, ResultNote, adminApi, useAdminAction } from './ui';

export interface SourceControlRow {
  id: string;
  nameAr: string;
  enabled: boolean;
  priority: number;
  noteAr: string | null;
  isKeyConfigured: boolean;
  requiresKey: boolean;
  keyEnvVar: string | null;
}

/**
 * تحكّم مصدر واحد:
 *  • تفعيل/تعطيل **دون حذف الإعدادات** (التعطيل يمنع النداء فقط، وكل شيء محفوظ).
 *  • ترتيب الأولوية (1–99) الذي يحدّد من يُجرَّب أولًا ومن يكون احتياطيًا.
 *  • إعادة محاولة حقيقية تُنادي المصدر الآن وتعيد نتيجته من الخادم بالحرف.
 * كل زر هنا موصول بمسار API ينفّذ فعلًا؛ ولا يوجد زر «تجريبي» بلا نتيجة.
 */
export default function SourceControls({
  source,
  canWrite,
  canRun,
  disabledReasonAr,
  storageDurable,
}: {
  source: SourceControlRow;
  canWrite: boolean;
  canRun: boolean;
  disabledReasonAr?: string;
  storageDurable: boolean;
}) {
  const router = useRouter();
  const { busy, result, run } = useAdminAction();
  const [priority, setPriority] = useState(String(source.priority || ''));
  const [noteAr, setNoteAr] = useState(source.noteAr || '');

  const patch = (payload: { enabled?: boolean; priority?: string; noteAr?: string | null }, key: string) =>
    run(key, async () => {
      const response = await adminApi(`/api/admin/sources/${encodeURIComponent(source.id)}`, {
        method: 'PATCH',
        json: payload,
      });
      if (response.ok) router.refresh();
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  const retry = () =>
    run('retry', async () => {
      const response = await adminApi<{
        lastGoodDataAt?: string | null;
        result?: {
          status?: string;
          httpStatus?: number | null;
          latencyMs?: number;
          matchesFetched?: number;
          newsFetched?: number;
          standingsFetched?: number;
          usedCachedSnapshot?: boolean;
        } | null;
      }>(`/api/admin/sources/${encodeURIComponent(source.id)}`, { method: 'POST' });
      router.refresh();
      const result = response.data?.result ?? null;
      const extra = result
        ? [
            `الحالة: ${result.status ?? '—'} · HTTP ${result.httpStatus ?? '—'} · زمن الاستجابة ${result.latencyMs ?? 0} م.ث`,
            `جُلبت: مباريات ${result.matchesFetched ?? 0} · أخبار ${result.newsFetched ?? 0} · ترتيب ${
              result.standingsFetched ?? 0
            }${result.usedCachedSnapshot ? ' (من آخر لقطة محفوظة)' : ''}`,
            `آخر بيانات صحيحة محفوظة من هذا المصدر: ${response.data?.lastGoodDataAt ?? 'لا يوجد'}`,
          ]
        : [];
      return {
        ok: response.ok,
        messageAr: response.messageAr,
        warningsAr: [...(response.warningsAr || []), ...extra],
      };
    });

  return (
    <div className="kl-admin-card">
      <div className="kl-admin-head">
        <h3 style={{ margin: 0 }}>
          {source.nameAr} <span className="kl-admin-mono">{source.id}</span>
        </h3>
        <span className="kl-admin-identity">
          {source.enabled ? 'مفعّل' : 'معطّل'} · الترتيب {source.priority || '—'}
          {source.requiresKey ? (source.isKeyConfigured ? ' · المفتاح مضبوط' : ' · المفتاح غير مضبوط') : ''}
        </span>
      </div>

      {!storageDurable ? (
        <p className="kl-admin-note kl-admin-note-warn">
          التحكم بالمصادر يحتاج تخزينًا دائمًا ليُحفظ؛ على هذه البيئة سيُرفض الحفظ حتى يُضبط.
        </p>
      ) : null}

      <div className="kl-admin-form">
        <Field label="الترتيب (1 = يُجرَّب أولًا)">
          <input value={priority} onChange={(event) => setPriority(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="ملاحظة تشغيلية (اختيارية)">
          <input value={noteAr} onChange={(event) => setNoteAr(event.target.value)} />
        </Field>
      </div>

      <div className="kl-admin-actions" style={{ marginTop: 10 }}>
        <ActionButton
          busyKey="priority"
          busy={busy}
          disabled={!canWrite || !storageDurable}
          disabledReasonAr={disabledReasonAr}
          onClick={() => patch({ priority, noteAr: noteAr || null }, 'priority')}
        >
          حفظ الترتيب والملاحظة
        </ActionButton>
        <ActionButton
          busyKey="toggle"
          busy={busy}
          tone={source.enabled ? 'danger' : 'primary'}
          disabled={!canWrite || !storageDurable}
          disabledReasonAr={disabledReasonAr}
          confirmAr={
            source.enabled
              ? `تعطيل ${source.id}؟ لن تُجلب منه بيانات جديدة، لكن إعداداته وبياناته السابقة تبقى كما هي.`
              : undefined
          }
          onClick={() => patch({ enabled: !source.enabled }, 'toggle')}
        >
          {source.enabled ? 'تعطيل المؤقت (مع حفظ الإعدادات)' : 'إعادة التفعيل'}
        </ActionButton>
        <ActionButton
          busyKey="retry"
          busy={busy}
          disabled={!canRun}
          disabledReasonAr={
            source.enabled ? 'دورك لا يملك صلاحية تشغيل المزامنة.' : 'المصدر معطّل — فعّله أولًا.'
          }
          onClick={retry}
        >
          إعادة محاولة الآن
        </ActionButton>
        <a className="kl-admin-btn" href={`/admin/sources/${encodeURIComponent(source.id)}`}>
          صفحة المصدر
        </a>
      </div>

      <ResultNote result={result} />
    </div>
  );
}
