import { Router } from "express";
import rateLimit from "express-rate-limit";
import { UserRole } from "@prisma/client";
import { requireActor, requireRole } from "../../middleware/auth.js";
import { ok } from "../../shared/http/respond.js";
import { badRequest } from "../../shared/errors/app-error.js";
import {
  parseCommerceOrderPaidEvent,
  parseCustomOrderSubmittedEvent,
} from "./contracts.js";
import { verifyIntegrationRequest } from "./integration-auth.js";
import {
  connection,
  getSyncState,
  importCustomOrder,
  importOrder,
  payloadHash,
  syncOrder,
} from "./integrations.service.js";

export const integrationsRouter = Router();
const integrationLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
integrationsRouter.get(
  "/connections",
  requireActor,
  async (request, response) => ok(response, [await connection(request.actor!)]),
);
integrationsRouter.get("/connection", requireActor, async (request, response) =>
  ok(response, await connection(request.actor!)),
);
integrationsRouter.get(
  "/orders/:id/sync",
  requireActor,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) =>
    ok(response, {
      sync: await getSyncState(request.actor!, String(request.params.id)),
    }),
);
integrationsRouter.post(
  "/orders/:id/retry",
  requireActor,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) =>
    ok(response, {
      sync: await syncOrder(request.actor!, String(request.params.id)),
    }),
);
integrationsRouter.post(
  "/status/:id",
  requireActor,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) =>
    ok(response, {
      sync: await syncOrder(request.actor!, String(request.params.id)),
    }),
);
integrationsRouter.get(
  "/status/:id",
  requireActor,
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) =>
    ok(response, {
      sync: await getSyncState(request.actor!, String(request.params.id)),
    }),
);
integrationsRouter.post(
  "/orders/custom",
  integrationLimit,
  async (request, response) => {
    const rawBody = request.rawBody;
    if (!rawBody) throw new Error("Raw request body is unavailable.");
    const headers = verifyIntegrationRequest(request, rawBody);
    let event;
    try {
      event = parseCustomOrderSubmittedEvent(request.body);
    } catch (error) {
      throw badRequest(
        error instanceof Error ? error.message : "Invalid custom order event.",
      );
    }
    if (
      headers.eventId !== event.eventId ||
      headers.correlationId !== event.correlationId ||
      event.aggregateId !== event.payload.externalId
    )
      throw badRequest("Event headers and payload do not match.");
    const result = await importCustomOrder(event, payloadHash(rawBody));
    return ok(
      response,
      {
        accepted: true,
        duplicate: result.duplicate,
        deskOrderId: result.order.displayId,
      },
      result.duplicate ? 200 : 201,
    );
  },
);
integrationsRouter.post(
  "/orders/import",
  integrationLimit,
  async (request, response) => {
    const rawBody = request.rawBody;
    if (!rawBody) throw new Error("Raw request body is unavailable.");
    const headers = verifyIntegrationRequest(request, rawBody);
    const event = parseCommerceOrderPaidEvent(request.body);
    if (
      headers.eventId !== event.eventId ||
      headers.correlationId !== event.correlationId ||
      event.aggregateId !== event.payload.externalOrderId
    )
      throw new Error("Event headers and payload do not match.");
    const result = await importOrder(event, payloadHash(rawBody));
    return ok(
      response,
      {
        accepted: true,
        duplicate: result.duplicate,
        deskOrderId: result.order.displayId,
      },
      result.duplicate ? 200 : 201,
    );
  },
);
