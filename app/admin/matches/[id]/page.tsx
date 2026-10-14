import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getCompetitionRows, getSourceRows, queryAdminMatches } from '@/lib/admin/service';
import { findManualMatch, findManualOverride, getManualStatus } from '@/lib/admin/manual-store';
import { getGatewayDatabase } from '@/lib/db/store';
import { CONFLICT_POLICY_SUMMARY_AR } from '@/lib/admin/manual-document';
import { roleHasPermission } from '@/lib/auth/admin-session';
import MatchForm, { type MatchFormValues } from '../../_components/match-form';
import OverridePanel from '../../_components/override-panel';
import { formatDateAr } from '../../_lib/format';
import { Badge, Kv } from '../../_components/ui';
import { adminMetadata, guardAdminPage } from '../../_lib/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'تعديل مباراة', ...adminMetadata };

export default async function AdminMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPage('matches:read', 'تعديل مباراة');
  if (!guard.allowed) return guard.denied;

  const { id: rawId } = await params;
  const matchId = decodeURIComponent(rawId);
  const found = queryAdminMatches({ search: matchId, limit: 200 }).rows.filter((row) => row.id === matchId);
  const row = found[0];

  if (!row) {
    return (
      <>
        <div className="kl-admin-note kl-admin-note-warn">
          لا توجد مباراة بالمعرّف <span className="kl-admin-mono">{matchId}</span> في المخزن الحالي.
        </div>
        <p className="kl-admin-note">
          <Link href="/admin/matches">← رجوع إلى قائمة المباريات</Link>
        </p>
      </>
    );
  }

  const manual = findManualMatch(matchId);
  const override = findManualOverride(matchId);
  const dbMatch = getGatewayDatabase().matches.find((match) => match.id === matchId) ?? null;
  const storage = getManualStatus();
  const canWriteMatches = roleHasPermission(guard.identity!.role, 'matches:write');
  const competitions = getCompetitionRows().map((item) => ({
    code: item.code,
    nameAr: item.nameAr,
    seasonLabel: item.seasonLabel,
  }));
  const sourceIds = getSourceRows().map((source) => source.id);

  const initial: MatchFormValues = {
    id: matchId,
    status: manual?.status || row.status,
    kickoffUtc: manual?.kickoffUtc || row.kickoffUtc,
    timezone: manual?.timezone || 'Africa/Cairo',
    kickoffConfirmed: manual ? manual.kickoffConfirmed : true,
    homeNameAr: manual?.homeTeam.nameAr || row.homeNameAr,
    homeNameEn: manual?.homeTeam.nameEn || '',
    homeLogoUrl: manual?.homeTeam.logoUrl || '',
    awayNameAr: manual?.awayTeam.nameAr || row.awayNameAr,
    awayNameEn: manual?.awayTeam.nameEn || '',
    awayLogoUrl: manual?.awayTeam.logoUrl || '',
    competitionCode: manual?.competitionCode || row.competitionCode,
    competitionNameAr: manual?.competitionNameAr || row.competitionNameAr,
    competitionCountryAr: manual?.competitionCountryAr || dbMatch?.countryAr || '',
    region: manual?.region || dbMatch?.region || 'africa',
    seasonLabel: manual?.seasonLabel || dbMatch?.seasonLabel || '',
    roundLabelAr: manual?.roundLabelAr || dbMatch?.roundLabelAr || '',
    venue: manual?.venue || dbMatch?.venue || '',
    cityAr: manual?.cityAr || '',
    scoreHome: String(manual?.score.home ?? dbMatch?.score.home ?? ''),
    scoreAway: String(manual?.score.away ?? dbMatch?.score.away ?? ''),
    halfTimeHome: String(manual?.score.halfTimeHome ?? dbMatch?.score.halfTimeHome ?? ''),
    halfTimeAway: String(manual?.score.halfTimeAway ?? dbMatch?.score.halfTimeAway ?? ''),
    statusNoteAr: manual?.statusNoteAr || '',
    liveMinute: manual?.liveMinute ? String(manual.liveMinute) : '',
    channelAr: manual?.channelAr || '',
    broadcastStatus: manual?.broadcast.status || 'live',
    broadcastUrl: manual?.broadcast.url || '',
    broadcastNotesAr: manual?.broadcast.notesAr || '',
    keywords: (manual?.keywords || []).join(', '),
    indexable: manual ? manual.indexable : true,
    incidentsJson: (manual?.incidents?.length ? manual.incidents : dbMatch?.incidents || []).length
      ? JSON.stringify(manual?.incidents?.length ? manual.incidents : dbMatch?.incidents || [], null, 0)
      : '',
  };

  return (
    <>
      <p className="kl-admin-note">
        <Link href="/admin/matches">← رجوع إلى قائمة المباريات</Link>
      </p>

      <section className="kl-admin-card">
        <div className="kl-admin-head">
          <h2>حالة السجل الحالية على الموقع</h2>
          {row.origin === 'manual' ? <Badge tone="warn">إدخال يدوي</Badge> : <Badge tone="info">{row.sourceLabelAr}</Badge>}
        </div>
        <Kv
          items={[
            { label: 'المعرّف', value: <span className="kl-admin-mono">{row.id}</span> },
            { label: 'الموعد (UTC)', value: <span className="kl-admin-mono">{row.kickoffUtc}</span> },
            { label: 'تاريخ القاهرة', value: `${row.cairoDate} — ${row.cairoTime}` },
            { label: 'الحالة المعروضة', value: row.statusLabelAr },
            { label: 'النتيجة المعروضة', value: row.scoreLabel },
            { label: 'آخر تحديث', value: formatDateAr(row.lastUpdatedAt) },
            { label: 'المصدر الأساسي', value: row.primarySource },
            {
              label: 'التثبيت الحالي',
              value: row.lockAll ? 'مجمّد بالكامل' : row.manualFields.length ? row.manualFields.join(' , ') : 'لا شيء',
            },
          ]}
        />
        {row.landingPath ? (
          <p className="kl-admin-note">
            صفحة المباراة العامة: <a href={row.landingPath} target="_blank" rel="noreferrer">{row.landingPath}</a> —
            بعد أي تعديل اضغط «نشر التحديث» من القائمة لإعادة بناء الصفحة فورًا.
          </p>
        ) : (
          <p className="kl-admin-note kl-admin-note-warn">
            هذا السجل ليس له مسار عام في الكتالوج بعد: سيظهر على الموقع بعد تحديث الكتالوج (يحدث تلقائيًا مع
            التعديل اليدوي أو المزامنة القادمة).
          </p>
        )}
      </section>

      <MatchForm
        mode="edit"
        initial={initial}
        matchId={matchId}
        canWrite={canWriteMatches && storage.writable && storage.durable}
        disabledReasonAr={
          !storage.durable || !storage.writable
            ? 'التخزين الحالي غير دائم — الحفظ مرفوض حتى لا يضيع التعديل.'
            : 'دورك لا يملك صلاحية التعديل.'
        }
        competitionOptions={competitions}
      />

      <OverridePanel
        matchId={matchId}
        lockedFields={override?.locked || []}
        lockAll={override?.lockAll || false}
        suppressedSources={override?.suppressedSources || []}
        canWrite={canWriteMatches && storage.writable && storage.durable}
        disabledReasonAr={
          !storage.durable || !storage.writable
            ? 'التخزين الحالي غير دائم — الحفظ مرفوض.'
            : 'دورك لا يملك صلاحية التعديل.'
        }
        sourceIds={sourceIds}
        policySummaryAr={CONFLICT_POLICY_SUMMARY_AR.join(' · ')}
      />
    </>
  );
}
