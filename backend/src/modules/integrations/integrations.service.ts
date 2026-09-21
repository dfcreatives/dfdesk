import { createHash, randomUUID } from "node:crypto";
import { Prisma, SyncStatus, UserRole } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../../shared/errors/app-error.js";
import type {
  CommerceOrderPaidEvent,
  CustomOrderFieldValue,
  CustomOrderSubmittedEvent,
  DeskStatusChangedEvent,
} from "./contracts.js";
import { DESK_CLIENT_ID, DESK_STATUS_EVENT } from "./contracts.js";
import { signIntegrationBody } from "./integration-auth.js";

export const payloadHash = (body: string) =>
  createHash("sha256").update(body).digest("hex");

export async function importOrder(event: CommerceOrderPaidEvent, hash: string) {
  return prisma.$transaction(
    async (database) => {
      const prior = await database.integrationInbox.findUnique({
        where: { eventId: event.eventId },
      });
      if (prior) {
        if (prior.payloadHash !== hash)
          throw conflict(
            "The event ID has already been used with a different payload.",
            "IDEMPOTENCY_CONFLICT",
          );
        const order = await database.order.findFirst({
          where: { externalOrderId: event.payload.externalOrderId },
        });
        if (!order)
          throw conflict("The duplicate event has no matching Desk order.");
        return { order, duplicate: true };
      }
      const existing = await database.order.findFirst({
        where: { externalOrderId: event.payload.externalOrderId },
      });
      if (existing)
        throw conflict(
          "This Frames 41 order was previously imported with different data.",
        );
      const workspace = await database.workspace.findFirst();
      if (!workspace)
        throw badRequest("Desk must be set up before orders can be imported.");
      await database.integrationInbox.create({
        data: {
          eventId: event.eventId,
          clientId: event.clientId,
          eventType: event.eventType,
          aggregateId: event.aggregateId,
          payloadHash: hash,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });
      const customer = await database.customer.create({
        data: {
          workspaceId: workspace.id,
          name: event.payload.customer.name,
          email: event.payload.customer.email,
          phone: event.payload.customer.phone,
        },
      });
      await database.integrationConnection.upsert({
        where: {
          workspaceId_clientKey: {
            workspaceId: workspace.id,
            clientKey: "frames41",
          },
        },
        create: {
          workspaceId: workspace.id,
          clientKey: "frames41",
          apiIdentity: "frames41",
          displayName: "Frames 41",
          baseUrl: env().FRAMES41_API_URL ?? null,
          lastHealthyAt: new Date(),
        },
        update: {
          enabled: true,
          lastHealthyAt: new Date(),
          lastHealthError: null,
        },
      });
      const order = await database.order.create({
        data: {
          workspaceId: workspace.id,
          customerId: customer.id,
          displayId: `#F41-${event.payload.externalOrderNumber.replace(/[^a-zA-Z0-9-]/g, "").slice(-24)}`,
          source: "FRAMES_41",
          externalOrderId: event.payload.externalOrderId,
          externalOrderNumber: event.payload.externalOrderNumber,
          importPayloadHash: hash,
          itemSummary: event.payload.items
            .map((item) => `${item.name} × ${item.quantity}`)
            .join(", "),
          status: "Pending",
          color: "orange",
          commerceStatus: event.payload.commerceStatus,
          promisedDeliveryAt: new Date(event.payload.promisedDeliveryAt),
          deadline: new Date(
            event.payload.promisedDeliveryAt.slice(0, 10) + "T00:00:00.000Z",
          ),
          placedAt: new Date(event.payload.placedAt),
          paidAt: new Date(event.payload.paidAt),
          subtotalPaise: BigInt(event.payload.amounts.subtotalPaise),
          discountPaise: BigInt(event.payload.amounts.discountPaise),
          shippingPaise: BigInt(event.payload.amounts.shippingPaise),
          totalPaise: BigInt(event.payload.amounts.totalPaise),
          paidPaise: BigInt(event.payload.amounts.paidPaise),
          balanceDuePaise: BigInt(event.payload.amounts.balanceDuePaise),
          address: {
            create: {
              ...event.payload.shippingAddress,
              line2: event.payload.shippingAddress.line2 ?? null,
            },
          },
          items: {
            create: event.payload.items.map((item) => ({
              externalItemId: item.id,
              productId: item.productId,
              sku: item.sku,
              name: item.name,
              variant: item.variant ?? null,
              quantity: item.quantity,
              unitPricePaise: BigInt(item.unitPricePaise),
              totalPricePaise: BigInt(item.totalPricePaise),
              ...(item.customization
                ? { customization: item.customization as Prisma.InputJsonValue }
                : {}),
              ...(item.imageUrl
                ? {
                    assets: { create: [{ type: "image", url: item.imageUrl }] },
                  }
                : {}),
            })),
          },
          payments: {
            create: [
              {
                workspaceId: workspace.id,
                displayId: `commerce-${event.payload.payment.paymentId}`,
                customerName: event.payload.customer.name,
                source: "COMMERCE",
                method: "Razorpay",
                providerReference: event.payload.payment.paymentId,
                upiPaise: BigInt(event.payload.amounts.paidPaise),
                totalPaise: BigInt(event.payload.amounts.paidPaise),
                receivedAt: new Date(event.payload.payment.capturedAt),
              },
            ],
          },
        },
      });
      await database.integrationInbox.update({
        where: { eventId: event.eventId },
        data: { processedAt: new Date(), result: { deskOrderId: order.id } },
      });
      return { order, duplicate: false };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function customValueIsEmpty(value: CustomOrderFieldValue | undefined) {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function validateImportedCustomValue(
  field: { label: string; type: string; required: boolean; options: unknown },
  value: CustomOrderFieldValue | undefined,
) {
  if (customValueIsEmpty(value)) {
    if (field.required) throw badRequest(`${field.label} is required.`);
    return;
  }
  const options = Array.isArray(field.options)
    ? field.options.filter(
        (option): option is string => typeof option === "string",
      )
    : [];
  const invalid = () => badRequest(`${field.label} has an invalid value.`);
  if (
    ["TEXT", "TEXTAREA", "PHONE", "EMAIL", "DATE", "SELECT"].includes(
      field.type,
    )
  ) {
    if (typeof value !== "string") throw invalid();
    if (field.type === "EMAIL" && !/^\S+@\S+\.\S+$/.test(value))
      throw invalid();
    if (field.type === "PHONE" && value.replace(/\D/g, "").length < 7)
      throw invalid();
    if (field.type === "DATE" && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw invalid();
    if (field.type === "SELECT" && !options.includes(value)) throw invalid();
  } else if (["NUMBER", "CURRENCY"].includes(field.type)) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw invalid();
    if (field.type === "CURRENCY" && value < 0) throw invalid();
  } else if (field.type === "CHECKBOX") {
    if (typeof value !== "boolean") throw invalid();
    if (field.required && value !== true) throw invalid();
  } else if (
    field.type === "MULTI_SELECT" &&
    (!Array.isArray(value) || value.some((entry) => !options.includes(entry)))
  )
    throw invalid();
}

export async function createCustomOrderRecord(
  database: Prisma.TransactionClient,
  workspaceId: string,
  fields: Record<string, CustomOrderFieldValue>,
  options: {
    externalId?: string;
    occurredAt?: Date;
    payloadHash?: string;
  } = {},
) {
  if (options.externalId) {
    const existing = await database.order.findFirst({
      where: { workspaceId, externalOrderId: options.externalId },
    });
    if (existing)
      throw conflict("This external order has already been submitted.");
  }
  const definitions = await database.orderFieldDefinition.findMany({
    where: { workspaceId, archivedAt: null },
    orderBy: { position: "asc" },
  });
  if (!definitions.length)
    throw badRequest("The custom order form has no active fields.");
  const byKey = new Map(definitions.map((field) => [field.key, field]));
  for (const key of Object.keys(fields))
    if (!byKey.has(key)) throw badRequest(`Unknown custom field: ${key}.`);
  for (const field of definitions)
    validateImportedCustomValue(field, fields[field.key]);
  const customer = await database.customer.create({
    data: { workspaceId, name: "Custom form submission" },
  });
  const populatedValues = definitions.flatMap((field) => {
    const value = fields[field.key];
    return customValueIsEmpty(value)
      ? []
      : [{ fieldId: field.id, value: value as Prisma.InputJsonValue }];
  });
  return database.order.create({
    data: {
      workspaceId,
      customerId: customer.id,
      displayId: `#CO-${randomUUID().slice(0, 8).toUpperCase()}`,
      source: "DESK",
      externalOrderId: options.externalId ?? null,
      externalOrderNumber: options.externalId ?? null,
      importPayloadHash: options.payloadHash ?? null,
      itemSummary: "Custom form submission",
      status: "Received",
      color: "orange",
      placedAt: options.occurredAt ?? new Date(),
      ...(populatedValues.length
        ? { customFieldValues: { create: populatedValues } }
        : {}),
    },
    include: { customFieldValues: { include: { field: true } } },
  });
}

export async function importCustomOrder(
  event: CustomOrderSubmittedEvent,
  hash: string,
) {
  return prisma.$transaction(
    async (database) => {
      const prior = await database.integrationInbox.findUnique({
        where: { eventId: event.eventId },
      });
      if (prior) {
        if (prior.payloadHash !== hash)
          throw conflict(
            "The event ID has already been used with a different payload.",
            "IDEMPOTENCY_CONFLICT",
          );
        const order = await database.order.findFirst({
          where: { externalOrderId: event.payload.externalId },
        });
        if (!order)
          throw conflict("The duplicate event has no matching custom order.");
        return { order, duplicate: true };
      }
      const existing = await database.order.findFirst({
        where: { externalOrderId: event.payload.externalId },
      });
      if (existing)
        throw conflict("This external order has already been submitted.");
      const workspace = await database.workspace.findFirst();
      if (!workspace)
        throw badRequest("Desk must be set up before orders can be imported.");
      const definitions = await database.orderFieldDefinition.findMany({
        where: { workspaceId: workspace.id, archivedAt: null },
        orderBy: { position: "asc" },
      });
      const byKey = new Map(definitions.map((field) => [field.key, field]));
      for (const key of Object.keys(event.payload.fields))
        if (!byKey.has(key)) throw badRequest(`Unknown custom field: ${key}.`);
      for (const field of definitions)
        validateImportedCustomValue(field, event.payload.fields[field.key]);
      await database.integrationInbox.create({
        data: {
          eventId: event.eventId,
          clientId: event.clientId,
          eventType: event.eventType,
          aggregateId: event.aggregateId,
          payloadHash: hash,
          payload: event,
        },
      });
      const customer = await database.customer.create({
        data: {
          workspaceId: workspace.id,
          name: "Custom form submission",
        },
      });
      const populatedValues = definitions.flatMap((field) => {
        const value = event.payload.fields[field.key];
        return customValueIsEmpty(value)
          ? []
          : [
              {
                fieldId: field.id,
                value: value as Prisma.InputJsonValue,
              },
            ];
      });
      const order = await database.order.create({
        data: {
          workspaceId: workspace.id,
          customerId: customer.id,
          displayId: `#CO-${randomUUID().slice(0, 8).toUpperCase()}`,
          source: "DESK",
          externalOrderId: event.payload.externalId,
          externalOrderNumber: event.payload.externalId,
          importPayloadHash: hash,
          itemSummary: "Custom form submission",
          status: "Received",
          color: "orange",
          placedAt: new Date(event.occurredAt),
          ...(populatedValues.length
            ? { customFieldValues: { create: populatedValues } }
            : {}),
        },
      });
      await database.integrationInbox.update({
        where: { eventId: event.eventId },
        data: { processedAt: new Date(), result: { deskOrderId: order.id } },
      });
      return { order, duplicate: false };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

const syncLocks = new Set<string>();
export async function syncOrder(
  actor: NonNullable<Express.Request["actor"]>,
  displayId: string,
) {
  if (actor.role === UserRole.EMPLOYEE)
    throw forbidden("Staff access is required.");
  const order = await prisma.order.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      displayId,
      source: "FRAMES_41",
      archivedAt: null,
    },
  });
  if (!order) throw notFound("Imported order was not found.");
  if (!order.syncPayload || !order.syncEventId || !order.syncVersion)
    throw badRequest("The order has no pending status change.");
  if (syncLocks.has(order.id))
    throw conflict(
      "This order is already being synchronized.",
      "SYNC_IN_PROGRESS",
    );
  syncLocks.add(order.id);
  try {
    const baseUrl = env().FRAMES41_API_URL;
    if (!baseUrl) throw new Error("FRAMES41_API_URL is not configured.");
    const body = JSON.stringify(order.syncPayload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/api/v1/integrations/desk/order-status`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-df-client": DESK_CLIENT_ID,
          "x-df-timestamp": timestamp,
          "x-df-signature": `sha256=${signIntegrationBody(timestamp, body)}`,
          "x-df-event-id": order.syncEventId,
          "x-correlation-id":
            (order.syncPayload as { correlationId?: string }).correlationId ??
            order.syncEventId,
          "idempotency-key": order.syncEventId,
        },
        body,
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!response.ok)
      throw new Error(`Frames API returned ${response.status}.`);
    await prisma.order.updateMany({
      where: { id: order.id, syncVersion: order.syncVersion },
      data: {
        syncStatus: SyncStatus.SYNCED,
        syncAttemptedAt: new Date(),
        syncError: null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Unknown synchronization error.";
    await prisma.order.updateMany({
      where: { id: order.id, syncVersion: order.syncVersion },
      data: {
        syncStatus: SyncStatus.FAILED,
        syncAttemptedAt: new Date(),
        syncError: message,
      },
    });
  } finally {
    syncLocks.delete(order.id);
  }
  return prisma.order.findUnique({
    where: { id: order.id },
    select: {
      syncEventId: true,
      syncStatus: true,
      syncAttemptedAt: true,
      syncError: true,
      syncVersion: true,
    },
  });
}

export async function getSyncState(
  actor: NonNullable<Express.Request["actor"]>,
  displayId: string,
) {
  if (actor.role === UserRole.EMPLOYEE)
    throw forbidden("Staff access is required.");
  const order = await prisma.order.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      displayId,
      source: "FRAMES_41",
      archivedAt: null,
    },
    select: {
      syncEventId: true,
      syncStatus: true,
      syncAttemptedAt: true,
      syncError: true,
      syncVersion: true,
    },
  });
  if (!order) throw notFound("Imported order was not found.");
  return order.syncEventId
    ? {
        eventId: order.syncEventId,
        status: order.syncStatus,
        attempts: order.syncAttemptedAt ? 1 : 0,
        maxAttempts: 1,
        lastError: order.syncError,
        deliveredAt:
          order.syncStatus === SyncStatus.SYNCED
            ? (order.syncAttemptedAt?.toISOString() ?? null)
            : null,
        updatedAt:
          order.syncAttemptedAt?.toISOString() ?? new Date(0).toISOString(),
      }
    : null;
}

export async function connection(actor: NonNullable<Express.Request["actor"]>) {
  const stored = await prisma.integrationConnection.findUnique({
    where: {
      workspaceId_clientKey: {
        workspaceId: actor.workspaceId,
        clientKey: "frames41",
      },
    },
  });
  return {
    connected: Boolean(stored?.enabled && stored.lastHealthyAt),
    websiteName: stored?.displayName ?? "Frames 41",
  };
}

export function statusEvent(
  order: {
    syncEventId: string;
    externalOrderId: string;
    externalOrderNumber: string;
    displayId: string;
    status: string;
  },
  actor: NonNullable<Express.Request["actor"]>,
): DeskStatusChangedEvent {
  const commerceStatus =
    order.status === "Completed"
      ? "READY_TO_SHIP"
      : order.status === "Cancelled"
        ? "CANCELLED"
        : "PROCESSING";
  return {
    eventId: order.syncEventId,
    eventType: DESK_STATUS_EVENT,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    source: "desk",
    clientId: DESK_CLIENT_ID,
    correlationId: randomUUID(),
    aggregateId: order.externalOrderId,
    payload: {
      externalOrderId: order.externalOrderId,
      externalOrderNumber: order.externalOrderNumber,
      deskOrderId: order.displayId,
      deskStatus:
        order.status as DeskStatusChangedEvent["payload"]["deskStatus"],
      commerceStatus,
      changedBy: { id: actor.id, name: actor.name, role: actor.role },
    },
  };
}
