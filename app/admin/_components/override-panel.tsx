'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton, Field, ResultNote, adminApi, useAdminAction } from './ui';

/**
 * أولوية البيانات: يدوي مقابل تلقائي — على مستوى السجل أو الحقل.
 *
 * القاعدة المُنفَّذة فعلًا في طبقة الدمج:
 *   1) الحقول المثبَّتة (locked) تفوز دائمًا على أي مصدر.
 *   2) «تجميد السجل كاملًا» (lockAll) يمنع أي كتابة تلقائية على هذا السجل.
 *   3) «استبعاد مصدر» يمنع مصدرًا معيّنًا عن هذه المباراة وحدها دون بقية المباريات.
 * والإعدادات محفوظة في مستند الإدارة، فتنجو من أي تحديث تلقائي لاحق.
 */
export default function OverridePanel({
  matchId,
  lockedFields,
  lockAll,
  suppressedSources,
  canWrite,
  disabledReasonAr,
  sourceIds,
  policySummaryAr,
  homeTeamNameAr,
  awayTeamNameAr,
}: {
  matchId: string;
  lockedFields: string[];
  lockAll: boolean;
  suppressedSources: string[];
  canWrite: boolean;
  disabledReasonAr?: string;
  sourceIds: string[];
  policySummaryAr: string;
  /** اسم الفريق الأول كما في السجل — يُعرض في تسمية حقل النتيجة لقطع أي لبس. */
  homeTeamNameAr?: string;
  /** اسم الفريق الثاني كما في السجل. */
  awayTeamNameAr?: string;
}) {
  const router = useRouter();
  const { busy, result, run } = useAdminAction();
  const [locked, setLocked] = useState<string[]>(lockedFields);
  const [freezeAll, setFreezeAll] = useState(lockAll);
  const [suppressed, setSuppressed] = useState<string[]>(suppressedSources);
  const [noteAr, setNoteAr] = useState('');
  const [manualValues, setManualValues] = useState({
    kickoffUtc: '',
    status: '',
    liveMinute: '',
    scoreHome: '',
    scoreAway: '',
    halfTimeHome: '',
    halfTimeAway: '',
    venue: '',
    roundLabelAr: '',
    channelAr: '',
    statusNoteAr: '',
  });

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const save = () =>
    run('override', async () => {
      const response = await adminApi(`/api/admin/matches/${encodeURIComponent(matchId)}/override`, {
        method: 'POST',
        json: {
          lockAll: freezeAll,
          locked,
          suppressedSources: suppressed,
          noteAr: noteAr || null,
          kickoffUtc: manualValues.kickoffUtc || undefined,
          status: manualValues.status || undefined,
          liveMinute: manualValues.liveMinute || null,
          scoreHome: manualValues.scoreHome === '' ? null : manualValues.scoreHome,
          scoreAway: manualValues.scoreAway === '' ? null : manualValues.scoreAway,
          halfTimeHome: manualValues.halfTimeHome === '' ? null : manualValues.halfTimeHome,
          halfTimeAway: manualValues.halfTimeAway === '' ? null : manualValues.halfTimeAway,
          venue: manualValues.venue || null,
          roundLabelAr: manualValues.roundLabelAr || null,
          channelAr: manualValues.channelAr || null,
          statusNoteAr: manualValues.statusNoteAr || null,
        },
      });
      if (response.ok) router.refresh();
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  const clear = () =>
    run('clear', async () => {
      const response = await adminApi(`/api/admin/matches/${encodeURIComponent(matchId)}/override`, {
        method: 'POST',
        json: { lockAll: false, locked: [], suppressedSources: [], noteAr: null },
      });
      if (response.ok) {
        setLocked([]);
        setFreezeAll(false);
        setSuppressed([]);
        router.refresh();
      }
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  const FIELD_LABELS: Array<{ value: string; labelAr: string }> = [
    { value: 'kickoff', labelAr: 'الموعد' },
    { value: 'status', labelAr: 'الحالة' },
    { value: 'score', labelAr: 'النتيجة' },
    { value: 'venue', labelAr: 'الملعب' },
    { value: 'teams', labelAr: 'الفريقان' },
    { value: 'competition', labelAr: 'البطولة' },
    { value: 'round', labelAr: 'الجولة' },
    { value: 'incidents', labelAr: 'الأحداث' },
  ];

  return (
    <div className="kl-admin-card">
      <h2>أولوية البيانات لهذه المباراة</h2>
      <p className="kl-admin-note">{policySummaryAr}</p>

      <h3>1) تجميد الحقول (تفوز على أي مصدر)</h3>
      <div className="kl-admin-actions">
        {FIELD_LABELS.map((field) => (
          <label key={field.value} className="kl-admin-check">
            <input
              type="checkbox"
              checked={locked.includes(field.value)}
              onChange={() => setLocked((current) => toggle(current, field.value))}
            />
            {field.labelAr}
          </label>
        ))}
      </div>

      <h3>2) القيم اليدوية المراد تثبيتها</h3>
      <div className="kl-admin-form">
        <Field label="الموعد (UTC)" hint="اتركه فارغًا إن لم ترغب بتغيير الموعد">
          <input
            value={manualValues.kickoffUtc}
            onChange={(event) => setManualValues((c) => ({ ...c, kickoffUtc: event.target.value }))}
            dir="ltr"
            placeholder="2026-10-20T17:00:00Z"
          />
        </Field>
        <Field label="الحالة">
          <select
            value={manualValues.status}
            onChange={(event) => setManualValues((c) => ({ ...c, status: event.target.value }))}
          >
            <option value="">— بلا تغيير —</option>
            <option value="scheduled">لم تبدأ</option>
            <option value="live">مباشر الآن</option>
            <option value="break">بين الشوطين</option>
            <option value="finished">منتهية</option>
            <option value="postponed">مؤجّلة</option>
            <option value="cancelled">ملغاة</option>
            <option value="suspended">موقوفة</option>
          </select>
        </Field>
        <Field label="الدقيقة الحالية (للمباشر)">
          <input
            value={manualValues.liveMinute}
            onChange={(event) => setManualValues((c) => ({ ...c, liveMinute: event.target.value }))}
            inputMode="numeric"
          />
        </Field>
        <Field label={`نتيجة الفريق الأول${homeTeamNameAr ? ` (${homeTeamNameAr})` : ''}`} hint="تُثبَّت على المفاتيح score.home/score.away كما هي — بلا أي إعادة ترتيب">
          <input
            value={manualValues.scoreHome}
            onChange={(event) => setManualValues((c) => ({ ...c, scoreHome: event.target.value }))}
            inputMode="numeric"
          />
        </Field>
        <Field label={`نتيجة الفريق الثاني${awayTeamNameAr ? ` (${awayTeamNameAr})` : ''}`}>
          <input
            value={manualValues.scoreAway}
            onChange={(event) => setManualValues((c) => ({ ...c, scoreAway: event.target.value }))}
            inputMode="numeric"
          />
        </Field>
        <Field label="شوط أول — الأول">
          <input
            value={manualValues.halfTimeHome}
            onChange={(event) => setManualValues((c) => ({ ...c, halfTimeHome: event.target.value }))}
            inputMode="numeric"
          />
        </Field>
        <Field label="شوط أول — الثاني">
          <input
            value={manualValues.halfTimeAway}
            onChange={(event) => setManualValues((c) => ({ ...c, halfTimeAway: event.target.value }))}
            inputMode="numeric"
          />
        </Field>
        <Field label="الملعب">
          <input
            value={manualValues.venue}
            onChange={(event) => setManualValues((c) => ({ ...c, venue: event.target.value }))}
          />
        </Field>
        <Field label="الجولة">
          <input
            value={manualValues.roundLabelAr}
            onChange={(event) => setManualValues((c) => ({ ...c, roundLabelAr: event.target.value }))}
          />
        </Field>
        <Field label="القناة">
          <input
            value={manualValues.channelAr}
            onChange={(event) => setManualValues((c) => ({ ...c, channelAr: event.target.value }))}
          />
        </Field>
        <Field label="ملاحظة تُعرض مع الحالة">
          <input
            value={manualValues.statusNoteAr}
            onChange={(event) => setManualValues((c) => ({ ...c, statusNoteAr: event.target.value }))}
          />
        </Field>
      </div>

      <h3>3) تجميد السجل بالكامل</h3>
      <label className="kl-admin-check">
        <input type="checkbox" checked={freezeAll} onChange={() => setFreezeAll((value) => !value)} />
        لا تُحدَّث هذه المباراة تلقائيًا إطلاقًا (بقية المباريات تُحدَّث عادي)
      </label>

      <h3>4) استبعاد مصادر من هذه المباراة</h3>
      <div className="kl-admin-actions">
        {sourceIds.map((sourceId) => (
          <label key={sourceId} className="kl-admin-check">
            <input
              type="checkbox"
              checked={suppressed.includes(sourceId)}
              onChange={() => setSuppressed((current) => toggle(current, sourceId))}
            />
            {sourceId}
          </label>
        ))}
      </div>

      <Field label="ملاحظة إدارية على سبب التثبيت (تُسجَّل في سجل العمليات)">
        <input value={noteAr} onChange={(event) => setNoteAr(event.target.value)} />
      </Field>

      <div className="kl-admin-actions" style={{ marginTop: 12 }}>
        <ActionButton
          busyKey="override"
          busy={busy}
          tone="primary"
          disabled={!canWrite}
          disabledReasonAr={disabledReasonAr}
          onClick={save}
        >
          حفظ سياسة الأولوية
        </ActionButton>
        <ActionButton
          busyKey="clear"
          busy={busy}
          disabled={!canWrite}
          disabledReasonAr={disabledReasonAr}
          confirmAr="إزالة كل التثبيتات عن هذه المباراة؟ ستعود بياناتها للمصادر التلقائية."
          onClick={clear}
        >
          إزالة التثبيت (عودة التحكم للمصادر)
        </ActionButton>
      </div>

      <ResultNote result={result} />
    </div>
  );
}
