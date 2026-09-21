import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL ??=
    "postgresql://desk:desk@localhost:5432/desk?schema=desk";
  process.env.DF_INTEGRATION_SECRET ??=
    "test-secret-that-is-at-least-32-characters-long";
});

describe("integration request authentication", () => {
  it("signs the timestamp and exact raw body", async () => {
    const { signIntegrationBody } =
      await import("../src/modules/integrations/integration-auth.js");
    const timestamp = "1700000000";
    expect(signIntegrationBody(timestamp, '{"a":1}')).not.toBe(
      signIntegrationBody(timestamp, '{"a": 1}'),
    );
    expect(signIntegrationBody(timestamp, '{"a":1}')).toHaveLength(64);
  });
});
