import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getCompetitionRows } from '@/lib/admin/service';
import { getManualStatus } from '@/lib/admin/manual-store';
import MatchForm, { EMPTY_MATCH_FORM } from '../../_components/match-form';
import { adminMetadata, guardAdminPage } from '../../_lib/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'إضافة مباراة', ...adminMetadata };

export default async function AdminNewMatchPage() {
  const guard = await guardAdminPage('matches:write', 'إضافة مباراة');
  if (!guard.allowed) return guard.denied;

  const storage = getManualStatus();
  const competitions = getCompetitionRows().map((row) => ({
    code: row.code,
    nameAr: row.nameAr,
    seasonLabel: row.seasonLabel,
  }));

  return (
    <>
      <p className="kl-admin-note">
        <Link href="/admin/matches">← رجوع إلى قائمة المباريات</Link>
      </p>
      <MatchForm
        mode="create"
        initial={EMPTY_MATCH_FORM}
        canWrite={storage.writable && storage.durable}
        disabledReasonAr="التخزين الحالي غير دائم — الحفظ مرفوض حتى لا يضيع الإدخال."
        competitionOptions={competitions}
      />
    </>
  );
}
