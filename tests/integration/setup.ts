import { hasIntegrationEnv } from "./helpers";

// setupFiles runs once per test file (in the worker). Surface a clear, single
// reason when the integration env is missing so a skipped suite isn't silent.
if (!hasIntegrationEnv) {
  // eslint-disable-next-line no-console
  console.warn(
    "[integration] Skipping integration tests — set SUPABASE_URL, SUPABASE_KEY and " +
      "SUPABASE_SERVICE_ROLE_KEY (and start Supabase local) to run them.",
  );
}
