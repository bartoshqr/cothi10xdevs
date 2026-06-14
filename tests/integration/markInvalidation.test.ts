import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStatementNode, updateNode } from "@/lib/debate/repository";
import { openExchange, respondToInvite, submitTurn } from "@/lib/exchange/repository";
import { upsertMark } from "@/lib/mark/repository";
import { NotFoundError } from "@/lib/errors";
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

// S-05 Phase 1: mark invalidation via patch_node_and_invalidate.
// Verifies the SECURITY DEFINER flip against real RLS — the only layer that can
// assert the cross-table write (author flips counterpart's marks) works correctly.
describeIntegration("S-05 mark invalidation on node edit", () => {
  let service: DB;
  let advocateClient: DB;
  let challengerClient: DB;
  let advocateId: string;
  let challengerId: string;

  const seededDebateIds: string[] = [];

  // Seed a debate, open an exchange, challenger accepts.
  // Returns with current_turn='challenger'.
  async function freshAcceptedDebate() {
    const { debateId, rootNodeId } = await seedDebate();
    seededDebateIds.push(debateId);
    const exchange = await openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId);
    await respondToInvite(challengerClient, exchange.id, true);
    return { debateId, rootNodeId, exchangeId: exchange.id };
  }

  // Mark the root node and submit the challenger's turn → current_turn='advocate'.
  async function challengerMarkAndSubmit(debateId: string, rootNodeId: string, exchangeId: string) {
    await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: rootNodeId,
      markerId: challengerId,
      stance: "accept",
    });
    await submitTurn(challengerClient, exchangeId);
  }

  // Read a mark row via the service client (bypasses RLS for assertion).
  async function getMark(nodeId: string) {
    const { data, error } = await service.from("marks").select("id, stance, valid").eq("node_id", nodeId).maybeSingle();
    if (error) throw error;
    return data;
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

  // ─── Happy path: content edit flips mark to valid = false ───────────────────

  it("advocate content edit flips challenger's mark to valid = false", async () => {
    const { debateId, rootNodeId, exchangeId } = await freshAcceptedDebate();
    await challengerMarkAndSubmit(debateId, rootNodeId, exchangeId);

    const before = await getMark(rootNodeId);
    if (before === null) throw new Error("expected mark to exist before edit");
    expect(before.valid).toBe(true);
    expect(before.stance).toBe("accept");

    await updateNode(advocateClient, rootNodeId, { title: "Edited title" });

    const after = await getMark(rootNodeId);
    if (after === null) throw new Error("expected mark to exist after edit");
    expect(after.id).toBe(before.id);
    expect(after.valid).toBe(false);
    expect(after.stance).toBe("accept");
  });

  // ─── Position-only patch does NOT invalidate ─────────────────────────────────

  it("position-only patch does not flip valid", async () => {
    const { debateId, rootNodeId, exchangeId } = await freshAcceptedDebate();
    await challengerMarkAndSubmit(debateId, rootNodeId, exchangeId);

    const before = await getMark(rootNodeId);
    if (before === null) throw new Error("expected mark to exist");
    expect(before.valid).toBe(true);

    await updateNode(advocateClient, rootNodeId, { positionX: 999, positionY: 999 });

    const after = await getMark(rootNodeId);
    if (after === null) throw new Error("expected mark to still exist after position patch");
    expect(after.valid).toBe(true);
  });

  // ─── Identical content re-save does NOT invalidate ───────────────────────────

  it("identical content re-save does not flip valid", async () => {
    const { debateId, rootNodeId, exchangeId } = await freshAcceptedDebate();
    await challengerMarkAndSubmit(debateId, rootNodeId, exchangeId);

    const { data: node, error } = await service.from("nodes").select("metadata").eq("id", rootNodeId).single();
    if (error) throw error;
    const currentTitle = (node.metadata as Record<string, unknown>).title as string;

    const before = await getMark(rootNodeId);
    if (before === null) throw new Error("expected mark to exist");
    expect(before.valid).toBe(true);

    await updateNode(advocateClient, rootNodeId, { title: currentTitle });

    const after = await getMark(rootNodeId);
    if (after === null) throw new Error("expected mark to still exist after identical re-save");
    expect(after.valid).toBe(true);
  });

  // ─── Off-turn edit → empty set → NotFoundError ───────────────────────────────

  it("challenger editing their own node on the advocate's turn returns NotFoundError", async () => {
    const { debateId, exchangeId } = await freshAcceptedDebate();

    const myNode = await createStatementNode(
      challengerClient,
      {
        nodeKind: "statement",
        debateId,
        statementType: "claim",
        title: "challenger claim",
        positionX: 0,
        positionY: 0,
      },
      challengerId,
    );

    const { data: debate, error } = await service.from("debates").select("root_node_id").eq("id", debateId).single();
    if (error) throw error;
    if (!debate.root_node_id) throw new Error("debate has no root_node_id");
    await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: debate.root_node_id,
      markerId: challengerId,
      stance: "accept",
    });
    await submitTurn(challengerClient, exchangeId);

    await expect(updateNode(challengerClient, myNode.id, { title: "attempted edit" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  // ─── Wrong-author edit → empty set → NotFoundError ───────────────────────────

  it("challenger editing the advocate's root node (wrong author) returns NotFoundError", async () => {
    const { rootNodeId } = await freshAcceptedDebate();

    await expect(updateNode(challengerClient, rootNodeId, { title: "hijack" })).rejects.toBeInstanceOf(NotFoundError);
  });

  // ─── Unknown node id → empty set → NotFoundError ─────────────────────────────

  it("unknown node id returns NotFoundError", async () => {
    await expect(updateNode(advocateClient, randomUUID(), { title: "ghost" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
