'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton, Field, ResultNote, adminApi, useAdminAction } from './ui';

/**
 * البطولات: تعديل الترتيب/الموسم/الاسم/الشعار لموسم قادم، بلا حذف أي بطولة.
 * الفرق: إضافة فريق يدوي (لعبة/دوري عربي/عالمي) يمكن استخدامه في المباريات اليدوية،
 * وحذف فريق أضافه المدير فقط — فرق المصادر لا تُحذف من هنا.
 */
export default function CompetitionControls({
  row,
  canWrite,
  disabledReasonAr,
}: {
  row: {
    code: string;
    nameAr: string;
    nameEn: string;
    countryAr: string;
    seasonLabel: string;
    priority: number;
    matchesInStore: number;
    manualMatches: number;
    hasOverride: boolean;
    noteAr: string | null;
    nemoCompetitionSlug: string | null;
    logoUrl: string | null;
  };
  canWrite: boolean;
  disabledReasonAr?: string;
}) {
  const router = useRouter();
  const { busy, result, run } = useAdminAction();
  const [priority, setPriority] = useState(String(row.priority));
  const [season, setSeason] = useState(row.seasonLabel);
  const [nameAr, setNameAr] = useState(row.nameAr);
  const [nameEn, setNameEn] = useState(row.nameEn);
  const [logoUrl, setLogoUrl] = useState(row.logoUrl || '');
  const [nemoSlug, setNemoSlug] = useState(row.nemoCompetitionSlug || '');
  const [noteAr, setNoteAr] = useState(row.noteAr || '');

  const save = () =>
    run('save', async () => {
      const response = await adminApi('/api/admin/competitions', {
        method: 'PUT',
        json: {
          code: row.code,
          priority,
          currentSeason: season,
          nameAr,
          nameEn,
          logoUrl: logoUrl || null,
          nemoCompetitionSlug: nemoSlug || null,
          noteAr: noteAr || null,
        },
      });
      if (response.ok) router.refresh();
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  return (
    <details className="kl-admin-card">
      <summary style={{ cursor: 'pointer', fontWeight: 800 }}>
        {row.nameAr} <span className="kl-admin-mono">{row.code}</span>{' '}
        <span className="kl-admin-identity">
          ترتيب {row.priority} · موسم {row.seasonLabel} · {row.matchesInStore} مباراة
          {row.manualMatches > 0 ? ` (منها ${row.manualMatches} يدويًا)` : ''}
          {row.hasOverride ? ' · مُعدَّلة من اللوحة' : ''}
        </span>
      </summary>

      <div className="kl-admin-form" style={{ marginTop: 10 }}>
        <Field label="الترتيب" hint="1–999، الأصغر يظهر أولًا">
          <input value={priority} onChange={(event) => setPriority(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="الموسم الحالي" hint="مثال: 2026-2027">
          <input value={season} onChange={(event) => setSeason(event.target.value)} />
        </Field>
        <Field label="الاسم بالعربية">
          <input value={nameAr} onChange={(event) => setNameAr(event.target.value)} />
        </Field>
        <Field label="الاسم بالإنجليزية">
          <input value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
        </Field>
        <Field label="رابط الشعار">
          <input value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} dir="ltr" />
        </Field>
        <Field label="معرّف الصفحة في NEMO Sports" hint="لا تغيّره إن كانت الصفحة تعمل">
          <input value={nemoSlug} onChange={(event) => setNemoSlug(event.target.value)} dir="ltr" />
        </Field>
        <Field label="ملاحظة تشغيلية" span>
          <input value={noteAr} onChange={(event) => setNoteAr(event.target.value)} />
        </Field>
      </div>

      <div className="kl-admin-actions" style={{ marginTop: 10 }}>
        <ActionButton
          busyKey="save"
          busy={busy}
          tone="primary"
          disabled={!canWrite}
          disabledReasonAr={disabledReasonAr}
          onClick={save}
        >
          حفظ بيانات البطولة
        </ActionButton>
      </div>
      <ResultNote result={result} />
      <p className="kl-admin-note">
        لا حذف لبطولة من اللوحة: البطولات القائمة تظل كما هي، والتعديل هنا يخصّ العرض لجمهور الموقع فقط.
      </p>
    </details>
  );
}

export function TeamManager({
  teams,
  canWrite,
  disabledReasonAr,
}: {
  teams: Array<{ id: string; nameAr: string; nameEn: string; logoUrl: string | null; origin: string }>;
  canWrite: boolean;
  disabledReasonAr?: string;
}) {
  const router = useRouter();
  const { busy, result, run } = useAdminAction();
  const [form, setForm] = useState({ nameAr: '', nameEn: '', shortNameAr: '', countryAr: 'مصر', logoUrl: '' });

  const payload = () => ({
    nameAr: form.nameAr,
    nameEn: form.nameEn,
    shortNameAr: form.shortNameAr || null,
    countryAr: form.countryAr,
    logoUrl: form.logoUrl || null,
  });

  const add = () =>
    run('add', async () => {
      const response = await adminApi('/api/admin/teams', { method: 'POST', json: payload() });
      if (response.ok) {
        setForm({ nameAr: '', nameEn: '', shortNameAr: '', countryAr: 'مصر', logoUrl: '' });
        router.refresh();
      }
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  const remove = (id: string) =>
    run(`delete-${id}`, async () => {
      const response = await adminApi(`/api/admin/teams?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (response.ok) router.refresh();
      return { ok: response.ok, messageAr: response.messageAr, warningsAr: response.warningsAr };
    });

  return (
    <div className="kl-admin-card">
      <h2>الفرق</h2>
      <p className="kl-admin-note">
        فرق المصادر (المستخرجة من المباريات) للعرض فقط. أما الفرق التي تضيفها هنا فتُخزَّن في طبقة اللوحة
        وتُستخدم في المباريات اليدوية، ويمكن حذفها في أي وقت.
      </p>

      <div className="kl-admin-form">
        <Field label="الاسم بالعربية">
          <input value={form.nameAr} onChange={(event) => setForm((c) => ({ ...c, nameAr: event.target.value }))} />
        </Field>
        <Field label="الاسم بالإنجليزية">
          <input value={form.nameEn} onChange={(event) => setForm((c) => ({ ...c, nameEn: event.target.value }))} />
        </Field>
        <Field label="الاسم المختصر">
          <input
            value={form.shortNameAr}
            onChange={(event) => setForm((c) => ({ ...c, shortNameAr: event.target.value }))}
          />
        </Field>
        <Field label="البلد">
          <input value={form.countryAr} onChange={(event) => setForm((c) => ({ ...c, countryAr: event.target.value }))} />
        </Field>
        <Field label="رابط الشعار">
          <input value={form.logoUrl} onChange={(event) => setForm((c) => ({ ...c, logoUrl: event.target.value }))} dir="ltr" />
        </Field>
      </div>
      <div className="kl-admin-actions" style={{ marginTop: 10 }}>
        <ActionButton
          busyKey="add"
          busy={busy}
          tone="primary"
          disabled={!canWrite || !form.nameAr}
          disabledReasonAr={disabledReasonAr}
          onClick={add}
        >
          إضافة الفريق
        </ActionButton>
      </div>
      <ResultNote result={result} />

      <div className="kl-admin-table-wrap" style={{ marginTop: 10 }}>
        <table className="kl-admin-table">
          <thead>
            <tr>
              <th>الفريق</th>
              <th>البلد</th>
              <th>المصدر</th>
              <th>إجراء</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id}>
                <td>
                  {team.nameAr} <span className="kl-admin-mono">{team.id}</span>
                </td>
                <td>{team.nameEn}</td>
                <td>{team.origin === 'manual' ? <span className="kl-admin-badge kl-admin-badge-info">أُضيف في اللوحة</span> : 'من المصادر'}</td>
                <td>
                  {team.origin === 'manual' ? (
                    <ActionButton
                      busyKey={`delete-${team.id}`}
                      busy={busy}
                      tone="danger"
                      disabled={!canWrite}
                      disabledReasonAr={disabledReasonAr}
                      confirmAr={`حذف الفريق «${team.nameAr}» من طبقة اللوحة؟`}
                      onClick={() => remove(team.id)}
                    >
                      حذف
                    </ActionButton>
                  ) : (
                    <span className="kl-admin-identity">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
