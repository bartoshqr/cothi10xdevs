import { afterAll, beforeAll, expect, it } from "vitest";
import { createConnectiveNode, createRelation, createStatementNode } from "@/lib/debate/repository";
import { ValidationError } from "@/lib/errors";
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
    const relation = await createRelation(
      supabase,
      { debateId, sourceNodeId: rootNodeId, targetNodeId: statementTargetId, kind },
      requireSeedingUserId(),
    );
    expect(relation.kind).toBe(kind);
    expect(relation.target_node_id).toBe(statementTargetId);
  });
});
