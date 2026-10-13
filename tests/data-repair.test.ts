import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { mapSportScoreMatchToRecord } from '../lib/sources/sportscore';
import { mergeMatchRecords } from '../lib/db/seed-data';
import { buildMatchDedupKey } from '../lib/match-identity';
import { fetchWithProtection } from '../lib/sources/http-client';
import { fetchFootballDataSync } from '../lib/sources/football-data';
import { getGatewayDatabase, upsertCompetitionsInStore } from '../lib/db/store';
import { runNewsSync } from '../lib/sync/engine';

function fixture(status = 'live') {
  return mapSportScoreMatchToRecord({ home: 'Repair Home', away: 'Repair Away', status,
    time: '2026-10-13T17:00:00Z', competition: 'Repair League', home_score: 1, away_score: 0 });
}
test('Final result supersedes live; older or empty observations do not erase it', () => {
  const live = { ...fixture(), lastUpdatedAt: '2026-10-13T17:20:00Z' };
  const final = { ...fixture('finished'), lastUpdatedAt: '2026-10-13T19:00:00Z' };
  const merged = mergeMatchRecords(live, final);
  assert.equal(merged.status, 'finished');
  assert.equal(merged.fieldProvenance?.status.source, 'sportscore');
  assert.equal(mergeMatchRecords(merged, live).status, 'finished');
  const empty = { ...final, status: 'unconfirmed' as const, score: { home: null, away: null } };
  assert.equal(mergeMatchRecords(merged, empty).score.home, 1);
});
test('Conservative dedup distinguishes kickoff times and unknown-time records', () => {
  const a = fixture();
  assert.notEqual(buildMatchDedupKey(a), buildMatchDedupKey({ ...a, utcKickoff: '2026-10-13T21:00:00Z' }));
  assert.notEqual(buildMatchDedupKey({ ...a, id: 'a', kickoffConfirmed: false }), buildMatchDedupKey({ ...a, id: 'b', kickoffConfirmed: false }));
  assert.notEqual(buildMatchDedupKey(a), buildMatchDedupKey({ ...a, homeTeam: { ...a.homeTeam, id: 'team-ss-new', nameEn: 'Repair Home Women' } }));
});
test('HTTP retries transient 503, isolates credential caches, does not cache invalid JSON', async () => {
  let calls = 0;
  const stub = mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return new Response('unavailable', { status: 503 });
    return Response.json({ calls });
  });
  try {
    const url = 'https://example.invalid/repair-retry';
    const first = await fetchWithProtection(url, { retries: 1, headers: { authorization: 'one' } });
    assert.equal(first.ok, true); assert.equal(calls, 2);
    assert.equal((await fetchWithProtection(url, { headers: { authorization: 'two' } })).fromCache, false);
    assert.equal(calls, 3);
  } finally { stub.mock.restore(); }
  let invalidCalls = 0;
  const invalid = mock.method(globalThis, 'fetch', async () => { invalidCalls++; return new Response('not json'); });
  try {
    for (let i = 0; i < 2; i++) assert.equal((await fetchWithProtection('https://example.invalid/repair-invalid')).ok, false);
    assert.equal(invalidCalls, 2);
  } finally { invalid.mock.restore(); }
});
test('Provider discovery persists a previously unknown competition without a curated list edit', async () => {
  const stub = mock.method(globalThis, 'fetch', async () => Response.json({ competitions: [{ id: 99001, code: 'REPAIR_NEW', name: 'New Discovered League', type: 'LEAGUE', emblem: null,
    currentSeason: { id: 22, startDate: '2026-08-01', endDate: '2027-05-31', currentMatchday: 1 } }] }));
  try {
    const result = await fetchFootballDataSync();
    assert.equal(result.competitions.length, 1);
    upsertCompetitionsInStore(result.competitions);
    upsertCompetitionsInStore(result.competitions);
    assert.equal(getGatewayDatabase().competitions.filter((c) => c.sourceIds.footballDataCode === 'REPAIR_NEW').length, 1);
  } finally { stub.mock.restore(); }
});
test('RSS HTTP 200 with no publishable items is not an ingestion success', async () => {
  const before = JSON.stringify(getGatewayDatabase().news);
  const stub = mock.method(globalThis, 'fetch', async () => new Response('<rss><channel></channel></rss>'));
  try {
    const result = await runNewsSync('test-empty', [], { retries: 0, limitFeeds: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.publishedCount, 0);
    assert.equal(JSON.stringify(getGatewayDatabase().news), before);
  } finally { stub.mock.restore(); }
});
test('A 200 competition index cannot mask a failed authorized fixtures request', async () => {
  const previous = process.env.FOOTBALL_DATA_API_KEY;
  process.env.FOOTBALL_DATA_API_KEY = 'fixture-test-key';
  const stub = mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => String(input).includes('/matches?')
    ? Response.json({ message: 'forbidden' }, { status: 403 })
    : Response.json({ competitions: [] }));
  try {
    const result = await fetchFootballDataSync('2026-10-13', '2026-10-14');
    assert.equal(result.ok, false);
    assert.equal(result.httpStatus, 403);
  } finally {
    stub.mock.restore();
    if (previous === undefined) delete process.env.FOOTBALL_DATA_API_KEY;
    else process.env.FOOTBALL_DATA_API_KEY = previous;
  }
});
