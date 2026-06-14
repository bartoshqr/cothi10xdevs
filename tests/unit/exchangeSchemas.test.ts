import { describe, expect, it } from "vitest";
import { openExchangeSchema, respondInviteSchema, usernameSearchSchema } from "@/lib/exchange/schemas";
import { ROUND_COUNT } from "@/lib/exchange/constants";

const VALID_UUID = "00000000-0000-4000-8000-000000000001";
const OTHER_UUID = "00000000-0000-4000-8000-000000000002";

describe("openExchangeSchema", () => {
  const valid = { debateId: VALID_UUID, challengerId: OTHER_UUID, roundCount: 3 };

  it("accepts valid round counts at the bounds", () => {
    expect(openExchangeSchema.safeParse({ ...valid, roundCount: ROUND_COUNT.min }).success).toBe(true);
    expect(openExchangeSchema.safeParse({ ...valid, roundCount: ROUND_COUNT.max }).success).toBe(true);
    expect(openExchangeSchema.safeParse({ ...valid, roundCount: ROUND_COUNT.default }).success).toBe(true);
  });

  it("rejects round count below minimum", () => {
    expect(openExchangeSchema.safeParse({ ...valid, roundCount: 0 }).success).toBe(false);
  });

  it("rejects round count above maximum", () => {
    expect(openExchangeSchema.safeParse({ ...valid, roundCount: 6 }).success).toBe(false);
  });

  it("rejects non-integer round count", () => {
    expect(openExchangeSchema.safeParse({ ...valid, roundCount: 2.5 }).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(openExchangeSchema.safeParse({ ...valid, extra: "field" }).success).toBe(false);
  });

  it("rejects invalid uuid", () => {
    expect(openExchangeSchema.safeParse({ ...valid, debateId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("respondInviteSchema", () => {
  it("accepts true and false", () => {
    expect(respondInviteSchema.safeParse({ accept: true }).success).toBe(true);
    expect(respondInviteSchema.safeParse({ accept: false }).success).toBe(true);
  });

  it("rejects missing accept field", () => {
    expect(respondInviteSchema.safeParse({}).success).toBe(false);
  });

  it("rejects non-boolean accept", () => {
    expect(respondInviteSchema.safeParse({ accept: "yes" }).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(respondInviteSchema.safeParse({ accept: true, extra: "field" }).success).toBe(false);
  });
});

describe("usernameSearchSchema", () => {
  it("accepts empty string (match-all)", () => {
    const result = usernameSearchSchema.safeParse({ username: "" });
    expect(result.success).toBe(true);
    expect(result.data?.username).toBe("");
  });

  it("accepts partial substring", () => {
    const result = usernameSearchSchema.safeParse({ username: "ali" });
    expect(result.success).toBe(true);
    expect(result.data?.username).toBe("ali");
  });

  it("defaults to empty string when username is omitted", () => {
    const result = usernameSearchSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.username).toBe("");
  });

  it("rejects queries exceeding max length (30)", () => {
    expect(usernameSearchSchema.safeParse({ username: "a".repeat(31) }).success).toBe(false);
  });

  it("accepts underscores in query and passes them unescaped to schema (escaping happens in searchUsersByUsername)", () => {
    // Pins the LIKE-escaping contract: schema allows `_`, but searchUsersByUsername
    // applies escapeLikeChars before .ilike to match literals. See users.ts.
    const result = usernameSearchSchema.safeParse({ username: "user_name" });
    expect(result.success).toBe(true);
    expect(result.data?.username).toBe("user_name");
  });
});
