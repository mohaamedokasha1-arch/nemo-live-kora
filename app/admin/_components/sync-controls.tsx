'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton, ResultNote, adminApi, useAdminAction } from './ui';

interface SyncSourceOutcome {
  sourceId: string;
  ok: boolean;
  latencyMs: number | null;
  fetched: number | null;
  fromCache: boolean;
  messageAr: string;
  httpStatus: number | null;
}

interface SyncResponseAr {
  messageAr?: string;
  job?: string;
  durationMs?: number;
  sources?: SyncSourceOutcome[];
  totalMatchesInStore?: number;
  news?: { fetched?: number; published?: number };
  storageRoundTripOk?: boolean;
  warningsAr?: string[];
}

/**
 * تشغيل المزامنة يدويًا: زر حقيقي ينادي `/api/admin/sync` وينفّذ نفس محرّك المزامنة
 * المستخدم في الكرون. لا يوجد «تشغيل تجريبي» يُظهر نجاحًا وهميًا: النتيجة المعروضة هي
 * نتيجة كل مصدر بالحرف — بما في ذلك فشله.
 */
export default function SyncControls({
  canRun,
  disabledReasonAr,
  compact,
}: {
  canRun: boolean;
  disabledReasonAr?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const { busy, result, run } = useAdminAction();
  const [details, setDetails] = useState<SyncResponseAr | null>(null);
  const [job, setJob] = useState<'full' | 'matches' | 'news'>('full');

  const execute = (target: 'full' | 'matches' | 'news') => {
    if (!canRun) return;
    setJob(target);
    void run(target, async () => {
      const response = await adminApi<SyncResponseAr>('/api/admin/sync', { method: 'POST', json: { job: target } });
      setDetails(response.data ?? null);
      router.refresh();
      return {
        ok: response.ok,
        messageAr: response.messageAr,
        warningsAr: response.warningsAr,
      };
    });
  };

  return (
    <div className="kl-admin-card">
      <div className="kl-admin-head">
        <h2>{compact ? 'تشغيل تحديث الآن' : 'التحكم في التحديث التلقائي وإعادة المحاولة'}</h2>
        <div className="kl-admin-actions">
          <label className="kl-admin-check">
            <input
              type="radio"
              name="sync-job"
              checked={job === 'full'}
              onChange={() => setJob('full')}
              disabled={busy !== null}
            />
            مباريات + أخبار
          </label>
          <label className="kl-admin-check">
            <input
              type="radio"
              name="sync-job"
              checked={job === 'matches'}
              onChange={() => setJob('matches')}
              disabled={busy !== null}
            />
            مباريات فقط
          </label>
          <label className="kl-admin-check">
            <input type="radio" name="sync-job" checked={job === 'news'} onChange={() => setJob('news')} disabled={busy !== null} />
            أخبار فقط
          </label>
        </div>
      </div>

      <p className="kl-admin-note">
        التشغيل اليدوي ينفّذ فعلًا نداءات الشبكة إلى المصادر المفعّلة فقط، ويكتب النتيجة في المخزن. المصادر
        المعطّلة من اللوحة لا تُنادى إطلاقًا.
      </p>

      <div className="kl-admin-actions">
        <ActionButton
          busyKey={`sync-${job}`}
          busy={busy}
          disabled={!canRun}
          disabledReasonAr={disabledReasonAr}
          tone="primary"
          onClick={() => execute(job)}
        >
          تشغيل الآن ({job === 'full' ? 'مباريات + أخبار' : job === 'matches' ? 'مباريات' : 'أخبار'})
        </ActionButton>
      </div>

      <ResultNote result={result} />

      {details && details.sources && details.sources.length > 0 ? (
        <>
          <h3>نتيجة كل مصدر في هذه المحاولة</h3>
          <div className="kl-admin-table-wrap">
            <table className="kl-admin-table">
              <thead>
                <tr>
                  <th>المصدر</th>
                  <th>النتيجة</th>
                  <th>زمن الاستجابة</th>
                  <th>عدد السجلات</th>
                  <th>الرسالة</th>
                </tr>
              </thead>
              <tbody>
                {details.sources.map((source) => (
                  <tr key={source.sourceId}>
                    <td>{source.sourceId}</td>
                    <td>{source.ok ? 'نجح' : 'فشل'}</td>
                    <td>{source.latencyMs === null ? '—' : `${source.latencyMs} م.ث`}</td>
                    <td>{source.fromCache ? 'من آخر لقطة محفوظة' : (source.fetched ?? '—')}</td>
                    <td>{source.messageAr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {details ? (
        <p className="kl-admin-note">
          مدة العملية: {Math.round((details.durationMs ?? 0) / 100) / 10} ثانية · المباريات في المخزن بعد التشغيل:{' '}
          {details.totalMatchesInStore ?? '—'}
          {typeof details.storageRoundTripOk === 'boolean'
            ? ` · اختبار قراءة/كتابة التخزين: ${details.storageRoundTripOk ? 'سليم' : 'فشل'}`
            : ''}
          {details.news ? ` · الأخبار: جُلب ${details.news.fetched ?? 0} ونُشر ${details.news.published ?? 0}` : ''}
          {details.messageAr ? ` · ${details.messageAr}` : ''}
        </p>
      ) : null}
    </div>
  );
}
