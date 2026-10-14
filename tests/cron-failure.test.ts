import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/cron/update-matches/route';
import { getGatewayDatabase } from '../lib/db/store';

test('Unauthenticated cron reports 503 on total provider failure and retains stored matches', async () => {
  const previousCronSecret = process.env.CRON_SECRET;
  const previousIngestToken = process.env.NEMO_INGEST_TOKEN;
  delete process.env.CRON_SECRET;
  delete process.env.NEMO_INGEST_TOKEN;
  const before = JSON.stringify(getGatewayDatabase().matches);
  const stub = mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 503 }));
  try {
    const response = await GET();
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
    if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCronSecret;
    if (previousIngestToken === undefined) delete process.env.NEMO_INGEST_TOKEN;
    else process.env.NEMO_INGEST_TOKEN = previousIngestToken;
  }
});
