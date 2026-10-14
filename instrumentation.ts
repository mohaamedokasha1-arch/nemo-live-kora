/**
 * Next.js instrumentation hook — runs once per server process before the first request.
 *
 * The gateway store lives in process memory during a request, so a cold instance adopts the newest
 * stored snapshot before it serves pages or accepts a sync. The local store needs no configuration,
 * so this always runs.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if ((process.env.NEMO_SKIP_STORE_HYDRATION || '').trim().toLowerCase() === 'on') return;
  try {
    const { hydrateGatewayDatabase, getDurableStoreStatus } = await import('./lib/db/store');
    const persistence = await hydrateGatewayDatabase();
    console.info(
      '[instrumentation] store_ready',
      JSON.stringify({ backend: getDurableStoreStatus().backendId, ok: persistence.ok, durable: persistence.durable })
    );
  } catch (error) {
    // A failed hydration must never block the server from starting.
    console.error(
      '[instrumentation] store_hydration_failed',
      error instanceof Error ? error.message : error
    );
  }
}
