import { afterAll, beforeAll, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStatementNode } from "@/lib/debate/repository";
import { openExchange, respondToInvite } from "@/lib/exchange/repository";
import { upsertMark } from "@/lib/mark/repository";
import { getDivergenceSummary } from "@/lib/summary/repository";
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
import type { TestUser } from "./globalSetup";

type DB = SupabaseClient<Database>;

// Phase-4 boundary: the divergence summary read under real RLS. `getDivergenceSummary`
// returns the classified buckets for a member once the round gate is met, and `null`
// otherwise — both for an unmet gate and for a non-member (RLS-scoped out). The endpoint
// maps that `null` to 404 and the object to 200, so asserting the repository return value
// is the faithful integration check. Marks are inserted through the real RLS path (the
// challenger's accepted turn); the terminal/round state is then set with the service client
// so the test stays focused on the summary + gate rather than re-driving the turn machine
// (round-close is Phase 1's contract).
describeIntegration("S-04 divergence summary — gate + RLS read", () => {
  let service: DB;
  let advocateClient: DB;
  let challengerClient: DB;
  let advocateId: string;
  let challengerId: string;
  let outsider: TestUser;
  let outsiderClient: DB;

  const seededDebateIds: string[] = [];

  // Seed an advocate-owned debate with a Data and a Warrant statement, open an exchange,
  // have the challenger accept, and mark the three advocate statements through RLS:
  //   root claim  → agree    (common ground)
  //   data        → challenge (factual open divergence)
  //   warrant     → abstain   (unresolved)
  async function seedMarkedDebate(
    roundCount: number,
  ): Promise<{ debateId: string; rootNodeId: string; dataId: string; warrantId: string; exchangeId: string }> {
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

    const exchange = await openExchange(advocateClient, { debateId, challengerId, roundCount }, advocateId);
    await respondToInvite(challengerClient, exchange.id, true);

    await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: rootNodeId,
      markerId: challengerId,
      stance: "agree",
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

    return { debateId, rootNodeId, dataId: data.id, warrantId: warrant.id, exchangeId: exchange.id };
  }

  beforeAll(async () => {
    service = requireServiceClient();
    const advocate = requireSeedingUser();
    const challenger = requireChallengerUser();
    advocateId = advocate.userId;
    challengerId = challenger.userId;
    advocateClient = await getClientAsUser(advocate.email, advocate.password);
    challengerClient = await getClientAsUser(challenger.email, challenger.password);
    outsider = await createTestUser("summary-outsider");
    outsiderClient = await getClientAsUser(outsider.email, outsider.password);
  });

  afterAll(async () => {
    for (const id of seededDebateIds) await cleanupDebate(id);
    await deleteTestUser(outsider.userId);
  });

  it("returns null (→ 404) while the round gate is unmet (accepted, current_round=1)", async () => {
    const { debateId } = await seedMarkedDebate(2);
    // Fresh accepted round-1 exchange — no round has closed yet.
    expect(await getDivergenceSummary({ supabase: advocateClient, debateId })).toBeNull();
    expect(await getDivergenceSummary({ supabase: challengerClient, debateId })).toBeNull();
  });

  it("returns the classified buckets once an exchange is completed (round_count=1)", async () => {
    const { debateId, rootNodeId, dataId, warrantId, exchangeId } = await seedMarkedDebate(1);
    await service.from("exchanges").update({ status: "completed" }).eq("id", exchangeId);

    const summary = await getDivergenceSummary({ supabase: advocateClient, debateId });
    if (!summary) throw new Error("expected a summary on a completed exchange");
    expect(summary.commonGround.map((i) => i.id)).toEqual([rootNodeId]);
    expect(summary.openDivergences).toEqual([
      expect.objectContaining({ id: dataId, statementType: "data", gap: "factual" }),
    ]);
    expect(summary.unresolved.map((i) => i.id)).toEqual([warrantId]);
  });

  it("returns the buckets mid-exchange once current_round has advanced to 2", async () => {
    const { debateId, dataId, exchangeId } = await seedMarkedDebate(2);
    await service.from("exchanges").update({ current_round: 2 }).eq("id", exchangeId);

    const summary = await getDivergenceSummary({ supabase: challengerClient, debateId });
    if (!summary) throw new Error("expected a summary once current_round >= 2");
    expect(summary.openDivergences.map((i) => i.id)).toEqual([dataId]);
  });

  it("gives both parties the identical summary on a completed exchange", async () => {
    const { debateId, exchangeId } = await seedMarkedDebate(1);
    await service.from("exchanges").update({ status: "completed" }).eq("id", exchangeId);

    const asAdvocate = await getDivergenceSummary({ supabase: advocateClient, debateId });
    const asChallenger = await getDivergenceSummary({ supabase: challengerClient, debateId });
    expect(asAdvocate).toEqual(asChallenger);
  });

  it("returns null (→ 404) for a non-member, even on a completed exchange", async () => {
    const { debateId, exchangeId } = await seedMarkedDebate(1);
    await service.from("exchanges").update({ status: "completed" }).eq("id", exchangeId);

    // The outsider is neither advocate nor challenger — RLS scopes the exchange out entirely.
    expect(await getDivergenceSummary({ supabase: outsiderClient, debateId })).toBeNull();
  });
});
