import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

beforeAll(() => {
  process.env.DATABASE_URL ??=
    "postgresql://desk:desk@localhost:5432/desk?schema=desk";
  process.env.DF_INTEGRATION_SECRET ??=
    "test-secret-that-is-at-least-32-characters-long";
  process.env.FRONTEND_ORIGINS ??= "http://localhost:3000";
});

describe("HTTP boundary", () => {
  it("returns an enveloped health response with hardened headers", async () => {
    const { createApp } = await import("../src/app.js");
    const response = await request(createApp()).get("/api/v1/health").expect(200);
    expect(response.body).toMatchObject({ data: { status: "ok" }, meta: { requestId: expect.any(String) } });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("uses problem details for unknown endpoints", async () => {
    const { createApp } = await import("../src/app.js");
    const response = await request(createApp()).get("/missing").expect(404);
    expect(response.type).toBe("application/problem+json");
    expect(response.body.code).toBe("NOT_FOUND");
  });
});
