'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton, Field, ResultNote, adminApi, useAdminAction } from './ui';

export interface MatchFormValues {
  id: string;
  status: string;
  kickoffUtc: string;
  timezone: string;
  kickoffConfirmed: boolean;
  homeNameAr: string;
  homeNameEn: string;
  homeLogoUrl: string;
  awayNameAr: string;
  awayNameEn: string;
  awayLogoUrl: string;
  competitionCode: string;
  competitionNameAr: string;
  competitionCountryAr: string;
  region: string;
  seasonLabel: string;
  roundLabelAr: string;
  venue: string;
  cityAr: string;
  scoreHome: string;
  scoreAway: string;
  halfTimeHome: string;
  halfTimeAway: string;
  statusNoteAr: string;
  liveMinute: string;
  channelAr: string;
  broadcastStatus: string;
  broadcastUrl: string;
  broadcastNotesAr: string;
  keywords: string;
  indexable: boolean;
  incidentsJson: string;
}

export const EMPTY_MATCH_FORM: MatchFormValues = {
  id: '',
  status: 'scheduled',
  kickoffUtc: '',
  timezone: 'Africa/Cairo',
  kickoffConfirmed: true,
  homeNameAr: '',
  homeNameEn: '',
  homeLogoUrl: '',
  awayNameAr: '',
  awayNameEn: '',
  awayLogoUrl: '',
  competitionCode: 'egyptian-premier-league',
  competitionNameAr: 'الدوري المصري الممتاز',
  competitionCountryAr: 'مصر',
  region: 'africa',
  seasonLabel: '',
  roundLabelAr: '',
  venue: '',
  cityAr: '',
  scoreHome: '',
  scoreAway: '',
  halfTimeHome: '',
  halfTimeAway: '',
  statusNoteAr: '',
  liveMinute: '',
  channelAr: '',
  broadcastStatus: 'live',
  broadcastUrl: '',
  broadcastNotesAr: '',
  keywords: '',
  indexable: true,
  incidentsJson: '',
};

const STATUS_OPTIONS: Array<{ value: string; labelAr: string }> = [
  { value: 'scheduled', labelAr: 'لم تبدأ' },
  { value: 'live', labelAr: 'مباشر الآن' },
  { value: 'break', labelAr: 'بين الشوطين (استراحة)' },
  { value: 'finished', labelAr: 'منتهية' },
  { value: 'postponed', labelAr: 'مؤجّلة' },
  { value: 'cancelled', labelAr: 'ملغاة' },
  { value: 'suspended', labelAr: 'موقوفة' },
];

/**
 * نموذج المباراة: يُستخدم للإضافة وللتعديل بالشكل نفسه.
 *  • في وضع التعديل، الحفظ يمرّ على `/api/admin/matches/{id}` (تحديث سجل قائم) لا
 *    على مسار الإنشاء — فلا تُنشأ نسخة مكررة أبدًا.
 *  • زر «فحص التكرار» ينفّذ فحصًا حقيقيًا على الخادم (`dryRun`) قبل أي كتابة.
 *  • الحقول المتروكة فارغة تُهمَل ولا تمسح قيمًا موجودة.
 */
