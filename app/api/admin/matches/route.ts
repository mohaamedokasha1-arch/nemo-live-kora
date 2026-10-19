import { NextRequest, NextResponse } from 'next/server';
import { isDenied, requireAdminPermission } from '@/lib/auth/admin-session';
import { loadManualDocument } from '@/lib/admin/manual-store';
import { matchLandingUrl, notifyGoogleIndexingAfterResponse } from '@/lib/seo/google-indexing';
import {
  buildManualMatchFromForm,
  createManualMatch,
  detectDuplicateMatch,
  getCompetitionRows,
  getTeamOptions,
  queryAdminMatches,
  type MatchFormInput,
} from '@/lib/admin/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * مباريات لوحة الإدارة: قراءة القائمة (بكل حالة التثبيت)، والتحقق المسبق من التكرار،
 * وإنشاء مباراة يدوية. الإنشاء لا يعتمد على أي مصدر خارجي — هذا هو «الوضع الاحتياطي»
 * المطلوب عندما يتوقف الجلب التلقائي.
 */
export async function GET(request: NextRequest) {
  const auth = requireAdminPermission(request, 'matches:read');
  if (isDenied(auth)) return auth.response;
  await loadManualDocument();

  const url = new URL(request.url);
  const result = queryAdminMatches({
    search: url.searchParams.get('search') || undefined,
    cairoDate: url.searchParams.get('date') || undefined,
    competitionCode: url.searchParams.get('competition') || undefined,
    status: url.searchParams.get('status') || undefined,
    origin: (url.searchParams.get('origin') as 'source' | 'manual' | 'all' | null) || 'all',
    onlyOverridden: url.searchParams.get('overridden') === '1',
    limit: Math.min(200, Number(url.searchParams.get('limit') || 50) || 50),
    offset: Number(url.searchParams.get('offset') || 0) || 0,
  });

  return NextResponse.json(
    {
      ok: true,
      ...result,
      competitions: getCompetitionRows(),
      teams: getTeamOptions(),
      todayCairo: new Date().toISOString().slice(0, 10),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  const auth = requireAdminPermission(request, 'matches:write');
  if (isDenied(auth)) return auth.response;
  const body = (await request.json().catch(() => ({}))) as MatchFormInput & { dryRun?: boolean };
  await loadManualDocument();

  if (body.dryRun) {
    // فحص مسبق للنموذج: تحقق الحقول + كشف التكرار — بلا أي كتابة.
    const preview = buildManualMatchFromForm(body, auth.identity.username);
    if (!preview.record) {
      return NextResponse.json(
        {
          ok: false,
          error: 'ValidationFailed',
          messageAr: preview.issues.map((issue) => issue.messageAr).join(' '),
          issues: preview.issues,
        },
        { status: 422, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const duplicate = detectDuplicateMatch({
      id: preview.record.id,
      competitionCode: preview.record.competitionCode,
      cairoDate: preview.record.cairoDate,
      homeNameAr: preview.record.homeTeam.nameAr,
      awayNameAr: preview.record.awayTeam.nameAr,
    });
    return NextResponse.json({
      ok: true,
      record: preview.record,
      duplicateOf: duplicate.duplicateOf,
      duplicateReasonAr: duplicate.reasonAr,
      messageAr: duplicate.duplicateOf
        ? `تحذير: ${duplicate.reasonAr}`
        : 'النموذج صالح ولا يوجد تكرار — يمكن الحفظ.',
    });
  }

  const outcome = await createManualMatch(body, auth.identity);
  // إشعار Google Indexing بصفحة المباراة الجديدة في الخلفية فور نجاح الحفظ.
  if (outcome.ok && outcome.data) {
    notifyGoogleIndexingAfterResponse([matchLandingUrl(outcome.data.id)], {
      contextAr: 'admin/matches — إنشاء',
    });
  }
  return NextResponse.json(
    {
      ok: outcome.ok,
      messageAr: outcome.messageAr,
      data: outcome.data,
      duplicateOf: outcome.duplicateOf ?? null,
      warningsAr: outcome.warningsAr,
      landingPath: outcome.data ? `/matches/${outcome.data.id}` : null,
    },
    { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
  );
}
