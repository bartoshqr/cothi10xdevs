import { loadEnv } from "vite";

export interface IntegrationEnv {
  url: string;
  /** anon (or publishable) key — used by the seeding client's password sign-in. */
  anonKey: string;
  /** service-role key — used by the assertion/teardown client (RLS bypassed). */
  serviceKey: string;
}

/**
 * Resolve the three integration env vars from process.env, falling back to the
 * `.env*` files on disk. The fallback matters in two contexts: Vitest workers
 * (where `test.env` already populated process.env) and the globalSetup main
 * process (where it did not). Returns `null` when any var is absent so callers
 * can skip the integration suite cleanly instead of failing to connect.
 */
export function readIntegrationEnv(): IntegrationEnv | null {
  const fileEnv = loadEnv("test", process.cwd(), "");
  const get = (key: string): string | undefined => process.env[key] ?? fileEnv[key];

  const url = get("SUPABASE_URL");
  const anonKey = get("SUPABASE_KEY");
  const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !anonKey || !serviceKey) return null;
  return { url, anonKey, serviceKey };
}
