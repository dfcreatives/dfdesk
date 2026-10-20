import { Router } from "express";
import rateLimit from "express-rate-limit";
import { UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireActor, requireRole } from "../../middleware/auth.js";
import { ok } from "../../shared/http/respond.js";
import { badRequest, unauthorized } from "../../shared/errors/app-error.js";
import {
  parseCommerceOrderPaidEvent,
  parseCustomOrderSubmittedEvent,
} from "./contracts.js";
import {
  verifyConnectionIntegrationRequest,
  verifyConnectionReadRequest,
  verifyIntegrationRequest,
} from "./integration-auth.js";
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
integrationsRouter.get("/forms", async (request, response) => {
  const clientKey = request.header("x-df-client");
  if (!clientKey) throw unauthorized("Integration authentication failed.");
  const connectionRecord = await prisma.integrationConnection.findFirst({
    where: { clientKey, enabled: true },
  });
  if (!connectionRecord)
    throw unauthorized("Integration authentication failed.");
  verifyConnectionReadRequest(request, clientKey);
  const forms = await prisma.customOrderForm.findMany({
    where: {
      workspaceId: connectionRecord.workspaceId,
      integrationConnectionId: connectionRecord.id,
      enabled: true,
      archivedAt: null,
    },
    include: {
      fields: {
        where: { archivedAt: null },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return ok(response, {
    forms: forms.map((form) => ({
      id: form.id,
      name: form.name,
      isDefault: form.isDefault,
      fields: form.fields.map((field) => ({
        id: field.id,
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        placeholder: field.placeholder,
        helpText: field.helpText,
        options: Array.isArray(field.options) ? field.options : [],
      })),
    })),
  });
});
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
    const clientKey = request.header("x-df-client");
    if (!clientKey) throw unauthorized("Integration authentication failed.");
    const connectionRecord = await prisma.integrationConnection.findFirst({
      where: { clientKey, enabled: true },
    });
    if (!connectionRecord)
      throw unauthorized("Integration authentication failed.");
    const headers =
      clientKey === "frames41"
        ? verifyIntegrationRequest(request, rawBody)
        : verifyConnectionIntegrationRequest(request, rawBody, clientKey);
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
      event.clientId !== clientKey ||
      event.aggregateId !== event.payload.externalId
    )
      throw badRequest("Event headers and payload do not match.");
    const form = await prisma.customOrderForm.findFirst({
      where: {
        ...(event.payload.formId
          ? { id: event.payload.formId }
          : { isDefault: true }),
        workspaceId: connectionRecord.workspaceId,
        integrationConnectionId: connectionRecord.id,
        enabled: true,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!form) throw badRequest("Form is not available for this connection.");
    const result = await importCustomOrder(event, payloadHash(rawBody), {
      workspaceId: connectionRecord.workspaceId,
      connectionId: connectionRecord.id,
      formId: form.id,
    });
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
