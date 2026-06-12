import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConnectiveNode, createRelation, createStatementNode } from "@/lib/debate/repository";
import { openExchange, respondToInvite, submitTurn } from "@/lib/exchange/repository";
import { upsertMark } from "@/lib/mark/repository";
import { ConflictError, NotFoundError } from "@/lib/errors";
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

// S-03 integrity boundaries, asserted against real RLS/DB — the only layer that
// catches the two regressions this slice guards: the 42P17 cross-table recursion
// (broken by the can_write_as_current_actor / is_accepted_challenger SECURITY
// DEFINER helpers) and the SETOF-not-found contract on submit_turn. Two real auth
// users (advocate = debate owner, challenger = invited) + the service client for
// seeding/assertions. The challenger client is subject to RLS exactly as the app.
describeIntegration("S-03 marks & turn submission — RLS write boundaries + gate", () => {
  let service: DB;
  let advocateClient: DB;
  let challengerClient: DB;
  let advocateId: string;
  let challengerId: string;

  const seededDebateIds: string[] = [];

  // Seed a debate (owned by the advocate), open an exchange, and have the
  // challenger accept it — landing at status='accepted', current_turn='challenger'.
  // Returns the ids plus the root node (an advocate-authored statement).
  async function freshAcceptedDebate(): Promise<{ debateId: string; rootNodeId: string; exchangeId: string }> {
    const { debateId, rootNodeId } = await seedDebate();
    seededDebateIds.push(debateId);
    const exchange = await openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId);
    await respondToInvite(challengerClient, exchange.id, true);
    return { debateId, rootNodeId, exchangeId: exchange.id };
  }

  // Add an advocate-authored statement via the service client (bypasses RLS — pure
  // seeding). These are the nodes the challenger must mark before submitting.
  async function addAdvocateStatement(debateId: string, title: string): Promise<string> {
    const node = await createStatementNode(
      service,
      { nodeKind: "statement", debateId, statementType: "data", title, positionX: 50, positionY: 50 },
      advocateId,
    );
    return node.id;
  }

  // Add an advocate-authored connective (AND) via the service client.
  async function addAdvocateConnective(debateId: string): Promise<string> {
    const node = await createConnectiveNode(
      service,
      { nodeKind: "connective", debateId, connectiveOp: "and", positionX: 0, positionY: 0 },
      advocateId,
    );
    return node.id;
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

  // ─── Write permissions: challenger adds own content, cannot edit advocate's ──

  it("accepted challenger can INSERT a node/relation but cannot UPDATE or DELETE advocate content", async () => {
    const { debateId, rootNodeId } = await freshAcceptedDebate();

    // Challenger inserts their own statement on their turn — RLS branch 2 allows it.
    const myNode = await createStatementNode(
      challengerClient,
      {
        nodeKind: "statement",
        debateId,
        statementType: "claim",
        title: "challenger claim",
        positionX: 200,
        positionY: 200,
      },
      challengerId,
    );
    expect(myNode.author_id).toBe(challengerId);

    // …and a relation drawn FROM their own node TO the advocate's root.
    const myRelation = await createRelation(
      challengerClient,
      { debateId, sourceNodeId: myNode.id, targetNodeId: rootNodeId, kind: "supports" },
      challengerId,
    );
    expect(myRelation.author_id).toBe(challengerId);

    // Cannot UPDATE the advocate's root node — author_id = uid() USING filters it out (0 rows).
    const updateNode = await challengerClient
      .from("nodes")
      .update({ metadata: { title: "hacked" } })
      .eq("id", rootNodeId)
      .select("id");
    expect(updateNode.data ?? []).toHaveLength(0);

    // Cannot DELETE the advocate's root node either.
    const deleteNode = await challengerClient.from("nodes").delete().eq("id", rootNodeId).select("id");
    expect(deleteNode.data ?? []).toHaveLength(0);

    // Seed an advocate-authored relation, then prove the challenger cannot edit/delete it.
    const advStatement = await addAdvocateStatement(debateId, "advocate datum");
    const advRelation = await createRelation(
      service,
      { debateId, sourceNodeId: advStatement, targetNodeId: rootNodeId, kind: "supports" },
      advocateId,
    );
    const updateRel = await challengerClient
      .from("relations")
      .update({ kind: "rebuts" })
      .eq("id", advRelation.id)
      .select("id");
    expect(updateRel.data ?? []).toHaveLength(0);
    const deleteRel = await challengerClient.from("relations").delete().eq("id", advRelation.id).select("id");
    expect(deleteRel.data ?? []).toHaveLength(0);
  });

  // ─── Mark scope: only the other party's STATEMENT nodes are markable ─────────

  it("challenger can mark an advocate statement, but not a connective and not their own node", async () => {
    const { debateId, rootNodeId } = await freshAcceptedDebate();

    // Mark the advocate's root statement — allowed (other-party statement, my turn).
    const mark = await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: rootNodeId,
      markerId: challengerId,
      stance: "accept",
    });
    expect(mark.stance).toBe("accept");
    expect(mark.marker_id).toBe(challengerId);

    // Re-marking is idempotent — stance flips in place, still one row.
    const reMark = await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: rootNodeId,
      markerId: challengerId,
      stance: "challenge",
    });
    expect(reMark.stance).toBe("challenge");
    expect(reMark.id).toBe(mark.id);

    // A connective node carries no mark — RLS kind='statement' check rejects it (F3).
    const connectiveId = await addAdvocateConnective(debateId);
    const connectiveMark = await challengerClient
      .from("marks")
      .insert({ debate_id: debateId, node_id: connectiveId, marker_id: challengerId, stance: "accept" })
      .select("id");
    expect(connectiveMark.error).not.toBeNull();

    // Marking your own node is rejected — RLS author_id <> uid() check.
    const myNode = await createStatementNode(
      challengerClient,
      { nodeKind: "statement", debateId, statementType: "claim", title: "mine", positionX: 300, positionY: 300 },
      challengerId,
    );
    const ownMark = await challengerClient
      .from("marks")
      .insert({ debate_id: debateId, node_id: myNode.id, marker_id: challengerId, stance: "accept" })
      .select("id");
    expect(ownMark.error).not.toBeNull();
  });

  // ─── Turn gate (F1): off-turn writes are RLS-rejected, not just UI-locked ────

  it("after submit_turn flips to 'advocate', the challenger can no longer INSERT a node or upsert a mark", async () => {
    const { debateId, rootNodeId, exchangeId } = await freshAcceptedDebate();

    // Mark every advocate statement (just the root here), then submit → turn flips.
    await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: rootNodeId,
      markerId: challengerId,
      stance: "accept",
    });
    const flipped = await submitTurn(challengerClient, exchangeId);
    expect(flipped.current_turn).toBe("advocate");

    // Off-turn: challenger node INSERT is rejected by can_write_as_current_actor.
    const offTurnInsert = await challengerClient
      .from("nodes")
      .insert({ debate_id: debateId, author_id: challengerId, kind: "statement", metadata: { title: "late" } })
      .select("id");
    expect(offTurnInsert.error).not.toBeNull();

    // Off-turn: re-marking is also rejected (can_write_as_current_actor false).
    const offTurnMark = await challengerClient
      .from("marks")
      .update({ stance: "challenge" })
      .eq("node_id", rootNodeId)
      .eq("marker_id", challengerId)
      .select("id");
    expect(offTurnMark.data ?? []).toHaveLength(0);
  });

  // ─── submit_turn gate: incomplete → fail; complete → flip ────────────────────

  it("submit_turn rejects an incomplete mark set and flips the turn once every advocate statement is marked", async () => {
    const { debateId, rootNodeId, exchangeId } = await freshAcceptedDebate();
    const secondStatement = await addAdvocateStatement(debateId, "second advocate statement");

    // Mark only one of the two advocate statements → gate fails (ConflictError, P0001).
    await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: rootNodeId,
      markerId: challengerId,
      stance: "accept",
    });
    await expect(submitTurn(challengerClient, exchangeId)).rejects.toBeInstanceOf(ConflictError);

    // Turn is unchanged — still the challenger's.
    const { data: stillChallenger } = await service
      .from("exchanges")
      .select("current_turn")
      .eq("id", exchangeId)
      .single();
    expect(stillChallenger?.current_turn).toBe("challenger");

    // Mark the second statement, then submit → flips to the advocate.
    await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: secondStatement,
      markerId: challengerId,
      stance: "abstain",
    });
    const result = await submitTurn(challengerClient, exchangeId);
    expect(result.current_turn).toBe("advocate");
  });

  // ─── SETOF not-found: unknown exchange id → empty set → NotFoundError ─────────

  it("submit_turn on an unknown exchange id returns an empty set (→ 404), not an all-NULL row", async () => {
    await expect(submitTurn(challengerClient, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  // ─── getDebateMarks includes the valid field ──────────────────────────────────

  it("getDebateMarks returns a MarkState with valid=true for a freshly placed mark", async () => {
    const { getDebateMarks } = await import("@/lib/mark/repository");
    const { debateId, rootNodeId } = await freshAcceptedDebate();

    await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: rootNodeId,
      markerId: challengerId,
      stance: "accept",
    });

    const marks = await getDebateMarks({ supabase: challengerClient, debateId });
    expect(marks[rootNodeId]).toEqual({ stance: "accept", valid: true });
  });

  // ─── re-evaluation revalidates an invalidated mark (S-05) ──────────────────────
  // Regression: a mark the counterpart invalidated (valid=false) must flip back to
  // valid=true when the marker re-evaluates it. The submit_turn gate counts only
  // valid=true marks, so without this the server keeps rejecting a turn the UI shows
  // as complete (INCOMPLETE_MARKS: N-1 of N).
  it("upsertMark revalidates a previously-invalidated mark (valid=false → valid=true)", async () => {
    const { getDebateMarks } = await import("@/lib/mark/repository");
    const { debateId, rootNodeId } = await freshAcceptedDebate();

    // Place the mark, then simulate the counterpart's edit invalidating it.
    await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: rootNodeId,
      markerId: challengerId,
      stance: "accept",
    });
    await service.from("marks").update({ valid: false }).eq("node_id", rootNodeId).eq("marker_id", challengerId);

    const stale = await getDebateMarks({ supabase: challengerClient, debateId });
    expect(stale[rootNodeId]).toEqual({ stance: "accept", valid: false });

    // Re-evaluate: same or different stance, the row must become valid again.
    await upsertMark({
      supabase: challengerClient,
      debateId,
      nodeId: rootNodeId,
      markerId: challengerId,
      stance: "challenge",
    });

    const revalidated = await getDebateMarks({ supabase: challengerClient, debateId });
    expect(revalidated[rootNodeId]).toEqual({ stance: "challenge", valid: true });
  });
});
