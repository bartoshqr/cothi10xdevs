import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, inject } from "vitest";
import type { Database } from "@/db/database.types";
import { readIntegrationEnv } from "./env";

const env = readIntegrationEnv();

/** True when SUPABASE_URL / SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY are all set. */
export const hasIntegrationEnv = env !== null;

/**
 * `describe` for integration suites — becomes `describe.skip` when the env is
 * absent, so unit-only runs (and CI without Supabase) stay green.
 */
export const describeIntegration = hasIntegrationEnv ? describe : describe.skip;

/**
 * Service-role client: bypasses RLS. Used for all assertions and teardown — fine
 * for Phase 1 (shape + not-found rules hold regardless of RLS; RLS is Phase 2).
 */
export const serviceClient: SupabaseClient<Database> | null = env
  ? createClient<Database>(env.url, env.serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

/** Service client, narrowed to non-null. Call inside `describeIntegration` blocks. */
export function requireServiceClient(): SupabaseClient<Database> {
  if (!serviceClient) throw new Error("integration env not configured");
  return serviceClient;
}

/**
 * Id of the dedicated seeding user. Use as `authorId` when inserting extra nodes
 * or relations directly (the FK `author_id → auth.users` needs a real user).
 * Call inside `describeIntegration` blocks.
 */
export function requireSeedingUserId(): string {
  const user = inject("seedingUser");
  if (!user) throw new Error("seeding user not provisioned (globalSetup did not run or env is absent)");
  return user.userId;
}

// Lazily sign the dedicated seeding user in once per worker, then reuse.
let seedingClientPromise: Promise<SupabaseClient<Database>> | null = null;

async function getSeedingClient(): Promise<SupabaseClient<Database>> {
  if (!env) throw new Error("integration env not configured");
  const user = inject("seedingUser");
  if (!user) throw new Error("seeding user not provisioned (globalSetup did not run or env is absent)");

  seedingClientPromise ??= (async () => {
    const client = createClient<Database>(env.url, env.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await client.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    });
    if (error) throw error;
    return client;
  })();

  return seedingClientPromise;
}

export interface SeededDebate {
  debateId: string;
  rootNodeId: string;
}

export interface SeedDebateInput {
  title?: string;
  rootTitle?: string;
  rootBody?: string;
}

/**
 * Seed a debate through the real `create_debate_with_root` RPC (as the seeding
 * user), then read back its root node id with the service client. Titles default
 * to `test-<uuid>` so a stray row is easy to spot and clean up.
 */
export async function seedDebate(input: SeedDebateInput = {}): Promise<SeededDebate> {
  if (!serviceClient) throw new Error("integration env not configured");
  const client = await getSeedingClient();

  const { data: debateId, error } = await client.rpc("create_debate_with_root", {
    p_title: input.title ?? `test-${randomUUID()}`,
    p_root_title: input.rootTitle ?? "Root claim",
    p_root_body: input.rootBody,
  });
  if (error) throw error;

  const { data: debate, error: readError } = await serviceClient
    .from("debates")
    .select("root_node_id")
    .eq("id", debateId)
    .single();
  if (readError) throw readError;
  if (!debate.root_node_id) throw new Error("seeded debate has no root_node_id");

  return { debateId, rootNodeId: debate.root_node_id };
}

/** Delete a seeded debate; `nodes` and `relations` cascade on `debate_id`. */
export async function cleanupDebate(debateId: string): Promise<void> {
  if (!serviceClient) return;
  const { error } = await serviceClient.from("debates").delete().eq("id", debateId);
  if (error) throw error;
}
