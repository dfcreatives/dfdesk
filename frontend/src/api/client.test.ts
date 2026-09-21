import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";

describe("ApiError", () => {
  it("keeps stable problem details", () => {
    const error = new ApiError({
      type: "about:blank",
      title: "Denied",
      status: 403,
      detail: "No access",
      code: "FORBIDDEN",
    });
    expect(error.message).toBe("No access");
    expect(error.problem.code).toBe("FORBIDDEN");
  });
});
