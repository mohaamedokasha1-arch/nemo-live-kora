/**
 * Next.js instrumentation hook — runs once per server process before the first request.
 *
 * The gateway store lives in process memory during a request, so a cold instance must adopt the
 * newest shared snapshot before it serves pages or accepts a sync. Doing it here (instead of on the
 * first request) keeps that read off the user-visible path and guarantees the scheduled cron never
 * starts from the deployed bundle's stale copy.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if ((process.env.NEMO_SKIP_STORE_HYDRATION || '').trim().toLowerCase() === 'on') return;
  try {
    const { hydrateGatewayDatabase, getDurableStoreStatus, isServerlessRuntime } = await import('./lib/db/store');
    const status = getDurableStoreStatus();
    if (!status.configured) {
      if (isServerlessRuntime()) {
        // One actionable warning at boot — not an error per request. Without a shared store the
        // cron honestly answers 503; the fix is configuration, documented in README section 7.
        console.warn(
          '[instrumentation] durable_store_not_configured',
          JSON.stringify({
            serverless: true,
            howToFix:
              'Set TURSO_DATABASE_URL+TURSO_AUTH_TOKEN, KV_REST_API_URL+KV_REST_API_TOKEN, BLOB_READ_WRITE_TOKEN, or NEMO_DURABLE_STORE_URL, then redeploy.',
          })
        );
      }
      return;
    }
    const persistence = await hydrateGatewayDatabase();
    console.info(
      '[instrumentation] durable_store_ready',
      JSON.stringify({ backend: status.backendId, persistence })
    );
  } catch (error) {
    // A failed hydration must never block the server from starting.
    console.error(
      '[instrumentation] durable_store_hydration_failed',
      error instanceof Error ? error.message : error
    );
  }
}
