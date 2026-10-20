import { describe, expect, it } from "vitest";
import { validateLoginCredentials } from "./login-validation";

describe("validateLoginCredentials", () => {
  it("requires both credentials", () => {
    expect(validateLoginCredentials("", "")).toEqual({
      name: "Enter your login name.",
      password: "Enter your password.",
    });
  });

  it("matches the backend credential length limits", () => {
    expect(validateLoginCredentials("a", "1234567")).toEqual({
      name: "Login name must contain at least 2 characters.",
      password: "Password must contain at least 8 characters.",
    });
    expect(validateLoginCredentials("a".repeat(81), "a".repeat(257))).toEqual({
      name: "Login name cannot exceed 80 characters.",
      password: "Password cannot exceed 256 characters.",
    });
  });

  it("accepts valid credentials and ignores surrounding name whitespace", () => {
    expect(validateLoginCredentials("  admin  ", "password")).toEqual({});
  });
});
