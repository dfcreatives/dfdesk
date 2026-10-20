import { UserRole } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireActor, requireRole } from "../../middleware/auth.js";
import { badRequest, notFound } from "../../shared/errors/app-error.js";
import { ok } from "../../shared/http/respond.js";
import { deriveConnectionSecret } from "../integrations/integration-auth.js";

export const orderFormsRouter = Router();
orderFormsRouter.use(requireActor);

const connectionInput = z.object({
  displayName: z.string().trim().min(1).max(120),
  baseUrl: z.url().optional(),
});
const formInput = z.object({
  name: z.string().trim().min(1).max(120),
  integrationConnectionId: z.uuid(),
});
const formPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
});

orderFormsRouter.get("/connections", async (request, response) => {
  const connections = await prisma.integrationConnection.findMany({
    where: { workspaceId: request.actor!.workspaceId },
    include: { _count: { select: { forms: true } } },
    orderBy: { createdAt: "asc" },
  });
  return ok(response, {
    connections: connections.map((connection) => ({
      id: connection.id,
      clientKey: connection.clientKey,
      displayName: connection.displayName,
      apiIdentity: connection.apiIdentity,
      baseUrl: connection.baseUrl,
      enabled: connection.enabled,
      formCount: connection._count.forms,
      legacy: connection.clientKey === "frames41",
    })),
  });
});

orderFormsRouter.post(
  "/connections",
  requireRole(UserRole.ADMIN),
  async (request, response) => {
    const input = connectionInput.parse(request.body);
    const clientKey = `commerce_${randomBytes(18).toString("hex")}`;
    const identityBase = input.displayName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "store";
    const connection = await prisma.integrationConnection.create({
      data: {
        workspaceId: request.actor!.workspaceId,
        clientKey,
        apiIdentity: `${identityBase}_${randomBytes(3).toString("hex")}`,
        displayName: input.displayName,
        baseUrl: input.baseUrl ?? null,
      },
    });
    return ok(
      response,
      {
        connection: {
          id: connection.id,
          clientKey: connection.clientKey,
          displayName: connection.displayName,
          apiIdentity: connection.apiIdentity,
          baseUrl: connection.baseUrl,
          enabled: connection.enabled,
        },
        signingSecret: deriveConnectionSecret(clientKey),
      },
      201,
    );
  },
);

orderFormsRouter.patch(
  "/connections/:id",
  requireRole(UserRole.ADMIN),
  async (request, response) => {
    const id = z.uuid().parse(request.params.id);
    const patch = z
      .object({ enabled: z.boolean(), displayName: z.string().trim().min(1).max(120).optional() })
      .strict()
      .parse(request.body);
    const result = await prisma.integrationConnection.updateMany({
      where: { id, workspaceId: request.actor!.workspaceId },
      data: {
        enabled: patch.enabled,
        ...(patch.displayName ? { displayName: patch.displayName } : {}),
      },
    });
    if (!result.count) throw notFound("Integration connection was not found.");
    return ok(response, { updated: true });
  },
);

orderFormsRouter.get("/", async (request, response) => {
  const forms = await prisma.customOrderForm.findMany({
    where: { workspaceId: request.actor!.workspaceId, archivedAt: null },
    include: {
      integrationConnection: {
        select: { id: true, clientKey: true, displayName: true, enabled: true },
      },
      _count: { select: { fields: true, orders: true } },
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return ok(response, {
    forms: forms.map((form) => ({
      id: form.id,
      name: form.name,
      isDefault: form.isDefault,
      enabled: form.enabled,
      integrationConnection: form.integrationConnection,
      fieldCount: form._count.fields,
      orderCount: form._count.orders,
    })),
  });
});

orderFormsRouter.post(
  "/",
  requireRole(UserRole.ADMIN),
  async (request, response) => {
    const input = formInput.parse(request.body);
    const connection = await prisma.integrationConnection.findFirst({
      where: {
        id: input.integrationConnectionId,
        workspaceId: request.actor!.workspaceId,
        enabled: true,
      },
      select: { id: true },
    });
    if (!connection)
      throw badRequest("Choose an enabled ecommerce connection.");
    const form = await prisma.customOrderForm.create({
      data: {
        workspaceId: request.actor!.workspaceId,
        integrationConnectionId: connection.id,
        name: input.name,
      },
    });
    return ok(response, { form: { id: form.id, name: form.name } }, 201);
  },
);

orderFormsRouter.patch(
  "/:id",
  requireRole(UserRole.ADMIN),
  async (request, response) => {
    const id = z.uuid().parse(request.params.id);
    const patch = formPatch.strict().parse(request.body);
    if (!Object.keys(patch).length)
      throw badRequest("Provide a form name or enabled state.");
    const result = await prisma.customOrderForm.updateMany({
      where: {
        id,
        workspaceId: request.actor!.workspaceId,
        archivedAt: null,
        ...(patch.enabled === false ? { isDefault: false } : {}),
      },
      data: {
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      },
    });
    if (!result.count) throw notFound("Form was not found or cannot be disabled.");
    return ok(response, { updated: true });
  },
);

orderFormsRouter.delete(
  "/:id",
  requireRole(UserRole.ADMIN),
  async (request, response) => {
    const id = z.uuid().parse(request.params.id);
    const form = await prisma.customOrderForm.findFirst({
      where: { id, workspaceId: request.actor!.workspaceId, archivedAt: null },
      select: { isDefault: true },
    });
    if (!form) throw notFound("Form was not found.");
    if (form.isDefault) throw badRequest("The default form cannot be archived.");
    await prisma.customOrderForm.update({
      where: { id },
      data: { archivedAt: new Date(), enabled: false },
    });
    return response.status(204).send();
  },
);
