import { afterAll, beforeAll, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStatementNode } from "@/lib/debate/repository";
import { openExchange, respondToInvite } from "@/lib/exchange/repository";
import { upsertMark } from "@/lib/mark/repository";
import { getDivergenceSummary } from "@/lib/summary/repository";
import type { Database } from "@/db/database.types";
import {
  anonClient,
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
import type { TestUser } from "./globalSetup";

type DB = SupabaseClient<Database>;

// S-09 Risk #1 (IDOR / private-pair leak): the anon read path must expose ONLY
// rows reachable from a `public = true` debate. Every assertion below runs as a
// truly-anonymous client (anon key, no sign-in → PostgREST `anon` role). Seed two
// fully-built, completed debates — one published, one not — and prove:
//   - the UNPUBLISHED debate returns ZERO anon rows on all five tables, including
//     direct-by-debate_id child enumeration (the IDOR path);
//   - the PUBLISHED debate returns exactly its own rows + a non-null summary.
// The zero-row assertions double as drift guards: a child policy that dropped the
// `public = true` gate (or used `using (true)`) would surface here as the
// unpublished debate leaking.
describeIntegration("S-09 anon showcase read path — leak-free invariant (Risk #1)", () => {
  let service: DB;
  let advocateClient: DB;
  let challengerClient: DB;
  let advocateId: string;
  let challengerId: string;
  let anon: DB;

  const seededDebateIds: string[] = [];

  // Build a completed (round_count=1) debate with two extra statements, an accepted
  // exchange, and three challenger marks — the same shape summary.test.ts uses.
  async function seedCompletedDebate(): Promise<{ debateId: string; exchangeId: string }> {
    const { debateId, rootNodeId } = await seedDebate();
    seededDebateIds.push(debateId);

    const data = await createStatementNode(
      service,
      {
        nodeKind: "statement",
        debateId,
        statementType: "data",
        title: "Traffic fell 40%",
        positionX: 50,
        positionY: 50,
      },
      advocateId,
    );
    const warrant = await createStatementNode(
      service,
      {
        nodeKind: "statement",
        debateId,
        statementType: "warrant",
        title: "Less traffic is better",
        positionX: 50,
        positionY: 150,
      },
      advocateId,
    );

    // A relation so the relations table has at least one row to (not) leak.
    const { error: relErr } = await service.from("relations").insert({
      debate_id: debateId,
      author_id: advocateId,
      source_node_id: data.id,
      target_node_id: rootNodeId,
      kind: "supports",
    });
    if (relErr) throw relErr;

    const exchange = await openExchange(advocateClient, { debateId, challengerId, roundCount: 1 }, advocateId);
    await respondToInvite(challengerClient, exchange.id, true);

    await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: rootNodeId,
      markerId: challengerId,
      stance: "accept",
    });
    await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: data.id,
      markerId: challengerId,
      stance: "challenge",
    });
    await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: warrant.id,
      markerId: challengerId,
      stance: "abstain",
    });

    // Complete the round so the divergence summary gate is met.
    await service.from("exchanges").update({ status: "completed" }).eq("id", exchange.id);

    return { debateId, exchangeId: exchange.id };
  }

  let publishedId: string;
  let unpublishedId: string;
  let outsider: TestUser;

  beforeAll(async () => {
    service = requireServiceClient();
    const advocate = requireSeedingUser();
    const challenger = requireChallengerUser();
    advocateId = advocate.userId;
    challengerId = challenger.userId;
    advocateClient = await getClientAsUser(advocate.email, advocate.password);
    challengerClient = await getClientAsUser(challenger.email, challenger.password);
    anon = anonClient();
    // An outsider participating in NO public debate — their profile must stay hidden.
    outsider = await createTestUser("showcase-outsider");

    ({ debateId: publishedId } = await seedCompletedDebate());
    ({ debateId: unpublishedId } = await seedCompletedDebate());

    // Publish exactly one of them.
    const { error } = await service
      .from("debates")
      .update({ public: true, published_at: new Date().toISOString() })
      .eq("id", publishedId);
    if (error) throw error;
  });

  afterAll(async () => {
    for (const id of seededDebateIds) await cleanupDebate(id);
    await deleteTestUser(outsider.userId);
  });

  const childTables = ["nodes", "relations", "marks", "exchanges"] as const;

  it("anon sees ZERO rows for the unpublished debate across all five tables", async () => {
    const { data: debateRows, error: dErr } = await anon.from("debates").select("id").eq("id", unpublishedId);
    if (dErr) throw dErr;
    expect(debateRows).toEqual([]);

    // Direct-by-debate_id enumeration on each child — the classic IDOR path.
    for (const tbl of childTables) {
      const { data, error } = await anon.from(tbl).select("id").eq("debate_id", unpublishedId);
      if (error) throw error;
      expect(data, `${tbl} leaked rows for the unpublished debate`).toEqual([]);
    }
  });

  it("anon summary for the unpublished debate is null (RLS-scoped out)", async () => {
    expect(await getDivergenceSummary({ supabase: anon, debateId: unpublishedId })).toBeNull();
  });

  it("anon sees exactly the published debate's own rows on all five tables", async () => {
    const { data: debateRows, error: dErr } = await anon.from("debates").select("id").eq("id", publishedId);
    if (dErr) throw dErr;
    expect(debateRows).toEqual([{ id: publishedId }]);

    // Each child returns a positive row count equal to what the service client
    // (RLS-bypassing) sees for the same debate — no over- or under-exposure.
    for (const tbl of childTables) {
      const anonRes = await anon.from(tbl).select("id").eq("debate_id", publishedId);
      if (anonRes.error) throw anonRes.error;
      const svcRes = await service.from(tbl).select("id").eq("debate_id", publishedId);
      if (svcRes.error) throw svcRes.error;
      expect(anonRes.data.length, `${tbl} count`).toBeGreaterThan(0);
      expect(anonRes.data.length, `${tbl} anon vs service count`).toBe(svcRes.data.length);
    }
  });

  it("anon reads participant usernames only for public-debate members", async () => {
    // Advocate + challenger of the published debate → readable (drives the summary's
    // username resolution).
    const { data: members, error: mErr } = await anon
      .from("profiles")
      .select("id")
      .in("id", [advocateId, challengerId]);
    if (mErr) throw mErr;
    expect(new Set(members.map((p) => p.id))).toEqual(new Set([advocateId, challengerId]));

    // A user in no public debate → not anon-readable.
    const { data: hidden, error: hErr } = await anon.from("profiles").select("id").eq("id", outsider.userId);
    if (hErr) throw hErr;
    expect(hidden).toEqual([]);
  });

  it("anon summary for the published debate is non-null", async () => {
    const summary = await getDivergenceSummary({ supabase: anon, debateId: publishedId });
    if (!summary) throw new Error("expected a non-null summary on a published, completed debate");
    expect(summary.commonGround.length + summary.openDivergences.length + summary.unresolved.length).toBeGreaterThan(0);
  });
});
