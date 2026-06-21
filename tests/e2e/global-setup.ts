import { createClient } from "@supabase/supabase-js";
import { readIntegrationEnv } from "../integration/env";

export interface DemoUser {
  email: string;
  username: string;
  userId: string;
}

export const ADVOCATE_USERNAME = "climatologist";
export const CHALLENGER_USERNAME = "skeptic";

/** Fixed password for both demo users — test-only, not a real secret. */
export const DEMO_PASSWORD = "pwd123!";

/**
 * Provisions the two demo users for the critical-path e2e walkthrough:
 * an advocate ("climatologist") and a challenger ("skeptic") debating global
 * warming. Usernames/password are fixed (no random suffix) so specs can sign
 * in by deriving `<username>@example.com` + `DEMO_PASSWORD` directly, with
 * nothing persisted to disk. Idempotent — reuses an existing user by email
 * instead of erroring, since some runners (e.g. the Playwright VS Code
 * extension's "run once" mode) can invoke global setup again without ever
 * running the teardown from the previous run. The returned teardown still
 * deletes both users.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const env = readIntegrationEnv();
  if (!env) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY — set them in .env / .env.test before running e2e tests.",
    );
  }

  const admin = createClient(env.url, env.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw listError;
  const existingByEmail = new Map<string, (typeof existing.users)[number]>();
  for (const user of existing.users) {
    if (user.email) existingByEmail.set(user.email, user);
  }

  const getOrCreateUser = async (username: string): Promise<DemoUser> => {
    const email = `${username}@example.com`;
    const found = existingByEmail.get(email);
    if (found) return { email, username, userId: found.id };

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { username },
    });
    if (error) throw error;
    return { email, username, userId: data.user.id };
  };

  const advocate = await getOrCreateUser(ADVOCATE_USERNAME);
  const challenger = await getOrCreateUser(CHALLENGER_USERNAME);

  // eslint-disable-next-line no-console -- visible in the e2e run output so the demo users are easy to spot
  console.log("[e2e:global-setup] provisioned demo users:", {
    advocate: advocate.email,
    challenger: challenger.email,
  });

  return async () => {
    await admin.auth.admin.deleteUser(advocate.userId);
    await admin.auth.admin.deleteUser(challenger.userId);
  };
}
