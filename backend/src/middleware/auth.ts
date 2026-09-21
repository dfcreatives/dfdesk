import type { RequestHandler } from "express";
import { UserRole } from "@prisma/client";
import { env } from "../config/env.js";
import { forbidden, unauthorized } from "../shared/errors/app-error.js";
import { resolveSession } from "../modules/auth/auth.service.js";

export const loadActor: RequestHandler = async (request, _response, next) => {
  const cookies = request.cookies as
    Record<string, string | undefined> | undefined;
  const actor = await resolveSession(cookies?.[env().COOKIE_NAME]);
  if (actor)
    request.actor = {
      id: actor.id,
      workspaceId: actor.workspaceId,
      name: actor.name,
      role:
        actor.role === "Admin"
          ? UserRole.ADMIN
          : actor.role === "Manager"
            ? UserRole.MANAGER
            : UserRole.EMPLOYEE,
    };
  next();
};

export const requireActor: RequestHandler = (request, _response, next) =>
  request.actor ? next() : next(unauthorized());

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (request, _response, next) =>
    request.actor && roles.includes(request.actor.role)
      ? next()
      : next(forbidden());
}
