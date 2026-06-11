import { describe, expect, it } from "vitest";

import { classifyDivergence, type ClassifyMark, type ClassifyNode } from "@/lib/summary/classify";
import { Constants } from "@/db/database.types";

// The classifier is the deterministic heart of the divergence summary. These tests are the
// full oracle: every statement_type × {agree, challenge, abstain, unmarked} lands in the
// right bucket, open divergences carry the right factual/values gap, connectives are excluded,
// and `valid = false` marks are ignored (treated as unmarked → unresolved).

const STATEMENT_TYPES = Constants.public.Enums.statement_type; // claim, source, data, warrant, backing, rebuttal
const FACTUAL_TYPES = ["source", "data", "backing"] as const;
const VALUES_TYPES = ["claim", "warrant", "rebuttal"] as const;

const AUTHOR = "author-1";

function statement(id: string, statementType: ClassifyNode["statementType"]): ClassifyNode {
  return { id, kind: "statement", statementType, title: `title-${id}`, authorId: AUTHOR };
}

function connective(id: string): ClassifyNode {
  return { id, kind: "connective", statementType: null, title: "", authorId: AUTHOR };
}

function mark(stance: ClassifyMark["stance"], valid = true): ClassifyMark {
  return { stance, valid };
}

describe("classifyDivergence", () => {
  it("buckets an Agreed statement of every type into commonGround", () => {
    for (const t of STATEMENT_TYPES) {
      const result = classifyDivergence({ nodes: [statement("s1", t)], marks: { s1: mark("agree") } });
      expect(result.commonGround).toEqual([{ id: "s1", statementType: t, title: "title-s1" }]);
      expect(result.openDivergences).toHaveLength(0);
      expect(result.unresolved).toHaveLength(0);
    }
  });

  it("buckets a Challenged statement into openDivergences with the right gap label", () => {
    for (const t of FACTUAL_TYPES) {
      const result = classifyDivergence({ nodes: [statement("s1", t)], marks: { s1: mark("challenge") } });
      expect(result.openDivergences).toEqual([{ id: "s1", statementType: t, title: "title-s1", gap: "factual" }]);
    }
    for (const t of VALUES_TYPES) {
      const result = classifyDivergence({ nodes: [statement("s1", t)], marks: { s1: mark("challenge") } });
      expect(result.openDivergences).toEqual([{ id: "s1", statementType: t, title: "title-s1", gap: "values" }]);
    }
  });

  it("buckets an Abstained statement of every type into unresolved", () => {
    for (const t of STATEMENT_TYPES) {
      const result = classifyDivergence({ nodes: [statement("s1", t)], marks: { s1: mark("abstain") } });
      expect(result.unresolved).toEqual([{ id: "s1", statementType: t, title: "title-s1" }]);
      expect(result.commonGround).toHaveLength(0);
      expect(result.openDivergences).toHaveLength(0);
    }
  });

  it("treats an unmarked statement of every type as unresolved", () => {
    for (const t of STATEMENT_TYPES) {
      const result = classifyDivergence({ nodes: [statement("s1", t)], marks: {} });
      expect(result.unresolved).toEqual([{ id: "s1", statementType: t, title: "title-s1" }]);
    }
  });

  it("treats a `valid = false` mark as unmarked → unresolved (S-05 forward-compat)", () => {
    const result = classifyDivergence({
      nodes: [statement("s1", "data")],
      marks: { s1: mark("agree", false) },
    });
    expect(result.unresolved).toEqual([{ id: "s1", statementType: "data", title: "title-s1" }]);
    expect(result.commonGround).toHaveLength(0);
  });

  it("excludes connective nodes from every bucket, even if a stray mark is keyed on one", () => {
    const result = classifyDivergence({
      nodes: [connective("k1"), statement("s1", "claim")],
      marks: { k1: mark("agree"), s1: mark("agree") },
    });
    expect(result.commonGround).toEqual([{ id: "s1", statementType: "claim", title: "title-s1" }]);
    expect(result.openDivergences).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
  });

  it("classifies a mixed graph into all three buckets at once", () => {
    const result = classifyDivergence({
      nodes: [
        statement("agree-claim", "claim"),
        statement("challenge-data", "data"),
        statement("challenge-warrant", "warrant"),
        statement("abstain-source", "source"),
        statement("unmarked-backing", "backing"),
        connective("k1"),
      ],
      marks: {
        "agree-claim": mark("agree"),
        "challenge-data": mark("challenge"),
        "challenge-warrant": mark("challenge"),
        "abstain-source": mark("abstain"),
      },
    });

    expect(result.commonGround.map((i) => i.id)).toEqual(["agree-claim"]);
    expect(result.openDivergences).toEqual([
      { id: "challenge-data", statementType: "data", title: "title-challenge-data", gap: "factual" },
      { id: "challenge-warrant", statementType: "warrant", title: "title-challenge-warrant", gap: "values" },
    ]);
    expect(result.unresolved.map((i) => i.id).sort()).toEqual(["abstain-source", "unmarked-backing"]);
  });

  it("returns three empty buckets for an empty graph", () => {
    expect(classifyDivergence({ nodes: [], marks: {} })).toEqual({
      commonGround: [],
      openDivergences: [],
      unresolved: [],
    });
  });
});
