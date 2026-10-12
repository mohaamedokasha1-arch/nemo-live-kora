import { NextResponse } from 'next/server';
import { getGatewayDatabase } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getGatewayDatabase();
  return NextResponse.json({
    ok: true,
    meta: db.meta,
    sources: Object.values(db.sources),
    competitionsCount: db.competitions.length,
    seasonsCount: db.seasons.length,
    teamsCount: db.teams.length,
    matchesCount: db.matches.length,
    standings: db.standings,
    news: db.news,
    nemoMappingTable: db.nemoMappingTable,
    syncLogs: db.syncLogs.slice(0, 10),
    sourceErrors: db.sourceErrors.slice(0, 15),
  });
}
