import { afterAll, expect, it } from "vitest";
import { cleanupDebate, describeIntegration, requireServiceClient, seedDebate } from "./helpers";

// Smoke test for the integration project: proves the seeding client (real RPC) and
// the service-role client (assertions/teardown) round-trip a debate against Supabase
// local. Skips cleanly when the integration env is absent.
describeIntegration("integration harness", () => {
  const debateIds: string[] = [];

  afterAll(async () => {
    for (const id of debateIds) await cleanupDebate(id);
  });

  it("seeds a debate and reads back a claim root node via the service client", async () => {
    const { debateId, rootNodeId } = await seedDebate({ rootTitle: "Smoke root" });
    debateIds.push(debateId);

    const { data: root, error } = await requireServiceClient()
      .from("nodes")
      .select("id, kind, metadata")
      .eq("id", rootNodeId)
      .single();

    expect(error).toBeNull();
    expect(root?.kind).toBe("statement");
    expect((root?.metadata as { statement_type?: string }).statement_type).toBe("claim");
  });
});
