import React from 'react';
import type { Metadata } from 'next';
import { getCompetitionRows, getTeamOptions } from '@/lib/admin/service';
import { getManualStatus } from '@/lib/admin/manual-store';
import { roleHasPermission } from '@/lib/auth/admin-session';
import CompetitionControls, { TeamManager } from '../_components/catalog-client';
import { adminMetadata, guardAdminPage } from '../_lib/guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'البطولات والفرق', ...adminMetadata };

/**
 * البطولات والفرق والمواسم: كل بطولة معروضة بحالتها الحقيقية (عدد المباريات في المخزن،
 * الموسم، الترتيب، وهل عليها تعديل من اللوحة). الجديد هنا أن المدير يستطيع تجهيز موسم
 * قادم أو دوري عربي/أفريقي جديد، وإضافة فريق يدوي يُستخدم في المباريات اليدوية.
 */
export default async function AdminCatalogPage() {
  const guard = await guardAdminPage('catalog:read', 'البطولات والفرق');
  if (!guard.allowed) return guard.denied;

  const storage = getManualStatus();
  const competitions = getCompetitionRows();
  const teams = getTeamOptions();
  const canWrite = roleHasPermission(guard.identity!.role, 'catalog:write');
  const disabledReasonAr = storage.writable
    ? 'دورك الحالي لا يملك صلاحية تعديل الكتالوج.'
    : 'التخزين غير قابل للكتابة على هذه البيئة — لن يُحفظ التعديل.';

  const seasons = Array.from(new Set(competitions.map((row) => row.seasonLabel))).sort();

  return (
    <>
      <section className="kl-admin-card">
        <h2>نظرة عامة</h2>
        <p className="kl-admin-note">
          البطولات المسجّلة: <strong>{competitions.length}</strong> · المواسم الظاهرة:{' '}
          <strong>{seasons.join(' , ') || '—'}</strong> · الفرق المتاحة: <strong>{teams.length}</strong> (منها{' '}
          {teams.filter((team) => team.origin === 'manual').length} أُضيفت من اللوحة).
        </p>
        <p className="kl-admin-note">
          تعديل هنا لا يحذف أي بطولة أو فريق من المصادر، ولا يغيّر مسار صفحة عامة قائمة: القيم تُخزَّن في طبقة
          الإدارة وتُطبَّق عند العرض فقط.
        </p>
      </section>

      <section className="kl-admin-card">
        <h2>البطولات والدوريات</h2>
        <div className="kl-admin-list">
          {competitions.map((row) => (
            <CompetitionControls
              key={row.code}
              row={{
                code: row.code,
                nameAr: row.nameAr,
                nameEn: row.nameEn,
                countryAr: row.countryAr,
                seasonLabel: row.seasonLabel,
                priority: row.priority,
                matchesInStore: row.matchesInStore,
                manualMatches: row.manualMatches,
                hasOverride: row.hasOverride,
                noteAr: row.noteAr,
                nemoCompetitionSlug: row.nemoCompetitionSlug,
                logoUrl: row.logoUrl,
              }}
              canWrite={canWrite && storage.writable && storage.durable}
              disabledReasonAr={disabledReasonAr}
            />
          ))}
        </div>
      </section>

      <TeamManager
        teams={teams.map((team) => ({
          id: team.id,
          nameAr: team.nameAr,
          nameEn: team.nameEn,
          logoUrl: team.logoUrl,
          origin: team.origin,
        }))}
        canWrite={canWrite && storage.writable && storage.durable}
        disabledReasonAr={disabledReasonAr}
      />
    </>
  );
}
