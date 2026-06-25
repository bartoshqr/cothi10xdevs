import { describe, expect, it } from "vitest";
import { updateDebateSchema } from "@/lib/debate/schemas";

// D3-3c: the new PATCH /api/debates/:id surface must stay narrow. Only
// `rootNodeId` is persisted this phase; the schema is the whitelist that keeps
// an attacker (or a future careless caller) from writing arbitrary debate columns.
describe("updateDebateSchema (PATCH /api/debates/:id whitelist)", () => {
  it("accepts a valid rootNodeId", () => {
    const parsed = updateDebateSchema.safeParse({ rootNodeId: "00000000-0000-4000-8000-000000000001" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-uuid rootNodeId", () => {
    const parsed = updateDebateSchema.safeParse({ rootNodeId: "not-a-uuid" });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown fields rather than silently passing them through", () => {
    const parsed = updateDebateSchema.safeParse({
      rootNodeId: "00000000-0000-4000-8000-000000000001",
      ownerId: "00000000-0000-4000-8000-000000000099",
      title: "hijacked",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a public boolean (S-09 publish toggle)", () => {
    expect(updateDebateSchema.safeParse({ public: true }).success).toBe(true);
    expect(updateDebateSchema.safeParse({ public: false }).success).toBe(true);
  });

  it("rejects a non-boolean public value", () => {
    expect(updateDebateSchema.safeParse({ public: "true" }).success).toBe(false);
  });
});
