import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
} from "../src/shared/security/password.js";

describe("password hashing", () => {
  it("uses a unique salt and verifies only the original password", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    await expect(
      verifyPassword("correct horse battery staple", first),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong password", first)).resolves.toBe(false);
  });
});
