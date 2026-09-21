import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, it, vi } from "vitest";
import { csrfProtection } from "../src/middleware/csrf.js";

vi.mock("../src/config/env.js", () => ({
  env: () => ({ frontendOrigins: ["https://frontend.example"] }),
}));

const app = express();
app.use(cookieParser(), csrfProtection);
app.post("/save", (_req, res) => { res.sendStatus(204); });
app.use(((error, _req, res, _next) => {
  res.status(error.status ?? 500).json({ message: error.message });
}) as express.ErrorRequestHandler);

function save(origin?: string, token = "valid") {
  const req = request(app).post("/save")
    .set("Host", "192.168.1.10:3001")
    .set("Cookie", "desk_csrf=valid")
    .set("x-csrf-token", token);
  return origin ? req.set("Origin", origin) : req;
}

describe("CSRF origin validation", () => {
  it("accepts the browser-facing host on a LAN address or alternate port", async () => {
    await save("http://192.168.1.10:3001").expect(204);
  });
  it("accepts an explicitly configured separate frontend", async () => {
    await save("https://frontend.example").expect(204);
  });
  it.each([undefined, "null", "https://evil.example", "http://192.168.1.10:3000", "https://192.168.1.10:3001"])("rejects an untrusted origin: %s", async (origin) => {
    await save(origin).expect(403, { message: "Request origin is not allowed." });
  });
  it("does not trust a client-provided forwarded host", async () => {
    await save("http://evil.example").set("X-Forwarded-Host", "evil.example")
      .expect(403);
  });
  it("still requires matching CSRF tokens for same-origin requests", async () => {
    await save("http://192.168.1.10:3001", "wrong")
      .expect(403, { message: "The CSRF token is invalid." });
  });
});
