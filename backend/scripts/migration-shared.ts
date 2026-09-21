import { createHash } from "node:crypto";
import { UserRole, type Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { workspaceSchema } from "../src/modules/legacy-workspace/legacy-workspace.schema.js";
import { saveWorkspace } from "../src/modules/legacy-workspace/legacy-workspace.service.js";

type LegacyDatabase = {
  employees?: Array<Record<string, unknown>>;
  staff?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  payments?: Array<Record<string, unknown>>;
};
export type LegacyInboxEvent = {
  event_id: string;
  client_id: string;
  event_type: string;
  aggregate_id: string;
  payload_hash: string;
  payload: unknown;
  received_at: Date;
  processed_at: Date | null;
};
export const checksum = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const deterministicUuid = (value: string) => {
  const hex = createHash("sha256")
    .update(`desk-legacy:${value}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
};
const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : deterministicUuid(String(value));

export function normalizeLegacy(input: LegacyDatabase) {
  const value = structuredClone(input);
  const idMap = new Map<string, string>();
  for (const user of [...(value.employees ?? []), ...(value.staff ?? [])]) {
    const old = String(user.id);
    const next = uuid(old);
    idMap.set(old, next);
    user.id = next;
  }
  for (const task of value.tasks ?? []) {
    if (typeof task.ownerId === "string")
      task.ownerId = idMap.get(task.ownerId) ?? uuid(task.ownerId);
    if (Array.isArray(task.collaborators))
      for (const collaborator of task.collaborators as Array<
        Record<string, unknown>
      >)
        collaborator.employeeId =
          idMap.get(String(collaborator.employeeId)) ??
          uuid(collaborator.employeeId);
  }
  for (const order of value.orders ?? [])
    if (typeof order.assignedEmployeeId === "string")
      order.assignedEmployeeId =
        idMap.get(order.assignedEmployeeId) ?? uuid(order.assignedEmployeeId);
  return workspaceSchema.parse({
    employees: value.employees ?? [],
    staff: value.staff ?? [],
    tasks: value.tasks ?? [],
    orders: value.orders ?? [],
    payments: value.payments ?? [],
  });
}

export async function migrateNormalized(
  raw: LegacyDatabase,
  revision: bigint,
  sourceChecksum: string,
  inboxEvents: LegacyInboxEvent[] = [],
) {
  const normalized = normalizeLegacy(raw);
  return prisma.$transaction(
    async (database) => {
      const existingRun = await database.migrationRun.findUnique({
        where: {
          sourceRevision_sourceChecksum: {
            sourceRevision: revision,
            sourceChecksum,
          },
        },
      });
      if (existingRun) return { duplicate: true, counts: existingRun.counts };
      const existingWorkspace = await database.workspace.findUnique({
        where: { slug: "desk" },
      });
      const workspace =
        existingWorkspace ??
        (await database.workspace.create({
          data: { name: "Desk", slug: "desk" },
        }));
      const currentUsers = await database.user.count({
        where: { workspaceId: workspace.id },
      });
      if (currentUsers && !existingRun)
        throw new Error(
          "The desk schema already contains users but no matching migration record. Refusing to merge ambiguous data.",
        );
      const rawUsers = [...(raw.employees ?? []), ...(raw.staff ?? [])];
      for (const [index, user] of [
        ...normalized.employees,
        ...normalized.staff,
      ].entries()) {
        const source = rawUsers[index];
        const passwordHash =
          typeof source?.passwordHash === "string" ? source.passwordHash : null;
        if (!passwordHash)
          throw new Error(`Legacy account ${user.name} has no password hash.`);
        const isEmployee = index < normalized.employees.length;
        await database.user.create({
          data: {
            id: user.id,
            workspaceId: workspace.id,
            loginName: user.name,
            normalizedName: user.name.toLocaleLowerCase(),
            passwordHash,
            role: isEmployee
              ? UserRole.EMPLOYEE
              : (user as (typeof normalized.staff)[number]).role === "Admin"
                ? UserRole.ADMIN
                : UserRole.MANAGER,
            jobTitle: isEmployee
              ? (user as (typeof normalized.employees)[number]).role
              : null,
            initials: "initials" in user ? user.initials : null,
            color: "color" in user ? user.color : null,
            active: "active" in user ? user.active : true,
          },
        });
      }
      const admin = await database.user.findFirstOrThrow({
        where: { workspaceId: workspace.id, role: UserRole.ADMIN },
      });
      const writable = {
        ...normalized,
        orders: normalized.orders.map((order) => ({
          ...order,
          source: "Desk" as const,
        })),
        payments: normalized.payments.map((payment) => ({
          ...payment,
          source: "Manual" as const,
        })),
      };
      await saveWorkspace(
        writable,
        {
          id: admin.id,
          workspaceId: workspace.id,
          name: admin.loginName,
          role: UserRole.ADMIN,
        },
        { transaction: database },
      );
      for (const source of normalized.orders.filter(
        (order) => order.source === "Frames 41",
      )) {
        const order = await database.order.findFirstOrThrow({
          where: { workspaceId: workspace.id, displayId: source.id },
        });
        await database.order.update({
          where: { id: order.id },
          data: {
            source: "FRAMES_41",
            externalOrderId: source.externalOrderId ?? null,
            externalOrderNumber: source.externalOrderNumber ?? null,
            importPayloadHash: source.importPayloadHash ?? null,
            commerceStatus: source.commerceStatus ?? null,
            promisedDeliveryAt: source.promisedDeliveryAt
              ? new Date(source.promisedDeliveryAt)
              : null,
            placedAt: source.placedAt ? new Date(source.placedAt) : null,
            paidAt: source.paidAt ? new Date(source.paidAt) : null,
            subtotalPaise: BigInt(source.subtotalPaise ?? 0),
            discountPaise: BigInt(source.discountPaise ?? 0),
            shippingPaise: BigInt(source.shippingPaise ?? 0),
            totalPaise: BigInt(source.totalPaise ?? 0),
            paidPaise: BigInt(source.paidPaise ?? 0),
            balanceDuePaise: BigInt(source.balanceDuePaise ?? 0),
            ...(source.shippingAddress
              ? {
                  address: {
                    create: {
                      ...source.shippingAddress,
                      line2: source.shippingAddress.line2 ?? null,
                    },
                  },
                }
              : {}),
            ...(source.lineItems?.length
              ? {
                  items: {
                    create: source.lineItems.map((item) => ({
                      externalItemId: item.id,
                      productId: item.productId,
                      sku: item.sku,
                      name: item.name,
                      variant: item.variant ?? null,
                      quantity: item.quantity,
                      unitPricePaise: BigInt(item.unitPricePaise),
                      totalPricePaise: BigInt(item.totalPricePaise),
                      ...(item.customization
                        ? {
                            customization:
                              item.customization as Prisma.InputJsonValue,
                          }
                        : {}),
                      ...(item.imageUrl
                        ? {
                            assets: {
                              create: [{ type: "image", url: item.imageUrl }],
                            },
                          }
                        : {}),
                    })),
                  },
                }
              : {}),
          },
        });
      }
      for (const source of normalized.payments.filter(
        (payment) => payment.source === "Commerce",
      ))
        await database.payment.updateMany({
          where: { workspaceId: workspace.id, displayId: source.id },
          data: { source: "COMMERCE" },
        });
      for (const event of inboxEvents) {
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            event.event_id,
          )
        )
          throw new Error(
            `Integration event ID ${event.event_id} is not a UUID and cannot be preserved safely.`,
          );
        await database.integrationInbox.create({
          data: {
            eventId: event.event_id,
            clientId: event.client_id,
            eventType: event.event_type,
            aggregateId: event.aggregate_id,
            payloadHash: event.payload_hash,
            payload: event.payload as Prisma.InputJsonValue,
            receivedAt: event.received_at,
            processedAt: event.processed_at,
          },
        });
      }
      const counts = {
        users: normalized.employees.length + normalized.staff.length,
        attendance: normalized.employees.reduce(
          (sum, user) => sum + (user.attendanceRecords?.length ?? 0),
          0,
        ),
        tasks: normalized.tasks.length,
        orders: normalized.orders.length,
        payments: normalized.payments.length,
        integrationEvents: inboxEvents.length,
      };
      await database.migrationRun.create({
        data: {
          workspaceId: workspace.id,
          sourceRevision: revision,
          sourceChecksum,
          counts,
          result: "completed",
        },
      });
      return { duplicate: false, counts };
    },
    {
      isolationLevel: "Serializable",
      timeout: 30_000,
    },
  );
}
