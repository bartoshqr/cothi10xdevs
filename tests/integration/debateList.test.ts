import { afterAll, beforeAll, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listMyDebates } from "@/lib/debate/repository";
import type { Database } from "@/db/database.types";
import {
  cleanupDebate,
  createTestUser,
  deleteTestUser,
  describeIntegration,
  getClientAsUser,
  requireChallengerUser,
  requireSeedingUser,
  requireServiceClient,
  seedDebate,
} from "./helpers";

type DB = SupabaseClient<Database>;

describeIntegration("listMyDebates — role + state derivation", () => {
  let service: DB;
  let advocateClient: DB;
  let challengerClient: DB;
  let advocateId: string;
  let challengerId: string;

  const seededDebateIds: string[] = [];

  async function freshDebate() {
    const seeded = await seedDebate();
    seededDebateIds.push(seeded.debateId);
    return seeded;
  }

  async function insertExchange(
    debateId: string,
    status: "pending" | "accepted" | "declined" | "completed",
  ): Promise<string> {
    const { data, error } = await service
      .from("exchanges")
      .insert({
        debate_id: debateId,
        advocate_id: advocateId,
        challenger_id: challengerId,
        round_count: 3,
        status,
        responded_at: status === "pending" ? null : new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  beforeAll(async () => {
    service = requireServiceClient();
    const advocate = requireSeedingUser();
    const challenger = requireChallengerUser();
    advocateId = advocate.userId;
    challengerId = challenger.userId;
    advocateClient = await getClientAsUser(advocate.email, advocate.password);
    challengerClient = await getClientAsUser(challenger.email, challenger.password);
  });

  afterAll(async () => {
    for (const id of seededDebateIds) await cleanupDebate(id);
  });

  // ─── Advocate view ───────────────────────────────────────────────────────────

  it("advocate sees no-exchange debate as drafting", async () => {
    const { debateId } = await freshDebate();
    const rows = await listMyDebates(advocateClient, advocateId);
    const row = rows.find((r) => r.id === debateId);
    expect(row).toBeDefined();
    expect(row?.role).toBe("advocate");
    expect(row?.state).toBe("drafting");
    expect(row?.other_username).toBeNull();
  });

  it("advocate sees pending exchange as awaiting with challenger username", async () => {
    const { debateId } = await freshDebate();
    await insertExchange(debateId, "pending");
    const rows = await listMyDebates(advocateClient, advocateId);
    const row = rows.find((r) => r.id === debateId);
    expect(row?.role).toBe("advocate");
    expect(row?.state).toBe("awaiting");
    expect(row?.other_username).toBeTruthy();
  });

  it("advocate sees accepted exchange as in_progress with challenger username", async () => {
    const { debateId } = await freshDebate();
    await insertExchange(debateId, "accepted");
    const rows = await listMyDebates(advocateClient, advocateId);
    const row = rows.find((r) => r.id === debateId);
    expect(row?.role).toBe("advocate");
    expect(row?.state).toBe("in_progress");
    expect(row?.other_username).toBeTruthy();
  });

  it("advocate sees completed exchange as closed", async () => {
    const { debateId } = await freshDebate();
    await insertExchange(debateId, "completed");
    const rows = await listMyDebates(advocateClient, advocateId);
    const row = rows.find((r) => r.id === debateId);
    expect(row?.role).toBe("advocate");
    expect(row?.state).toBe("closed");
  });

  it("advocate sees declined-only debate as drafting", async () => {
    const { debateId } = await freshDebate();
    await insertExchange(debateId, "declined");
    const rows = await listMyDebates(advocateClient, advocateId);
    const row = rows.find((r) => r.id === debateId);
    expect(row?.role).toBe("advocate");
    expect(row?.state).toBe("drafting");
  });

  // ─── Challenger view ──────────────────────────────────────────────────────────

  it("challenger sees accepted exchange as in_progress with advocate username", async () => {
    const { debateId } = await freshDebate();
    await insertExchange(debateId, "accepted");
    const rows = await listMyDebates(challengerClient, challengerId);
    const row = rows.find((r) => r.id === debateId);
    expect(row).toBeDefined();
    expect(row?.role).toBe("challenger");
    expect(row?.state).toBe("in_progress");
    expect(row?.other_username).toBeTruthy();
  });

  it("challenger sees pending exchange as awaiting", async () => {
    const { debateId } = await freshDebate();
    await insertExchange(debateId, "pending");
    const rows = await listMyDebates(challengerClient, challengerId);
    const row = rows.find((r) => r.id === debateId);
    expect(row?.role).toBe("challenger");
    expect(row?.state).toBe("awaiting");
  });

  it("challenger sees completed exchange as closed", async () => {
    const { debateId } = await freshDebate();
    await insertExchange(debateId, "completed");
    const rows = await listMyDebates(challengerClient, challengerId);
    const row = rows.find((r) => r.id === debateId);
    expect(row?.role).toBe("challenger");
    expect(row?.state).toBe("closed");
  });

  it("challenger does NOT see advocate's declined exchange", async () => {
    const { debateId } = await freshDebate();
    await insertExchange(debateId, "declined");
    const rows = await listMyDebates(challengerClient, challengerId);
    const row = rows.find((r) => r.id === debateId);
    // RLS excludes declined from challenger's view
    expect(row).toBeUndefined();
  });

  it("challenger does NOT see advocate-only drafts (no exchange)", async () => {
    const { debateId } = await freshDebate();
    // No exchange — advocate's draft, never visible to challenger
    const rows = await listMyDebates(challengerClient, challengerId);
    const row = rows.find((r) => r.id === debateId);
    expect(row).toBeUndefined();
  });

  // ─── Non-participant / published-debate regression ────────────────────────────
  //
  // `debates_select_authenticated_public` (migration 20260624000002) grants every
  // authenticated user read access to any PUBLISHED debate, for the showcase
  // listing. That widened `debates` visibility without a matching narrowing in
  // `listMyDebates`, which used to infer role from RLS visibility alone
  // ("not owner => challenger"). Result: publishing a debate made it appear under
  // "As challenger" for every signed-in user, invited or not. These tests pin the
  // fix — a non-participant must never appear in either list, published or not.

  it("a never-invited outsider does NOT see a published debate with no exchange at all", async () => {
    const { debateId } = await freshDebate();
    await service.from("debates").update({ public: true, published_at: new Date().toISOString() }).eq("id", debateId);

    const outsider = await createTestUser("debate-list-outsider");
    try {
      const outsiderClient = await getClientAsUser(outsider.email, outsider.password);
      const rows = await listMyDebates(outsiderClient, outsider.userId);
      const row = rows.find((r) => r.id === debateId);
      expect(row).toBeUndefined();
    } finally {
      await deleteTestUser(outsider.userId);
    }
  });

  it("a never-invited outsider does NOT see a published debate that has an exchange with someone else", async () => {
    const { debateId } = await freshDebate();
    await insertExchange(debateId, "accepted");
    await service.from("debates").update({ public: true, published_at: new Date().toISOString() }).eq("id", debateId);

    const outsider = await createTestUser("debate-list-outsider-exchange");
    try {
      const outsiderClient = await getClientAsUser(outsider.email, outsider.password);
      const rows = await listMyDebates(outsiderClient, outsider.userId);
      const row = rows.find((r) => r.id === debateId);
      // Bug reproduction: this used to come back with role "challenger" even though
      // the outsider was never invited — the debate's actual challenger is `challengerId`.
      expect(row).toBeUndefined();
    } finally {
      await deleteTestUser(outsider.userId);
    }
  });

  it("the real challenger still sees the debate as challenger even after it's published", async () => {
    const { debateId } = await freshDebate();
    await insertExchange(debateId, "accepted");
    await service.from("debates").update({ public: true, published_at: new Date().toISOString() }).eq("id", debateId);

    const rows = await listMyDebates(challengerClient, challengerId);
    const row = rows.find((r) => r.id === debateId);
    expect(row?.role).toBe("challenger");
    expect(row?.state).toBe("in_progress");
  });
});
