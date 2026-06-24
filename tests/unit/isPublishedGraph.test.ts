import { describe, expect, it } from "vitest";
import { isPublishedGraph, type DebateGraph } from "@/lib/debate/repository";

// S-09 bugfix: the showcase detail page (`/showcase/[id].astro`) must reject a debate
// that RLS happily returned but isn't actually published — that case is real, not
// hypothetical: an authenticated owner/challenger can read their own debate via the
// `debates_select` (authenticated) policy regardless of `public`. `isPublishedGraph` is
// the single explicit gate the page applies on top of whatever RLS already let through.
function graphWithPublic(pub: boolean): DebateGraph {
  return {
    // Only `debate.public` is read by isPublishedGraph; the rest is filler to satisfy
    // the DebateGraph shape.
    debate: { public: pub } as DebateGraph["debate"],
    nodes: [],
    relations: [],
  };
}

describe("isPublishedGraph", () => {
  it("is false for null (unknown id / RLS-scoped-out anon read)", () => {
    expect(isPublishedGraph(null)).toBe(false);
  });

  it("is false for a graph whose debate is not public (e.g. the owner's own private debate)", () => {
    expect(isPublishedGraph(graphWithPublic(false))).toBe(false);
  });

  it("is true for a graph whose debate is public", () => {
    expect(isPublishedGraph(graphWithPublic(true))).toBe(true);
  });
});
