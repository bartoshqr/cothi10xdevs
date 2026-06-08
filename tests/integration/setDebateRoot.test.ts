import { afterEach, expect, it } from "vitest";
import { createStatementNode, createRelation, setDebateRoot } from "@/lib/debate/repository";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { cleanupDebate, describeIntegration, requireSeedingUserId, requireServiceClient, seedDebate } from "./helpers";

// D3-3c (Risk #3): re-designating the root must be a single atomic, persisted
// operation. `set_debate_root` re-points `debates.root_node_id`, coerces the new
// root's `statement_type` → `claim`, and strips the new root's outgoing relations
// (a root claim is a sink: nothing it argues *for* survives the promotion). The
// rule lived only as two unsynced client calls before this phase; these tests pin
// the server contract. Assertions run as service-role (RLS-agnostic here).
describeIntegration("setDebateRoot re-designation (D3-3c)", () => {
  const created: string[] = [];

  afterEach(async () => {
    for (const id of created.splice(0)) await cleanupDebate(id);
  });

  it("moves root_node_id, coerces the new root's role to claim, and strips its outgoing relations", async () => {
    const supabase = requireServiceClient();
    const authorId = requireSeedingUserId();
    const { debateId, rootNodeId } = await seedDebate();
    created.push(debateId);

    // A second statement that is NOT a claim, so the coercion is observable.
    const newRoot = await createStatementNode(
      supabase,
      { nodeKind: "statement", debateId, statementType: "rebuttal", title: "Challenger", positionX: 50, positionY: 50 },
      authorId,
    );
    // A target the new root argues toward — its outgoing edge must be removed on promotion.
    const target = await createStatementNode(
      supabase,
      { nodeKind: "statement", debateId, statementType: "claim", title: "Some target", positionX: 99, positionY: 99 },
      authorId,
    );
    await createRelation(
      supabase,
      { debateId, sourceNodeId: newRoot.id, targetNodeId: target.id, kind: "supports" },
      authorId,
    );
    // Give the new root a source url; a root is a claim and a claim has no url, so
    // promotion must strip it server-side (impl-review F1 — mirrors the client's
    // apply-on-success, which clears url, so persisted state can't diverge on reload).
    await supabase
      .from("nodes")
      .update({ metadata: { statement_type: "rebuttal", url: "https://example.com/src" } })
      .eq("id", newRoot.id);

    const updated = await setDebateRoot(supabase, debateId, newRoot.id);

    expect(updated.root_node_id).toBe(newRoot.id);

    const { data: node } = await supabase.from("nodes").select("metadata").eq("id", newRoot.id).single();
    const meta = node?.metadata as { statement_type: string; url?: string };
    expect(meta.statement_type).toBe("claim");
    expect(meta.url).toBeUndefined(); // F1: url stripped on promotion to root claim

    const { data: outgoing } = await supabase.from("relations").select("id").eq("source_node_id", newRoot.id);
    expect(outgoing).toEqual([]);

    // The old root is untouched as a node; only the debate's pointer moved.
    expect(rootNodeId).not.toBe(newRoot.id);
  });

  it("rejects a connective target with ValidationError (422), leaving the root unchanged", async () => {
    const supabase = requireServiceClient();
    const authorId = requireSeedingUserId();
    const { debateId, rootNodeId } = await seedDebate();
    created.push(debateId);

    const connective = await supabase
      .from("nodes")
      .insert({
        debate_id: debateId,
        author_id: authorId,
        kind: "connective",
        position_x: 0,
        position_y: 0,
        metadata: { op: "and" },
      })
      .select("id")
      .single();
    const connectiveId = connective.data?.id;
    if (!connectiveId) throw new Error("failed to seed connective");

    await expect(setDebateRoot(supabase, debateId, connectiveId)).rejects.toBeInstanceOf(ValidationError);

    const { data: debate } = await supabase.from("debates").select("root_node_id").eq("id", debateId).single();
    expect(debate?.root_node_id).toBe(rootNodeId);
  });

  it("throws NotFoundError for an unknown node id under a real debate", async () => {
    const supabase = requireServiceClient();
    const { debateId } = await seedDebate();
    created.push(debateId);
    await expect(setDebateRoot(supabase, debateId, "00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("throws NotFoundError for an unknown debate id", async () => {
    const supabase = requireServiceClient();
    const { rootNodeId } = await seedDebate();
    // Use a real node id but a bogus debate — the node is not in that debate.
    await expect(setDebateRoot(supabase, "00000000-0000-4000-8000-000000000001", rootNodeId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // cleanup: seedDebate's debate is tracked via its own id; fetch + clean.
    const { data } = await supabase.from("nodes").select("debate_id").eq("id", rootNodeId).single();
    if (data?.debate_id) created.push(data.debate_id);
  });
});
