import { NextRequest, NextResponse } from 'next/server';
import { getTodayCairoDate, isValidDateParam } from '@/lib/cairo-time';
import { queryGatewayMatches } from '@/lib/db/store';
import { ensureFreshMatches } from '@/lib/sync/engine';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawDate = searchParams.get('date');
  const competitionCode = searchParams.get('competition') || undefined;
  const countryAr = searchParams.get('country') || undefined;
  const searchQuery = searchParams.get('q') || undefined;
  const onlyEgyptianInterest = searchParams.get('egyptOnly') === '1';

  const cairoDate =
    rawDate === 'ALL'
      ? undefined
      : rawDate && isValidDateParam(rawDate)
      ? rawDate
      : getTodayCairoDate();

  await ensureFreshMatches();
  const result = queryGatewayMatches({
    cairoDate,
    competitionCode,
    countryAr,
    searchQuery,
    onlyEgyptianInterest,
  });

  return NextResponse.json({
    ok: true,
    timezone: 'Africa/Cairo',
    selectedDate: cairoDate || 'ALL',
    ...result,
  });
}
