import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { TestProject } from "vitest/node";
import { readIntegrationEnv } from "./env";

export interface TestUser {
  email: string;
  password: string;
  userId: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    // Credentials for the dedicated seeding user, or null when the integration
    // env is absent (suite is skipped). Read in tests via `inject("seedingUser")`.
    seedingUser: TestUser | null;
    // A second auth user — the "challenger" in S-02 pair-visibility tests. Lets a
    // test sign in as a non-owner and assert RLS from the other side of an invite.
    // null when the integration env is absent.
    challengerUser: TestUser | null;
  }
}

/**
 * Provision a single dedicated test user for the whole integration run.
 *
 * `create_debate_with_root` is SECURITY DEFINER and reads `auth.uid()`, so a pure
 * service-role client cannot seed (its uid is null → the RPC raises). We create one
 * real auth user here and hand its credentials to the workers; per-test seeding
 * signs in as that user (exercising the real creation path), while assertions and
 * teardown use the service-role client. The user is removed in the teardown below.
 */
export default async function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  const env = readIntegrationEnv();
  if (!env) {
    project.provide("seedingUser", null);
    project.provide("challengerUser", null);
    return undefined;
  }

  const admin = createClient(env.url, env.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Provision one auth user. The on_auth_user_created trigger materializes a
  // profiles row from raw_user_meta_data.username, which must match
  // ^[a-z0-9_]{3,30}$ — a UUID with hyphens stripped satisfies it. Omitting it
  // aborts the user insert.
  const createUser = async (): Promise<TestUser> => {
    const email = `test-user-${randomUUID()}@example.com`;
    const password = `pw-${randomUUID()}`;
    const username = `tu_${randomUUID().replace(/-/g, "")}`.slice(0, 30);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
    });
    if (error) throw error;
    return { email, password, userId: data.user.id };
  };

  // Two real users: the debate owner ("seeding"/advocate) and a second user
  // ("challenger") so S-02 pair-visibility can assert RLS from both sides.
  const seedingUser = await createUser();
  const challengerUser = await createUser();
  project.provide("seedingUser", seedingUser);
  project.provide("challengerUser", challengerUser);

  return async () => {
    await admin.auth.admin.deleteUser(seedingUser.userId);
    await admin.auth.admin.deleteUser(challengerUser.userId);
  };
}
