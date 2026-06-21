import { createClient } from "@supabase/supabase-js";
import { readIntegrationEnv } from "../integration/env";
import { ADVOCATE_USERNAME, CHALLENGER_USERNAME, deleteDebatesOwnedBy } from "./global-setup";

/**
 * Deletes the advocate/challenger demo users if they're still around — e.g.
 * after a Playwright run was interrupted (closed browser, Ctrl+C, IDE
 * extension crash) and never reached its global teardown. Safe to run
 * anytime; a no-op if nothing is left over.
 *
 * Usage: `npm run test:e2e:teardown`
 */
async function main(): Promise<void> {
  const env = readIntegrationEnv();
  if (!env) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY — set them in .env / .env.test before running this script.",
    );
  }

  const admin = createClient(env.url, env.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const demoEmails = new Set([`${ADVOCATE_USERNAME}@example.com`, `${CHALLENGER_USERNAME}@example.com`]);

  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;

  const stale = data.users.filter((u) => u.email && demoEmails.has(u.email));
  if (stale.length === 0) {
    console.log("[teardown-demo-users] nothing to clean up");
    return;
  }

  await deleteDebatesOwnedBy(
    admin,
    stale.map((u) => u.id),
  );

  for (const user of stale) {
    await admin.auth.admin.deleteUser(user.id);
    console.log(`[teardown-demo-users] deleted ${user.email}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
