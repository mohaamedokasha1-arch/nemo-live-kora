import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Read a Cloudflare binding in an OpenNext request, with process.env retained for
 * Node/Vercel/tests. This must only be called while handling a request (or in a
 * runtime where process.env is available); never snapshot bindings at module load.
 */
export function runtimeEnv(name: string): string | undefined {
  try {
    const value = (getCloudflareContext().env as Record<string, unknown>)[name];
    if (typeof value === 'string') return value;
  } catch {
    // Outside an OpenNext request (build, CLI, unit tests): use the Node fallback.
  }
  return process.env[name];
}

/** ProcessEnv-compatible view for existing auth/config APIs. */
export function runtimeEnvironment(): NodeJS.ProcessEnv {
  const names = [
    'NEMO_ADMIN_USER', 'NEMO_ADMIN_USERNAME', 'NEMO_ADMIN_PASSWORD_HASH', 'NEMO_ADMIN_USERS',
    'NEMO_ADMIN_ROLE', 'NEMO_ADMIN_DISPLAY_NAME', 'NEMO_ADMIN_SESSION_SECRET',
    'CRON_SECRET', 'NEMO_INGEST_TOKEN', 'NODE_ENV',
  ];
  const result: NodeJS.ProcessEnv = { ...process.env };
  for (const name of names) {
    const value = runtimeEnv(name);
    if (value !== undefined) result[name] = value;
  }
  return result;
}
