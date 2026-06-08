import { afterEach, expect, it } from "vitest";
import { createStatementNode, deleteNode, updateNode } from "@/lib/debate/repository";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { cleanupDebate, describeIntegration, requireSeedingUserId, requireServiceClient, seedDebate } from "./helpers";

// D3 root protection (Risk #3): once a debate has a designated root claim, its
// identity is locked. The root cannot be demoted to a non-claim (3b → 422) and
// cannot be deleted (3a → 409). The only sanctioned way to change the root is the
// Phase-4 re-designation path. These tests pin the server contract; assertions run
// as service-role (RLS-agnostic for shape/conflict rules).
describeIntegration("root protection (D3-3b demotion guard)", () => {
  const created: string[] = [];

  afterEach(async () => {
    for (const id of created.splice(0)) await cleanupDebate(id);
  });

  it("rejects demoting the root's statement_type away from claim with ValidationError (422)", async () => {
    const supabase = requireServiceClient();
    const { debateId, rootNodeId } = await seedDebate();
    created.push(debateId);

    await expect(updateNode(supabase, rootNodeId, { statementType: "rebuttal" })).rejects.toBeInstanceOf(
      ValidationError,
    );

    // The root's role is unchanged on disk.
    const { data: node } = await supabase.from("nodes").select("metadata").eq("id", rootNodeId).single();
    expect((node?.metadata as { statement_type: string }).statement_type).toBe("claim");
  });

  it("allows demoting a non-root statement node", async () => {
    const supabase = requireServiceClient();
    const authorId = requireSeedingUserId();
    const { debateId } = await seedDebate();
    created.push(debateId);

    const other = await createStatementNode(
      supabase,
      { nodeKind: "statement", debateId, statementType: "claim", title: "Not the root", positionX: 10, positionY: 10 },
      authorId,
    );

    const updated = await updateNode(supabase, other.id, { statementType: "rebuttal" });
    expect((updated.metadata as { statement_type: string }).statement_type).toBe("rebuttal");
  });

  it("still patches the root's other fields (title) without touching its role", async () => {
    const supabase = requireServiceClient();
    const { debateId, rootNodeId } = await seedDebate();
    created.push(debateId);

    const updated = await updateNode(supabase, rootNodeId, { title: "Renamed root" });
    const meta = updated.metadata as { statement_type: string; title: string };
    expect(meta.title).toBe("Renamed root");
    expect(meta.statement_type).toBe("claim");
  });
});

describeIntegration("root protection (D3-3a delete guard)", () => {
  const created: string[] = [];

  afterEach(async () => {
    for (const id of created.splice(0)) await cleanupDebate(id);
  });

  it("rejects deleting the root node with ConflictError (409), not a raw FK 500", async () => {
    const supabase = requireServiceClient();
    const { debateId, rootNodeId } = await seedDebate();
    created.push(debateId);

    await expect(deleteNode(supabase, rootNodeId)).rejects.toBeInstanceOf(ConflictError);

    // The root row survives the rejected delete.
    const { data: node } = await supabase.from("nodes").select("id").eq("id", rootNodeId).maybeSingle();
    expect(node?.id).toBe(rootNodeId);
  });

  it("still deletes a non-root node (no conflict)", async () => {
    const supabase = requireServiceClient();
    const authorId = requireSeedingUserId();
    const { debateId } = await seedDebate();
    created.push(debateId);

    const other = await createStatementNode(
      supabase,
      { nodeKind: "statement", debateId, statementType: "claim", title: "Disposable", positionX: 20, positionY: 20 },
      authorId,
    );

    await expect(deleteNode(supabase, other.id)).resolves.toBeUndefined();
    const { data: node } = await supabase.from("nodes").select("id").eq("id", other.id).maybeSingle();
    expect(node).toBeNull();
  });

  it("still maps an unknown node id to NotFoundError (Risk #6 floor unaffected)", async () => {
    const supabase = requireServiceClient();
    await expect(deleteNode(supabase, "00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(NotFoundError);
  });
});
