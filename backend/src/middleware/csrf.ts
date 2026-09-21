import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { forbidden } from "../shared/errors/app-error.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
export const csrfProtection: RequestHandler = (request, _response, next) => {
  if (
    safeMethods.has(request.method) ||
    request.path === "/api/v1/auth/login" ||
    request.path === "/api/v1/auth/bootstrap" ||
    request.path === "/api/auth/login" ||
    request.path === "/api/auth/bootstrap" ||
    request.path.startsWith("/api/v1/integrations/desk/") ||
    request.path === "/api/v1/integrations/orders/import" ||
    request.path === "/api/v1/integrations/orders/custom"
  )
    return next();
  const origin = request.header("origin");
  // Compare against Host, not forwarded-host: the proxy must preserve the
  // browser-facing host rather than letting a client choose a trusted origin.
  const sameOrigin = `${request.protocol}://${request.get("host")}`;
  if (
    !origin ||
    (origin !== sameOrigin &&
      !env().frontendOrigins.includes(origin.replace(/\/$/, "")))
  )
    return next(forbidden("Request origin is not allowed."));
  const cookies = request.cookies as
    Record<string, string | undefined> | undefined;
  const cookie = cookies?.desk_csrf;
  const header = request.header("x-csrf-token");
  if (!cookie || !header) return next(forbidden("A CSRF token is required."));
  const left = Buffer.from(cookie);
  const right = Buffer.from(header);
  return left.length === right.length && timingSafeEqual(left, right)
    ? next()
    : next(forbidden("The CSRF token is invalid."));
};
