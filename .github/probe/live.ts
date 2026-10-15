/* Live verification against the real providers (run on a GitHub runner, outside the sandbox). */
import { getTodayCairoDate, shiftDateString, toCairoTime24 } from '../../lib/cairo-time';

async function main() {
  const engine = await import('../../lib/sync/engine');
  const store = await import('../../lib/db/store');
  await store.hydrateStore();
  const today = getTodayCairoDate();
  const tomorrow = shiftDateString(today, 1);
  console.log('NOW_UTC', new Date().toISOString(), 'CAIRO_TODAY', today, 'CAIRO_TOMORROW', tomorrow);
  const before = { t: store.queryGatewayMatches({ cairoDate: today }).matches.length, m: store.queryGatewayMatches({ cairoDate: tomorrow }).matches.length };
  console.log('BEFORE (bundled snapshot)', JSON.stringify(before));
  const t0 = Date.now();
  const log = await engine.runGatewaySync({ mode: 'live', quick: true, skipNews: true, trigger: 'live e2e quick' });
  console.log('QUICK_SYNC_MS', Date.now() - t0);
  for (const r of log.sourceResults) console.log('SOURCE', r.sourceId, r.status, r.matchesFetched, r.messageAr.slice(0, 600));
  for (const date of [today, tomorrow]) {
    const q = store.queryGatewayMatches({ cairoDate: date });
    console.log(`\nDATE ${date} total=${q.matches.length} competitions=${q.groups.length}`);
    const statusCount: Record<string, number> = {};
    for (const m of q.matches) statusCount[m.status] = (statusCount[m.status] || 0) + 1;
    console.log('STATUS', JSON.stringify(statusCount));
    console.log('GROUPS', q.groups.slice(0, 45).map((g) => `${g.competitionNameAr}(${g.matches.length})`).join(' | '));
    const ids = q.matches.map((m) => m.id);
    const dupKey = q.matches.map((m) => `${m.homeTeam.nameEn}|${m.awayTeam.nameEn}|${m.cairoDate}`);
    console.log('DUP_IDS', ids.length - new Set(ids).size, 'DUP_TEAMS_DATE', dupKey.length - new Set(dupKey).size);
    const wrongDate = q.matches.filter((m) => m.kickoffConfirmed && m.cairoDate !== new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(m.utcKickoff)));
    console.log('WRONG_CAIRO_DATE', wrongDate.length);
    const egy = q.matches.filter((m) => m.isEgyptianInterest);
    console.log('EGYPT', egy.length);
    for (const m of egy.slice(0, 25)) console.log('  ', m.competitionNameAr, '|', m.homeTeam.nameAr, '-', m.awayTeam.nameAr, '|', m.utcKickoff, '=> Cairo', toCairoTime24(m.utcKickoff), m.cairoTime, '|', m.statusLabelAr, m.statusNoteAr || '', '|', m.score.home, ':', m.score.away, '| venue', m.venue, '| src', m.contributingSources.join('+'), '| id', m.id);
    const sample = ['السعود', 'Saudi', 'قطر', 'الإمارات', 'Europa', 'أوروبا', 'Liga', 'Premier'];
    for (const g of q.groups.filter((g) => sample.some((s) => g.competitionNameAr.includes(s) || g.competitionNameEn.includes(s))).slice(0, 10)) {
      console.log('  GROUP', g.competitionNameAr, g.matches.slice(0, 4).map((m) => `${m.homeTeam.nameEn}-${m.awayTeam.nameEn}@${toCairoTime24(m.utcKickoff)} ${m.statusLabelAr}`).join(' ; '));
    }
  }
  // Second quick sync: must not create duplicates.
  const countBefore = store.getGatewayDatabase().matches.length;
  await engine.runGatewaySync({ mode: 'live', quick: true, skipNews: true, trigger: 'live e2e quick 2' });
  console.log('\nSECOND_SYNC store before', countBefore, 'after', store.getGatewayDatabase().matches.length, 'active today', store.queryGatewayMatches({ cairoDate: today }).matches.length);
  // Wide/daily sync (cron path)
  const t1 = Date.now();
  const wide = await engine.runGatewaySync({ mode: 'daily', skipNews: true, trigger: 'live e2e daily' });
  console.log('WIDE_SYNC_MS', Date.now() - t1, 'window', JSON.stringify(wide.dateWindow));
  for (const r of wide.sourceResults) console.log('WIDE_SOURCE', r.sourceId, r.status, r.matchesFetched, r.messageAr.slice(0, 400));
  for (const date of [today, tomorrow, shiftDateString(today, 2)]) {
    console.log('WIDE DATE', date, store.queryGatewayMatches({ cairoDate: date }).matches.length);
  }
  await store.flushDurableStore({ force: true });
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e); process.exit(1); });
