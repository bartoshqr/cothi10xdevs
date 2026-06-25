import { afterEach, expect, it } from "vitest";
import { createStatementNode, isPublishable, setDebatePublished } from "@/lib/debate/repository";
import { openExchange, respondToInvite } from "@/lib/exchange/repository";
import { NotFoundError } from "@/lib/errors";
import {
  cleanupDebate,
  describeIntegration,
  getClientAsUser,
  requireChallengerUser,
  requireSeedingUser,
  requireServiceClient,
  seedDebate,
} from "./helpers";

// S-09 Phase 2: the publish primitive. `isPublishable` checks the exchange's
// status === 'completed' directly (deviation, approved during impl — NOT the
// broader `getDivergenceSummary` gate, which also opens mid-exchange at
// current_round >= 2). `setDebatePublished` must write `public`/`published_at`
// atomically — never one without the other.
describeIntegration("S-09 publish primitive (isPublishable, setDebatePublished)", () => {
  const created: string[] = [];

  afterEach(async () => {
    for (const id of created.splice(0)) await cleanupDebate(id);
  });

  it("isPublishable is false for an in-progress (drafting) debate", async () => {
    const service = requireServiceClient();
    const { debateId } = await seedDebate();
    created.push(debateId);

    expect(await isPublishable({ supabase: service, debateId })).toBe(false);
  });

  it("isPublishable is true once the round gate is met (completed exchange)", async () => {
    const service = requireServiceClient();
    const advocate = requireSeedingUser();
    const challenger = requireChallengerUser();
    const advocateClient = await getClientAsUser(advocate.email, advocate.password);
    const challengerClient = await getClientAsUser(challenger.email, challenger.password);

    const { debateId } = await seedDebate();
    created.push(debateId);
    await createStatementNode(
      service,
      { nodeKind: "statement", debateId, statementType: "data", title: "Some data", positionX: 0, positionY: 0 },
      advocate.userId,
    );

    const exchange = await openExchange(
      advocateClient,
      { debateId, challengerId: challenger.userId, roundCount: 1 },
      advocate.userId,
    );
    await respondToInvite(challengerClient, exchange.id, true);
    await service.from("exchanges").update({ status: "completed" }).eq("id", exchange.id);

    expect(await isPublishable({ supabase: service, debateId })).toBe(true);
  });

  it("isPublishable stays false mid-exchange at current_round >= 2 (deviation from the summary gate)", async () => {
    const service = requireServiceClient();
    const advocate = requireSeedingUser();
    const challenger = requireChallengerUser();
    const advocateClient = await getClientAsUser(advocate.email, advocate.password);
    const challengerClient = await getClientAsUser(challenger.email, challenger.password);

    const { debateId } = await seedDebate();
    created.push(debateId);

    const exchange = await openExchange(
      advocateClient,
      { debateId, challengerId: challenger.userId, roundCount: 2 },
      advocate.userId,
    );
    await respondToInvite(challengerClient, exchange.id, true);
    // Advance mid-exchange without completing it — getDivergenceSummary's own gate
    // would already be open here (current_round >= 2), but isPublishable must not be.
    await service.from("exchanges").update({ current_round: 2 }).eq("id", exchange.id);

    expect(await isPublishable({ supabase: service, debateId })).toBe(false);
  });

  it("setDebatePublished writes public and published_at together, and clears published_at on unpublish", async () => {
    const service = requireServiceClient();
    const advocate = requireSeedingUser();
    const { debateId } = await seedDebate();
    created.push(debateId);

    const published = await setDebatePublished({
      supabase: service,
      debateId,
      ownerId: advocate.userId,
      published: true,
    });
    expect(published.public).toBe(true);
    expect(published.published_at).not.toBeNull();

    const unpublished = await setDebatePublished({
      supabase: service,
      debateId,
      ownerId: advocate.userId,
      published: false,
    });
    expect(unpublished.public).toBe(false);
    expect(unpublished.published_at).toBeNull();
  });

  it("throws NotFoundError when ownerId doesn't match the debate's actual owner", async () => {
    const service = requireServiceClient();
    const { debateId } = await seedDebate();
    created.push(debateId);

    await expect(
      setDebatePublished({
        supabase: service,
        debateId,
        ownerId: "00000000-0000-4000-8000-000000000000",
        published: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
