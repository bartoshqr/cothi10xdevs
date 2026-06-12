import { afterAll, beforeAll, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStatementNode } from "@/lib/debate/repository";
import { openExchange, respondToInvite } from "@/lib/exchange/repository";
import { upsertMark } from "@/lib/mark/repository";
import type { Database } from "@/db/database.types";
import {
  cleanupDebate,
  describeIntegration,
  getClientAsUser,
  requireChallengerUser,
  requireSeedingUser,
  requireServiceClient,
  seedDebate,
} from "./helpers";

type DB = SupabaseClient<Database>;

// S-04 write-immutability + mini-turn boundaries, asserted against real RLS — the only
// layer that proves them (lint/build/happy-path never see an out-of-turn write). These
// behaviors were pulled forward into Phase 1 (mini-turn freeze, lock on 'pending', full
// immutability on 'completed') and the plan epilogue flagged them as test-gaps. Each case
// drives the exchange to the relevant state with the service client (RLS-bypassing seeding,
// the same precedent summary.test.ts uses) and then exercises the boundary through the
// RLS-bound anon client, exactly as the app does. Rejected INSERTs surface `.error`
// non-null (WITH CHECK violation); USING-filtered UPDATE/DELETE return zero rows.
describeIntegration("S-04 write-immutability + mini-turn — RLS write boundaries", () => {
  let service: DB;
  let advocateClient: DB;
  let challengerClient: DB;
  let advocateId: string;
  let challengerId: string;

  const seededDebateIds: string[] = [];

  // Raw challenger node INSERT through the RLS-bound client — returns `.error` rather than
  // throwing, so the rejection is assertable (createStatementNode would throw on the error).
  function rawInsertNode(client: DB, debateId: string, authorId: string) {
    return client
      .from("nodes")
      .insert({
        debate_id: debateId,
        author_id: authorId,
        kind: "statement",
        position_x: 400,
        position_y: 400,
        metadata: { statement_type: "claim", title: "should be rejected", body: null, url: null },
      })
      .select("id");
  }

  // Seed an advocate-owned debate with one advocate statement, open a round_count=1
  // exchange, and have the challenger accept — the common starting point for each case.
  async function seedAcceptedSingleRound(): Promise<{ debateId: string; advStatementId: string; exchangeId: string }> {
    const { debateId } = await seedDebate();
    seededDebateIds.push(debateId);
    const advStatement = await createStatementNode(
      service,
      { nodeKind: "statement", debateId, statementType: "data", title: "advocate datum", positionX: 50, positionY: 50 },
      advocateId,
    );
    const exchange = await openExchange(advocateClient, { debateId, challengerId, roundCount: 1 }, advocateId);
    await respondToInvite(challengerClient, exchange.id, true);
    return { debateId, advStatementId: advStatement.id, exchangeId: exchange.id };
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

  it("freezes the challenger's content writes during the mini-turn, but still allows marking", async () => {
    const { debateId, advStatementId, exchangeId } = await seedAcceptedSingleRound();
    // Drive the closing mini-turn directly: it is the challenger's turn AND in_mini_turn.
    await service.from("exchanges").update({ current_turn: "challenger", in_mini_turn: true }).eq("id", exchangeId);

    // can_add_content_as_current_actor excludes the challenger while in_mini_turn → INSERT rejected.
    const offTurnInsert = await rawInsertNode(challengerClient, debateId, challengerId);
    expect(offTurnInsert.error).not.toBeNull();

    // Marks keep can_write_as_current_actor (no mini-turn check) → the challenger can still mark.
    const mark = await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: advStatementId,
      markerId: challengerId,
      stance: "accept",
    });
    expect(mark.stance).toBe("accept");
  });

  it("makes a completed exchange fully immutable — neither party can add content", async () => {
    const { debateId, exchangeId } = await seedAcceptedSingleRound();
    await service.from("exchanges").update({ status: "completed", in_mini_turn: false }).eq("id", exchangeId);

    // Branch 1 (pre-exchange owner) is shut off by the existing exchange; branch 2's helper
    // requires status='accepted'. So BOTH the challenger and the owner-advocate are rejected.
    const challengerInsert = await rawInsertNode(challengerClient, debateId, challengerId);
    expect(challengerInsert.error).not.toBeNull();

    const advocateInsert = await rawInsertNode(advocateClient, debateId, advocateId);
    expect(advocateInsert.error).not.toBeNull();
  });

  it("locks the owner out of editing the map once an invite is pending", async () => {
    const { debateId } = await seedDebate();
    seededDebateIds.push(debateId);

    // Pre-invite: branch 1 lets the owner build the map freely.
    const preInvite = await createStatementNode(
      advocateClient,
      { nodeKind: "statement", debateId, statementType: "claim", title: "pre-invite", positionX: 10, positionY: 10 },
      advocateId,
    );
    expect(preInvite.author_id).toBe(advocateId);

    // Invite a challenger → status='pending'. Branch 1 now fails (an exchange exists) and
    // branch 2 needs status='accepted', so the owner can no longer edit the basis map.
    await openExchange(advocateClient, { debateId, challengerId, roundCount: 1 }, advocateId);
    const pendingInsert = await rawInsertNode(advocateClient, debateId, advocateId);
    expect(pendingInsert.error).not.toBeNull();
  });
});
