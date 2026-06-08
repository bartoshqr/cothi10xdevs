import { describe, expect, it } from "vitest";
import { isLegalRelationTarget } from "@/lib/debate/relationRules";

// D1 oracle (research §"Risk #3 / D1"): the only structural constraint on a
// relation's target is that a `link` must point at a connective node. The other
// three kinds are legal any→any (FR-014/016). The rule mirrors the client gate
// in ConnectKindPicker (`link` only offered when the target is connective), but
// must hold server-side too — the canvas can be bypassed via the API.
describe("isLegalRelationTarget", () => {
  it("allows link only when the target is a connective", () => {
    expect(isLegalRelationTarget("link", "connective")).toBe(true);
    expect(isLegalRelationTarget("link", "statement")).toBe(false);
  });

  it.each(["supports", "rephrases", "rebuts"] as const)("allows %s on any target kind", (kind) => {
    expect(isLegalRelationTarget(kind, "connective")).toBe(true);
    expect(isLegalRelationTarget(kind, "statement")).toBe(true);
  });
});
