import { afterAll, beforeAll, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConnectiveNode, createRelation, createStatementNode } from "@/lib/debate/repository";
import { openExchange, respondToInvite, revokeInvite } from "@/lib/exchange/repository";
import { searchUsersByUsername } from "@/lib/users";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
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

// S-02 integrity boundaries: the FR-007 two-part open gate, the widened RLS
// read predicate (pending grants READ, never WRITE), the invite lifecycle
// (self-invite/duplicate/respond), and the Phase-4.5 advocate revoke. These run
// against local Supabase with two real auth users + an anon-key as-user client
// so RLS applies exactly as in the app (the service client bypasses RLS and is
// used only for seeding/assertions).
describeIntegration("S-02 exchange — gate, RLS pair-visibility, invite lifecycle", () => {
  let service: DB;
  let advocateClient: DB; // owner of seeded debates
  let challengerClient: DB; // the invited second user
  let outsiderClient: DB; // a third, never-invited user
  let advocateId: string;
  let challengerId: string;
  let outsiderId: string;

  const seededDebateIds: string[] = [];

  // Seed a debate (owned by the advocate) and remember it for teardown.
  async function freshDebate(): Promise<{ debateId: string; rootNodeId: string }> {
    const seeded = await seedDebate();
    seededDebateIds.push(seeded.debateId);
    return seeded;
  }

  // Add a connective with `operandCount` inbound link operands to a debate.
  async function addConnectiveWithOperands(debateId: string, operandCount: number): Promise<string> {
    const connective = await createConnectiveNode(
      service,
      { nodeKind: "connective", debateId, connectiveOp: "and", positionX: 0, positionY: 0 },
      advocateId,
    );
    for (let i = 0; i < operandCount; i++) {
      const operand = await createStatementNode(
        service,
        { nodeKind: "statement", debateId, statementType: "claim", title: `op${i}`, positionX: 10 + i, positionY: 10 },
        advocateId,
      );
      await createRelation(
        service,
        { debateId, sourceNodeId: operand.id, targetNodeId: connective.id, kind: "link" },
        advocateId,
      );
    }
    return connective.id;
  }

  beforeAll(async () => {
    service = requireServiceClient();
    const advocate = requireSeedingUser();
    const challenger = requireChallengerUser();
    advocateId = advocate.userId;
    challengerId = challenger.userId;
    advocateClient = await getClientAsUser(advocate.email, advocate.password);
    challengerClient = await getClientAsUser(challenger.email, challenger.password);

    // A third user that is never a participant in any exchange.
    const outsider = await createTestUser("test-outsider");
    outsiderId = outsider.userId;
    outsiderClient = await getClientAsUser(outsider.email, outsider.password);
  });

  afterAll(async () => {
    for (const id of seededDebateIds) await cleanupDebate(id);
    if (outsiderId) await deleteTestUser(outsiderId);
  });

  // ─── FR-007 gate part 1: root claim must exist ──────────────────────────────

  it("rejects opening on a rootless debate (gate part 1) and accepts once a root exists", async () => {
    // A rootless debate can only be created by a direct service insert — the real
    // create_debate_with_root RPC always sets the root. This is the integrity hole
    // the gate guards.
    const { data: rootless, error } = await service
      .from("debates")
      .insert({ owner_id: advocateId, title: "rootless", root_node_id: null })
      .select("id")
      .single();
    if (error) throw error;
    seededDebateIds.push(rootless.id);

    await expect(
      openExchange(advocateClient, { debateId: rootless.id, challengerId, roundCount: 3 }, advocateId),
    ).rejects.toBeInstanceOf(ValidationError);

    // A debate with a (well-formed) root opens cleanly.
    const { debateId } = await freshDebate();
    const exchange = await openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId);
    expect(exchange.status).toBe("pending");
  });

  // ─── FR-007 gate part 2: every connective needs ≥2 operands ─────────────────

  it("rejects a connective with <2 operands (gate part 2) and accepts once the 2nd operand is added", async () => {
    const { debateId } = await freshDebate();
    const connectiveId = await addConnectiveWithOperands(debateId, 1); // under-wired

    await expect(
      openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId),
    ).rejects.toBeInstanceOf(ValidationError);

    // Add the 2nd operand — now well-formed.
    const operand = await createStatementNode(
      service,
      { nodeKind: "statement", debateId, statementType: "claim", title: "op2", positionX: 30, positionY: 30 },
      advocateId,
    );
    await createRelation(
      service,
      { debateId, sourceNodeId: operand.id, targetNodeId: connectiveId, kind: "link" },
      advocateId,
    );

    const exchange = await openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId);
    expect(exchange.status).toBe("pending");
  });

  // ─── RLS pair-visibility (Risk #1): pending grants READ, never WRITE ────────

  it("pending challenger can READ the graph but cannot WRITE; non-participant denied throughout", async () => {
    const { debateId, rootNodeId } = await freshDebate();
    await openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId);

    // Challenger can READ debate + nodes + relations while pending.
    const debateRead = await challengerClient.from("debates").select("id").eq("id", debateId);
    expect(debateRead.data).toHaveLength(1);
    const nodesRead = await challengerClient.from("nodes").select("id").eq("debate_id", debateId);
    expect(nodesRead.data?.length ?? 0).toBeGreaterThan(0);
    const relationsRead = await challengerClient.from("relations").select("id").eq("debate_id", debateId);
    expect(relationsRead.error).toBeNull();

    // Challenger CANNOT write: INSERT is rejected by the with-check policy …
    const insert = await challengerClient
      .from("nodes")
      .insert({ debate_id: debateId, author_id: challengerId, kind: "statement", metadata: { title: "x" } })
      .select("id");
    expect(insert.error).not.toBeNull();
    // … and UPDATE matches 0 writable rows (owner/author-scoped USING).
    const update = await challengerClient
      .from("nodes")
      .update({ metadata: { title: "y" } })
      .eq("id", rootNodeId)
      .select("id");
    expect(update.data ?? []).toHaveLength(0);

    // A non-participant third user can never read.
    const outsiderRead = await outsiderClient.from("debates").select("id").eq("id", debateId);
    expect(outsiderRead.data ?? []).toHaveLength(0);
    const outsiderNodes = await outsiderClient.from("nodes").select("id").eq("debate_id", debateId);
    expect(outsiderNodes.data ?? []).toHaveLength(0);
  });

  it("accepted challenger still reads (and still cannot write); declined challenger loses read access", async () => {
    // Accept path: read survives the transition.
    const accepted = await freshDebate();
    const acceptedExchange = await openExchange(
      advocateClient,
      { debateId: accepted.debateId, challengerId, roundCount: 3 },
      advocateId,
    );
    await respondToInvite(challengerClient, acceptedExchange.id, true);
    const afterAccept = await challengerClient.from("debates").select("id").eq("id", accepted.debateId);
    expect(afterAccept.data).toHaveLength(1);
    // Still no write after accept (challenger writes are S-03).
    const writeAfterAccept = await challengerClient
      .from("nodes")
      .insert({ debate_id: accepted.debateId, author_id: challengerId, kind: "statement", metadata: { title: "x" } })
      .select("id");
    expect(writeAfterAccept.error).not.toBeNull();

    // Decline path (separate fresh exchange): read access closes.
    const declined = await freshDebate();
    const declinedExchange = await openExchange(
      advocateClient,
      { debateId: declined.debateId, challengerId, roundCount: 3 },
      advocateId,
    );
    const beforeDecline = await challengerClient.from("debates").select("id").eq("id", declined.debateId);
    expect(beforeDecline.data).toHaveLength(1); // readable while pending
    await respondToInvite(challengerClient, declinedExchange.id, false);
    const afterDecline = await challengerClient.from("debates").select("id").eq("id", declined.debateId);
    expect(afterDecline.data ?? []).toHaveLength(0); // no longer readable
  });

  // ─── Self-invite (422) + caller absent from search ──────────────────────────

  it("blocks self-invite and never returns the caller in username search", async () => {
    const { debateId } = await freshDebate();
    await expect(
      openExchange(advocateClient, { debateId, challengerId: advocateId, roundCount: 3 }, advocateId),
    ).rejects.toBeInstanceOf(ValidationError);

    // The advocate must never see themselves in their own search results.
    const { data: me } = await service.from("profiles").select("username").eq("id", advocateId).single();
    const substring = (me?.username ?? "").slice(0, 4);
    const results = await searchUsersByUsername(advocateClient, substring, advocateId);
    expect(results.some((u) => u.id === advocateId)).toBe(false);
  });

  // ─── Duplicate open (409) + re-invite after decline ─────────────────────────

  it("rejects a second open while one is pending, and allows re-invite after decline", async () => {
    const { debateId } = await freshDebate();
    await openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId);

    // Second open while one is still pending → conflict.
    await expect(
      openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId),
    ).rejects.toBeInstanceOf(ConflictError);

    // Decline the open one, then re-invite succeeds (declined rows leave the
    // partial-unique slot free).
    const { data: open, error: openError } = await service
      .from("exchanges")
      .select("id")
      .eq("debate_id", debateId)
      .eq("status", "pending")
      .single();
    if (openError) throw openError;
    await respondToInvite(challengerClient, open.id, false);
    const reInvite = await openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId);
    expect(reInvite.status).toBe("pending");
  });

  // ─── Respond transitions ────────────────────────────────────────────────────

  it("accept sets accepted + responded_at (turn state untouched); decline sets declined; re-respond is 404", async () => {
    const accepted = await freshDebate();
    const exAccept = await openExchange(
      advocateClient,
      { debateId: accepted.debateId, challengerId, roundCount: 3 },
      advocateId,
    );
    const acceptedRow = await respondToInvite(challengerClient, exAccept.id, true);
    expect(acceptedRow.status).toBe("accepted");
    expect(acceptedRow.responded_at).not.toBeNull();
    expect(acceptedRow.current_round).toBe(1);
    expect(acceptedRow.current_turn).toBe("challenger");

    // Responding again to a non-pending exchange → NotFoundError.
    await expect(respondToInvite(challengerClient, exAccept.id, true)).rejects.toBeInstanceOf(NotFoundError);

    const declined = await freshDebate();
    const exDecline = await openExchange(
      advocateClient,
      { debateId: declined.debateId, challengerId, roundCount: 3 },
      advocateId,
    );
    const declinedRow = await respondToInvite(challengerClient, exDecline.id, false);
    expect(declinedRow.status).toBe("declined");
  });

  // ─── Revoke (Phase 4.5 — exchanges_delete) ──────────────────────────────────

  it("advocate revokes a pending invite — slot re-opens, challenger read closes", async () => {
    const { debateId } = await freshDebate();
    const exchange = await openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId);

    // Readable while pending.
    const before = await challengerClient.from("debates").select("id").eq("id", debateId);
    expect(before.data).toHaveLength(1);

    await revokeInvite(advocateClient, exchange.id, advocateId);

    // Row gone, slot free (re-invite succeeds), challenger can no longer read.
    const { data: gone } = await service.from("exchanges").select("id").eq("id", exchange.id);
    expect(gone ?? []).toHaveLength(0);
    const reInvite = await openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId);
    expect(reInvite.status).toBe("pending");
    // Clean the re-invited row so the partial-unique slot is free for teardown.
    await revokeInvite(advocateClient, reInvite.id, advocateId);
    const afterRevoke = await challengerClient.from("debates").select("id").eq("id", debateId);
    expect(afterRevoke.data ?? []).toHaveLength(0);
  });

  it("cannot revoke an accepted exchange (pending-only)", async () => {
    const { debateId } = await freshDebate();
    const exchange = await openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId);
    await respondToInvite(challengerClient, exchange.id, true);
    await expect(revokeInvite(advocateClient, exchange.id, advocateId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a non-advocate cannot revoke the exchange (RLS denies)", async () => {
    const { debateId } = await freshDebate();
    const exchange = await openExchange(advocateClient, { debateId, challengerId, roundCount: 3 }, advocateId);
    // Challenger attempts to delete via their own client → RLS + filter → 404.
    await expect(revokeInvite(challengerClient, exchange.id, challengerId)).rejects.toBeInstanceOf(NotFoundError);
    // Outsider likewise.
    await expect(revokeInvite(outsiderClient, exchange.id, outsiderId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
