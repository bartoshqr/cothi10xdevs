import { describe, expect, it } from "vitest";

import {
  reachableFromRoot,
  orphanStatementIds,
  incompleteConnectiveIds,
  isMapWellFormed,
} from "@/lib/debate/connectivity";
import type { ConnNode, ConnRelation } from "@/lib/debate/connectivity";

// Reachability is the compute-at-read heart of orphan resolution. A statement reaches root
// when a directed path of relations leads from it to the root (the root is a sink). These
// tests cover: reaches root, severed path, never-connected, connective-only path, and the
// `orphanStatementIds` author filter.

const ROOT = "root";

describe("reachableFromRoot", () => {
  it("returns an empty set when there is no root", () => {
    const relations: ConnRelation[] = [{ source: "a", target: "b" }];
    expect(reachableFromRoot({ relations, rootNodeId: null }).size).toBe(0);
  });

  it("includes only the root when nothing points at it", () => {
    expect(reachableFromRoot({ relations: [], rootNodeId: ROOT })).toEqual(new Set([ROOT]));
  });

  it("includes a node with a direct path to root", () => {
    // s1 → root
    const relations: ConnRelation[] = [{ source: "s1", target: ROOT }];
    expect(reachableFromRoot({ relations, rootNodeId: ROOT })).toEqual(new Set([ROOT, "s1"]));
  });

  it("follows a multi-hop path to root (transitive reach)", () => {
    // s2 → s1 → root
    const relations: ConnRelation[] = [
      { source: "s1", target: ROOT },
      { source: "s2", target: "s1" },
    ];
    expect(reachableFromRoot({ relations, rootNodeId: ROOT })).toEqual(new Set([ROOT, "s1", "s2"]));
  });

  it("excludes a node whose only path was severed", () => {
    // s1 → root, but s2 → s1 was deleted; s2 no longer reaches root.
    const relations: ConnRelation[] = [{ source: "s1", target: ROOT }];
    const reached = reachableFromRoot({ relations, rootNodeId: ROOT });
    expect(reached.has("s1")).toBe(true);
    expect(reached.has("s2")).toBe(false);
  });

  it("does not treat an edge pointing away from root as a path (direction matters)", () => {
    // root → s1 is the wrong direction; s1 cannot reach root through it.
    const relations: ConnRelation[] = [{ source: ROOT, target: "s1" }];
    expect(reachableFromRoot({ relations, rootNodeId: ROOT })).toEqual(new Set([ROOT]));
  });

  it("reaches root through a connective node on the path", () => {
    // s1 → k1 → root (a connective relays the path).
    const relations: ConnRelation[] = [
      { source: "k1", target: ROOT },
      { source: "s1", target: "k1" },
    ];
    expect(reachableFromRoot({ relations, rootNodeId: ROOT })).toEqual(new Set([ROOT, "k1", "s1"]));
  });
});

describe("orphanStatementIds", () => {
  const nodes: ConnNode[] = [
    { id: ROOT, kind: "statement", authorId: "adv" },
    { id: "connected", kind: "statement", authorId: "adv" },
    { id: "severed", kind: "statement", authorId: "adv" },
    { id: "challengerOrphan", kind: "statement", authorId: "cha" },
    { id: "k1", kind: "connective", authorId: "adv" },
  ];
  // connected → root; severed and challengerOrphan have no path; k1 is a lone connective.
  const relations: ConnRelation[] = [{ source: "connected", target: ROOT }];

  it("flags statements that cannot reach root, excluding the root and connectives", () => {
    const orphans = orphanStatementIds({ nodes, relations, rootNodeId: ROOT });
    expect(orphans.sort()).toEqual(["challengerOrphan", "severed"]);
  });

  it("restricts to one author's own statements when authorId is given", () => {
    const orphans = orphanStatementIds({ nodes, relations, rootNodeId: ROOT, authorId: "adv" });
    expect(orphans).toEqual(["severed"]);
  });

  it("returns no orphans when every statement reaches root", () => {
    const allConnected: ConnRelation[] = [
      { source: "connected", target: ROOT },
      { source: "severed", target: ROOT },
      { source: "challengerOrphan", target: ROOT },
    ];
    expect(orphanStatementIds({ nodes, relations: allConnected, rootNodeId: ROOT })).toEqual([]);
  });
});

describe("incompleteConnectiveIds", () => {
  it("returns an empty array when there are no connectives", () => {
    expect(incompleteConnectiveIds([], [])).toEqual([]);
  });

  it("returns a connective with zero or one inbound link", () => {
    expect(incompleteConnectiveIds(["c1"], [])).toEqual(["c1"]);
    expect(incompleteConnectiveIds(["c1"], ["c1"])).toEqual(["c1"]);
  });

  it("omits a connective once it has two inbound links", () => {
    expect(incompleteConnectiveIds(["c1"], ["c1", "c1"])).toEqual([]);
  });

  it("returns only the under-filled connective when others are well-formed", () => {
    expect(incompleteConnectiveIds(["c1", "c2"], ["c1", "c1", "c2"])).toEqual(["c2"]);
  });

  it("ignores link targets that are not connective ids (e.g. statement targets)", () => {
    expect(incompleteConnectiveIds(["c1"], ["c1", "other-node"])).toEqual(["c1"]);
  });
});

describe("isMapWellFormed", () => {
  it("returns true for an empty map (no connectives)", () => {
    expect(isMapWellFormed([], [])).toBe(true);
  });

  it("returns false for a connective with fewer than two inbound links", () => {
    expect(isMapWellFormed(["c1"], [])).toBe(false);
    expect(isMapWellFormed(["c1"], ["c1"])).toBe(false);
  });

  it("returns true once every connective has ≥2 inbound links", () => {
    expect(isMapWellFormed(["c1"], ["c1", "c1"])).toBe(true);
    expect(isMapWellFormed(["c1", "c2"], ["c1", "c1", "c2", "c2", "c2"])).toBe(true);
  });

  it("returns false when one connective is short even if another is fine", () => {
    expect(isMapWellFormed(["c1", "c2"], ["c1", "c1", "c2"])).toBe(false);
  });
});
