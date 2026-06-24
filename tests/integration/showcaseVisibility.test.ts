import { afterAll, beforeAll, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDebateGraph, isPublishedGraph, listPublicDebates } from "@/lib/debate/repository";
import type { Database } from "@/db/database.types";
import {
  cleanupDebate,
  createTestUser,
  deleteTestUser,
  describeIntegration,
  getClientAsUser,
  requireSeedingUser,
  requireServiceClient,
  seedDebate,
} from "./helpers";
import type { TestUser } from "./globalSetup";

type DB = SupabaseClient<Database>;

// S-09 bugfix (reported after Phase 3 manual testing):
//   1. A logged-in user who is neither the debate's owner nor its challenger could not see
//      a PUBLISHED debate via the showcase listing — `debates_select` (to authenticated)
//      only matches owner/challenger rows, with no `public = true` branch, so
//      `listPublicDebates` silently returned nothing for anyone else's debate even after it
//      was published. Fixed by an additive `debates_select_authenticated_public` policy
//      (RLS policies for the same role are OR'd).
//   2. The showcase DETAIL page (`/showcase/[id].astro`) rendered an UNPUBLISHED debate when
//      visited by its own owner/challenger while logged in — RLS lets a participant read
//      their own debate via `debates_select` regardless of `public`, and the page used to
//      trust `getDebateGraph` alone. Fixed by an explicit `isPublishedGraph` gate in the
//      page (tested at the unit level in tests/unit/isPublishedGraph.test.ts); this suite
//      proves the RLS precondition that makes that gate necessary.
describeIntegration("S-09 showcase visibility (authenticated viewers)", () => {
  let service: DB;
  let advocate: TestUser;
  let outsider: TestUser;
  let publishedId: string;
  let unpublishedId: string;

  const seededDebateIds: string[] = [];

  beforeAll(async () => {
    service = requireServiceClient();
    advocate = requireSeedingUser();
    outsider = await createTestUser("showcase-visibility-outsider");

    ({ debateId: publishedId } = await seedDebate());
    seededDebateIds.push(publishedId);
    ({ debateId: unpublishedId } = await seedDebate());
    seededDebateIds.push(unpublishedId);

    const { error } = await service
      .from("debates")
      .update({ public: true, published_at: new Date().toISOString() })
      .eq("id", publishedId);
    if (error) throw error;
    // unpublishedId stays at its seeded default: public = false.
  });

  afterAll(async () => {
    for (const id of seededDebateIds) await cleanupDebate(id);
    await deleteTestUser(outsider.userId);
  });

  it("an authenticated non-participant SEES a published debate via listPublicDebates", async () => {
    const outsiderClient = await getClientAsUser(outsider.email, outsider.password);
    const result = await listPublicDebates({ supabase: outsiderClient });
    expect(result.map((d) => d.id)).toContain(publishedId);
  });

  it("an authenticated non-participant does NOT see an unpublished debate via listPublicDebates", async () => {
    const outsiderClient = await getClientAsUser(outsider.email, outsider.password);
    const result = await listPublicDebates({ supabase: outsiderClient });
    expect(result.map((d) => d.id)).not.toContain(unpublishedId);
  });

  it("RLS lets the owner read their own unpublished debate's raw graph — why the showcase page needs an explicit public check", async () => {
    const ownerClient = await getClientAsUser(advocate.email, advocate.password);
    const graph = await getDebateGraph(ownerClient, unpublishedId);
    expect(graph).not.toBeNull();
    expect(graph?.debate.public).toBe(false);
    // This is exactly the case isPublishedGraph (used by /showcase/[id].astro) must reject.
    expect(isPublishedGraph(graph)).toBe(false);
  });

  it("the owner's own published debate passes the showcase page's isPublishedGraph gate", async () => {
    const ownerClient = await getClientAsUser(advocate.email, advocate.password);
    const graph = await getDebateGraph(ownerClient, publishedId);
    expect(isPublishedGraph(graph)).toBe(true);
  });
});
