import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/cron/update-matches/route';
import { getGatewayDatabase } from '../lib/db/store';

test('Authorized cron reports 503 on total provider failure and retains stored matches', async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'local-failure-test';
  const before = JSON.stringify(getGatewayDatabase().matches);
  const stub = mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 503 }));
  try {
    const response = await GET(new NextRequest('http://localhost/api/cron/update-matches', {
      headers: { authorization: 'Bearer local-failure-test' },
    }));
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.equal(result.result.matchesFetched, 0);
    assert.ok(result.runId);
    assert.ok(result.startedAt && result.finishedAt);
    assert.equal(JSON.stringify(getGatewayDatabase().matches), before);
    assert.equal(getGatewayDatabase().syncLogs[0].id, result.runId);
  } finally {
    stub.mock.restore();
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
