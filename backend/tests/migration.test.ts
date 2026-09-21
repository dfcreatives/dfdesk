import { describe, expect, it } from "vitest";
import { deterministicUuid } from "../scripts/migration-shared.js";

describe("legacy identifier mapping", () => {
  it("is stable and produces an RFC 4122 UUID", () => {
    const first = deterministicUuid("legacy-employee-42");
    expect(first).toBe(deterministicUuid("legacy-employee-42"));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first).not.toBe(deterministicUuid("legacy-employee-43"));
  });
});
