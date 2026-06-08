import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { deleteNode, deleteRelation, updateNode, updateRelation } from "@/lib/debate/repository";
import { NotFoundError } from "@/lib/errors";
import { describeIntegration, requireServiceClient } from "./helpers";

// Risk #6 regression floor: a mutating call on an id that does not exist must map
// to NotFoundError (→404), never a 200-with-nulls record. Behavior is already
// correct (see research §"Risk #6"); these pin it against future drift — chiefly
// the patch_node RPC reverting from `RETURNS SETOF` to a bare composite (lessons §4).
//
// Service-role assertions on a *non-existent* id are RLS-agnostic: no row exists for
// any caller, so the empty-result → 404 path is exercised regardless of RLS. The
// RLS-hidden-but-exists half of Risk #6 is deferred to test Phase 2 (D5).
describeIntegration("unknown id → NotFoundError (Risk #6 floor)", () => {
  // A fresh v4 UUID that does not exist in any table.
  const missingId = (): string => randomUUID();

  it("updateNode throws NotFoundError for an unknown node id", async () => {
    const supabase = requireServiceClient();
    await expect(updateNode(supabase, missingId(), { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deleteNode throws NotFoundError for an unknown node id", async () => {
    const supabase = requireServiceClient();
    await expect(deleteNode(supabase, missingId())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updateRelation throws NotFoundError for an unknown relation id", async () => {
    const supabase = requireServiceClient();
    await expect(updateRelation(supabase, missingId(), { kind: "supports" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deleteRelation throws NotFoundError for an unknown relation id", async () => {
    const supabase = requireServiceClient();
    await expect(deleteRelation(supabase, missingId())).rejects.toBeInstanceOf(NotFoundError);
  });

  // SETOF-specific contract: the only RPC in any mutating path. With `RETURNS SETOF
  // public.nodes`, an unknown id yields an empty set → `.maybeSingle()` returns real
  // `null`. A bare-composite return would instead yield an all-null row object
  // (`{ id: null, ... }`) — truthy, defeating the `if (!data)` 404 guard. Assert null.
  it("patch_node yields null (empty set) for an unknown id — not an all-null row", async () => {
    const supabase = requireServiceClient();
    const { data, error } = await supabase
      .rpc("patch_node", {
        p_node_id: missingId(),
        p_metadata_patch: { title: "x" },
      })
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});
