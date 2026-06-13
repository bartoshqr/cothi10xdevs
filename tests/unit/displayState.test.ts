import { describe, expect, it } from "vitest";
import { stateBadge, stateRank } from "@/lib/debate/displayState";
import type { DebateListState, DebateRole } from "@/lib/debate/repository";

const states: DebateListState[] = ["in_progress", "awaiting", "drafting", "closed"];
const roles: DebateRole[] = ["advocate", "challenger"];

describe("stateBadge", () => {
  it("returns non-empty label and classes for every (state, role) pair", () => {
    for (const state of states) {
      for (const role of roles) {
        // drafting is advocate-only in practice, but the function must still handle challenger
        const badge = stateBadge(state, role);
        expect(badge.label.length, `label empty for (${state}, ${role})`).toBeGreaterThan(0);
        expect(badge.classes.length, `classes empty for (${state}, ${role})`).toBeGreaterThan(0);
      }
    }
  });

  it("advocate awaiting differs from challenger awaiting in label", () => {
    const adv = stateBadge("awaiting", "advocate");
    const chal = stateBadge("awaiting", "challenger");
    expect(adv.label).not.toBe(chal.label);
  });

  it("in_progress is green for both roles", () => {
    expect(stateBadge("in_progress", "advocate").classes).toContain("green");
    expect(stateBadge("in_progress", "challenger").classes).toContain("green");
  });

  it("awaiting is yellow for both roles", () => {
    expect(stateBadge("awaiting", "advocate").classes).toContain("yellow");
    expect(stateBadge("awaiting", "challenger").classes).toContain("yellow");
  });

  it("drafting and closed are gray", () => {
    expect(stateBadge("drafting", "advocate").classes).toContain("gray");
    expect(stateBadge("closed", "advocate").classes).toContain("gray");
  });
});

describe("stateRank", () => {
  it("produces strict order: in_progress < awaiting < drafting < closed", () => {
    expect(stateRank("in_progress")).toBeLessThan(stateRank("awaiting"));
    expect(stateRank("awaiting")).toBeLessThan(stateRank("drafting"));
    expect(stateRank("drafting")).toBeLessThan(stateRank("closed"));
  });
});