export default function MatchForm({
  mode,
  initial,
  matchId,
  canWrite,
  disabledReasonAr,
  competitionOptions,
}: {
  mode: 'create' | 'edit';
  initial: MatchFormValues;
  matchId?: string;
  canWrite: boolean;
  disabledReasonAr?: string;
  competitionOptions: Array<{ code: string; nameAr: string; seasonLabel: string }>;
}) {
  const router = useRouter();
  const { busy, result, run, setResult } = useAdminAction();
  const [form, setForm] = useState<MatchFormValues>(initial);
  const [dryRunInfo, setDryRunInfo] = useState<string | null>(null);

  const set = <K extends keyof MatchFormValues>(key: K, value: MatchFormValues[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const payload = useMemo(
    () => ({
      id: form.id || undefined,
      status: form.status,
      kickoffUtc: form.kickoffUtc || undefined,
      timezone: form.timezone || undefined,
      kickoffConfirmed: form.kickoffConfirmed,
      homeNameAr: form.homeNameAr || undefined,
      homeNameEn: form.homeNameEn || undefined,
      homeLogoUrl: form.homeLogoUrl || null,
      awayNameAr: form.awayNameAr || undefined,
      awayNameEn: form.awayNameEn || undefined,
      awayLogoUrl: form.awayLogoUrl || null,
      competitionCode: form.competitionCode || undefined,
      competitionNameAr: form.competitionNameAr || undefined,
      competitionCountryAr: form.competitionCountryAr || undefined,
      region: form.region || undefined,
      seasonLabel: form.seasonLabel || undefined,
      roundLabelAr: form.roundLabelAr || null,
      venue: form.venue || null,
      cityAr: form.cityAr || null,
      scoreHome: form.scoreHome === '' ? null : form.scoreHome,
      scoreAway: form.scoreAway === '' ? null : form.scoreAway,
      halfTimeHome: form.halfTimeHome === '' ? null : form.halfTimeHome,
      halfTimeAway: form.halfTimeAway === '' ? null : form.halfTimeAway,
      statusNoteAr: form.statusNoteAr || null,
      liveMinute: form.liveMinute === '' ? null : form.liveMinute,
      channelAr: form.channelAr || null,
      broadcastStatus: form.broadcastStatus || undefined,
      broadcastUrl: form.broadcastUrl || null,
      broadcastNotesAr: form.broadcastNotesAr || null,
      keywords: form.keywords || undefined,
      indexable: form.indexable,
      incidentsJson: form.incidentsJson || undefined,
    }),
    [form]
  );

  const checkDuplicates = () =>
    run('dry-run', async () => {
      const response = await adminApi<{ duplicateOf?: { id: string; landingPath: string | null } | null; messageAr?: string }>(
        '/api/admin/matches',
        { method: 'POST', json: { ...payload, dryRun: true } }
      );
      const duplicate = response.data?.duplicateOf ?? null;
      setDryRunInfo(
        duplicate
          ? `تحذير: يوجد سجل مطابق (${duplicate.id})${duplicate.landingPath ? ` على المسار ${duplicate.landingPath}` : ''} — عدّله بدل إنشاء نسخة ثانية.`
          : response.messageAr || 'لا يوجد تعارض: يمكن الحفظ.'
      );
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  const save = () =>
    run('save', async () => {
      const response =
        mode === 'create'
          ? await adminApi<{ publicPath?: string | null }>('/api/admin/matches', { method: 'POST', json: payload })
          : await adminApi<{ publicPath?: string | null }>(`/api/admin/matches/${encodeURIComponent(matchId || '')}`, {
              method: 'PATCH',
              json: { ...payload, confirmation: matchId },
            });
      if (response.ok) router.refresh();
      return {
        ok: response.ok,
        messageAr: response.messageAr,
        warningsAr: response.data?.publicPath ? [`العنوان العام للسجل: ${response.data.publicPath}`] : response.warningsAr,
      };
    });

  return (
    <div className="kl-admin-card">
      <h2>{mode === 'create' ? 'إضافة مباراة يدويًا' : `تعديل المباراة: ${matchId}`}</h2>
      <p className="kl-admin-note">
        الإدخال اليدوي يعني أن الصفحة العامة تعرض هذه القيم، ومحرّك المزامنة لن يمحوها (طبقة الأولوية أدناه).
        {mode === 'edit' ? ' الحفظ هنا يُحدِّث السجل نفسه — لا يُنشئ سجلًا جديدًا.' : ''}
      </p>

      <div className="kl-admin-form">
        <Field label="المعرّف (id)" hint="اتركه فارغًا ليُبنى تلقائيًا من الفريقين والتاريخ">
          <input value={form.id} onChange={(event) => set('id', event.target.value)} disabled={mode === 'edit'} />
        </Field>
        <Field label="الحالة">
          <select value={form.status} onChange={(event) => set('status', event.target.value)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.labelAr}
              </option>
            ))}
          </select>
        </Field>
        <Field label="وقت الانطلاق (UTC)" hint="مثال: 2026-10-20T17:00:00Z">
          <input
            value={form.kickoffUtc}
            onChange={(event) => set('kickoffUtc', event.target.value)}
            className="kl-admin-mono"
            placeholder="2026-10-20T17:00:00Z"
          />
        </Field>
        <Field label="المنطقة الزمنية" hint="تُستخدم للعرض وللتاريخ المحلي">
          <input value={form.timezone} onChange={(event) => set('timezone', event.target.value)} />
        </Field>
        <Field label="التوقيت مؤكَّد؟">
          <select
            value={form.kickoffConfirmed ? '1' : '0'}
            onChange={(event) => set('kickoffConfirmed', event.target.value === '1')}
          >
            <option value="1">مؤكَّد</option>
            <option value="0">غير مؤكَّد</option>
          </select>
        </Field>
        <Field label="البطولة">
          <select
            value={form.competitionCode}
            onChange={(event) => {
              const code = event.target.value;
              const found = competitionOptions.find((option) => option.code === code);
              set('competitionCode', code);
              if (found) {
                set('competitionNameAr', found.nameAr);
                if (!form.seasonLabel) set('seasonLabel', found.seasonLabel);
              }
            }}
          >
            {competitionOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.nameAr}
              </option>
            ))}
            {competitionOptions.every((option) => option.code !== form.competitionCode) ? (
              <option value={form.competitionCode}>{form.competitionNameAr || form.competitionCode}</option>
            ) : null}
          </select>
        </Field>
        <Field label="اسم البطولة بالعربية">
          <input value={form.competitionNameAr} onChange={(event) => set('competitionNameAr', event.target.value)} />
        </Field>
        <Field label="بلد البطولة">
          <input value={form.competitionCountryAr} onChange={(event) => set('competitionCountryAr', event.target.value)} />
        </Field>
        <Field label="المنطقة" hint="africa / arab / europe / world">
          <select value={form.region} onChange={(event) => set('region', event.target.value)}>
            <option value="africa">أفريقيا</option>
            <option value="arab">عربي</option>
            <option value="europe">أوروبا</option>
            <option value="world">عالمي</option>
          </select>
        </Field>
        <Field label="الموسم" hint="مثال: 2026 أو 2026-2027">
          <input value={form.seasonLabel} onChange={(event) => set('seasonLabel', event.target.value)} />
        </Field>
        <Field label="الجولة/الدور">
          <input value={form.roundLabelAr} onChange={(event) => set('roundLabelAr', event.target.value)} />
        </Field>

        <Field label="الفريق الأول (عربي)">
          <input value={form.homeNameAr} onChange={(event) => set('homeNameAr', event.target.value)} />
        </Field>
        <Field label="الفريق الأول (إنجليزي)" hint="يُستخدم في بناء المعرّف">
          <input value={form.homeNameEn} onChange={(event) => set('homeNameEn', event.target.value)} />
        </Field>
        <Field label="شعار الفريق الأول (رابط)">
          <input value={form.homeLogoUrl} onChange={(event) => set('homeLogoUrl', event.target.value)} dir="ltr" />
        </Field>
        <Field label="الفريق الثاني (عربي)">
          <input value={form.awayNameAr} onChange={(event) => set('awayNameAr', event.target.value)} />
        </Field>
        <Field label="الفريق الثاني (إنجليزي)">
          <input value={form.awayNameEn} onChange={(event) => set('awayNameEn', event.target.value)} />
        </Field>
        <Field label="شعار الفريق الثاني (رابط)">
          <input value={form.awayLogoUrl} onChange={(event) => set('awayLogoUrl', event.target.value)} dir="ltr" />
        </Field>

        <Field label="النتيجة — الفريق الأول" hint="اتركه فارغًا إن لم تبدأ">
          <input value={form.scoreHome} onChange={(event) => set('scoreHome', event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="النتيجة — الفريق الثاني">
          <input value={form.scoreAway} onChange={(event) => set('scoreAway', event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="نتيجة الشوط الأول — الأول">
          <input value={form.halfTimeHome} onChange={(event) => set('halfTimeHome', event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="نتيجة الشوط الأول — الثاني">
          <input value={form.halfTimeAway} onChange={(event) => set('halfTimeAway', event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="الملعب">
          <input value={form.venue} onChange={(event) => set('venue', event.target.value)} />
        </Field>
        <Field label="المدينة">
          <input value={form.cityAr} onChange={(event) => set('cityAr', event.target.value)} />
        </Field>
        <Field label="ملاحظة الحالة" hint="تُعرض بجانب الحالة (مثال: تأجيل بسبب الأمطار)">
          <input value={form.statusNoteAr} onChange={(event) => set('statusNoteAr', event.target.value)} />
        </Field>
        <Field label="الدقيقة الحالية (للمباشر)" hint="تظهر في صفحة المباراة عندما تكون الحالة «مباشر الآن» أو «بين الشوطين»">
          <input value={form.liveMinute} onChange={(event) => set('liveMinute', event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="القناة الناقلة (نص)">
          <input value={form.channelAr} onChange={(event) => set('channelAr', event.target.value)} />
        </Field>
        <Field label="حالة البث">
          <select value={form.broadcastStatus} onChange={(event) => set('broadcastStatus', event.target.value)}>
            <option value="live">بث متاح</option>
            <option value="upcoming">لم يبدأ</option>
            <option value="finished">انتهى</option>
            <option value="unknown">غير معروف</option>
          </select>
        </Field>
        <Field label="رابط المشاهدة" hint="اتركه فارغًا لاستخدام رابط المشاهدة الموحّد في الموقع">
          <input value={form.broadcastUrl} onChange={(event) => set('broadcastUrl', event.target.value)} dir="ltr" />
        </Field>
        <Field label="ملاحظات المشاهدة">
          <input value={form.broadcastNotesAr} onChange={(event) => set('broadcastNotesAr', event.target.value)} />
        </Field>
        <Field label="كلمات مفتاحية" hint="مفصولة بفواصل">
          <input value={form.keywords} onChange={(event) => set('keywords', event.target.value)} />
        </Field>
        <Field label="قابلة للفهرسة في محركات البحث">
          <select value={form.indexable ? '1' : '0'} onChange={(event) => set('indexable', event.target.value === '1')}>
            <option value="1">نعم (الافتراضي)</option>
            <option value="0">لا — تُمنع الفهرسة لهذا السجل فقط</option>
          </select>
        </Field>
        <Field label="الأحداث (JSON)" hint="أهداف/بطاقات — الشكل: [{minute,type,side,player,detail}]" span>
          <textarea value={form.incidentsJson} onChange={(event) => set('incidentsJson', event.target.value)} dir="ltr" />
        </Field>
      </div>

      <div className="kl-admin-actions" style={{ marginTop: 12 }}>
        <ActionButton
          busyKey="dry-run"
          busy={busy}
          onClick={checkDuplicates}
          disabled={!form.homeNameAr || !form.awayNameAr}
          disabledReasonAr="أدخل الفريقين أولًا لفحص التكرار."
        >
          فحص التكرار (بلا كتابة)
        </ActionButton>
        <ActionButton
          busyKey="save"
          busy={busy}
          tone="primary"
          disabled={!canWrite}
          disabledReasonAr={disabledReasonAr}
          onClick={save}
        >
          {mode === 'create' ? 'حفظ وإضافة للموقع' : 'حفظ التعديل على السجل نفسه'}
        </ActionButton>
        <button type="button" className="kl-admin-btn" onClick={() => setResult(null)}>
          مسح الرسائل
        </button>
      </div>

      {dryRunInfo ? <p className="kl-admin-note kl-admin-note-warn">{dryRunInfo}</p> : null}
      <ResultNote result={result} />
    </div>
  );
}
