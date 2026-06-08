import { afterAll, beforeAll, expect, it } from "vitest";
import { createConnectiveNode, createRelation, createStatementNode } from "@/lib/debate/repository";
import { ConflictError, ValidationError } from "@/lib/errors";
import { cleanupDebate, describeIntegration, requireSeedingUserId, requireServiceClient, seedDebate } from "./helpers";

// D1 server enforcement (Risk #3): a `link` relation must target a connective
// node. The rule lives only in the React canvas today; the API path inserts any
// kind→any target. These tests prove createRelation rejects an illegal `link`
// server-side (→422) while leaving the three any→any kinds unconstrained.
describeIntegration("createRelation link→connective guard (D1)", () => {
  let debateId: string;
  let rootNodeId: string; // a statement (the root claim) — used as the source
  let connectiveId: string;
  let statementTargetId: string;

  beforeAll(async () => {
    const supabase = requireServiceClient();
    const authorId = requireSeedingUserId();
    const seeded = await seedDebate();
    debateId = seeded.debateId;
    rootNodeId = seeded.rootNodeId;

    const connective = await createConnectiveNode(
      supabase,
      { nodeKind: "connective", debateId, connectiveOp: "and", positionX: 0, positionY: 0 },
      authorId,
    );
    connectiveId = connective.id;

    const statement = await createStatementNode(
      supabase,
      { nodeKind: "statement", debateId, statementType: "claim", title: "Target", positionX: 10, positionY: 10 },
      authorId,
    );
    statementTargetId = statement.id;
  });

  afterAll(async () => {
    await cleanupDebate(debateId);
  });

  it("rejects a link to a non-connective (statement) target", async () => {
    const supabase = requireServiceClient();
    await expect(
      createRelation(
        supabase,
        { debateId, sourceNodeId: rootNodeId, targetNodeId: statementTargetId, kind: "link" },
        requireSeedingUserId(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts a link to a connective target", async () => {
    const supabase = requireServiceClient();
    const relation = await createRelation(
      supabase,
      { debateId, sourceNodeId: rootNodeId, targetNodeId: connectiveId, kind: "link" },
      requireSeedingUserId(),
    );
    expect(relation.kind).toBe("link");
    expect(relation.target_node_id).toBe(connectiveId);
  });

  it.each(["supports", "rephrases", "rebuts"] as const)("accepts %s on a non-connective target", async (kind) => {
    const supabase = requireServiceClient();
    const authorId = requireSeedingUserId();
    // A fresh target per kind: the (source, target) uniqueness constraint
    // (relations_uniq_pair) forbids reusing one pair across kinds, and this test
    // only cares that each kind is accepted on a non-connective target.
    const target = await createStatementNode(
      supabase,
      {
        nodeKind: "statement",
        debateId,
        statementType: "claim",
        title: `Target ${kind}`,
        positionX: 20,
        positionY: 20,
      },
      authorId,
    );
    const relation = await createRelation(
      supabase,
      { debateId, sourceNodeId: rootNodeId, targetNodeId: target.id, kind },
      authorId,
    );
    expect(relation.kind).toBe(kind);
    expect(relation.target_node_id).toBe(target.id);
  });

  // The unique constraint relations_uniq_pair bans a second relation on the same
  // directed pair (regardless of kind) — the DB backstop for the duplicate-edge bug
  // where two sessions each create an A→B edge. createRelation maps 23505 → 409.
  it("rejects a second relation on the same directed (source, target) pair", async () => {
    const supabase = requireServiceClient();
    const authorId = requireSeedingUserId();
    const target = await createStatementNode(
      supabase,
      { nodeKind: "statement", debateId, statementType: "claim", title: "Dup target", positionX: 30, positionY: 30 },
      authorId,
    );
    await createRelation(
      supabase,
      { debateId, sourceNodeId: rootNodeId, targetNodeId: target.id, kind: "supports" },
      authorId,
    );
    // Same pair again — even with a different kind — is rejected as a conflict (→409).
    await expect(
      createRelation(
        supabase,
        { debateId, sourceNodeId: rootNodeId, targetNodeId: target.id, kind: "rebuts" },
        authorId,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
