import { describe, expect, it } from "vitest";
import { isValidUrl } from "@/lib/debate/nodeConstraints";

// Smoke test for the unit project: proves the runner + `@/*` alias resolve, and
// pins the http(s)-only contract of isValidUrl.
describe("isValidUrl", () => {
  it("accepts http and https urls", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
    expect(isValidUrl("https://example.com/path?q=1")).toBe(true);
  });

  it("rejects non-http(s) and malformed urls", () => {
    expect(isValidUrl("ftp://example.com")).toBe(false);
    expect(isValidUrl("not a url")).toBe(false);
    expect(isValidUrl("")).toBe(false);
  });
});
