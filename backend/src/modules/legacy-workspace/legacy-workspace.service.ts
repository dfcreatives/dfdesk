import { PaymentSource, Prisma, TaskStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import type { SessionUser, Workspace } from "../../shared/domain/types.js";
import { prisma } from "../../lib/prisma.js";
import { badRequest, forbidden } from "../../shared/errors/app-error.js";
import { hashPassword } from "../../shared/security/password.js";
import { workspaceSchema } from "./legacy-workspace.schema.js";
import { syncOrder } from "../integrations/integrations.service.js";

type Actor =
  | { id: string; workspaceId: string; name: string; role: UserRole }
  | (SessionUser & { workspaceId: string });
const roleLabel = (role: UserRole) =>
  role === UserRole.ADMIN
    ? ("Admin" as const)
    : role === UserRole.MANAGER
      ? ("Manager" as const)
      : ("Employee" as const);
const toRole = (role: "Admin" | "Manager") =>
  role === "Admin" ? UserRole.ADMIN : UserRole.MANAGER;
const toTaskStatus = (status: string) =>
  ({
    "Not started": TaskStatus.NOT_STARTED,
    "In progress": TaskStatus.IN_PROGRESS,
    Blocked: TaskStatus.BLOCKED,
    Completed: TaskStatus.COMPLETED,
  })[status] ?? TaskStatus.NOT_STARTED;
const fromTaskStatus = (status: TaskStatus) =>
  ({
    NOT_STARTED: "Not started",
    IN_PROGRESS: "In progress",
    BLOCKED: "Blocked",
    COMPLETED: "Completed",
  })[status] as "Not started" | "In progress" | "Blocked" | "Completed";
const safeNumber = (value: bigint) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new Error(
      "A stored money value exceeds the safe JSON integer range.",
    );
  return number;
};
const asDate = (value?: string | number | null) =>
  value ? new Date(value) : null;
const dateOnly = (value: Date | null) =>
  value?.toISOString().slice(0, 10) ?? "";
const sourceLabel = (value: string) =>
  value === "FRAMES_41" ? ("Frames 41" as const) : ("Desk" as const);
const paymentSourceLabel = (value: string) =>
  value === "COMMERCE"
    ? ("Commerce" as const)
    : value === "ADVANCE"
      ? ("Advance" as const)
      : ("Manual" as const);
const formatRupees = (paise: bigint) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(safeNumber(paise) / 100);

export async function getWorkspace(actor: Actor): Promise<Workspace> {
  const role =
    "role" in actor && typeof actor.role === "string"
      ? actor.role
      : UserRole.EMPLOYEE;
  const workspaceId = actor.workspaceId;
  const [users, tasks, orders, payments] = await Promise.all([
    prisma.user.findMany({
      where: { workspaceId, archivedAt: null },
      include: {
        attendance: { orderBy: { clockIn: "asc" } },
        manualAttendance: { include: { markedBy: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.task.findMany({
      where: { workspaceId, archivedAt: null },
      include: {
        lead: true,
        assignees: { include: { user: true } },
        order: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.order.findMany({
      where: { workspaceId, archivedAt: null },
      include: {
        customer: true,
        assignedUser: true,
        address: true,
        items: { include: { assets: true } },
        payments: true,
        customFieldValues: {
          where: { field: { archivedAt: null } },
          include: { field: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.payment.findMany({
      where: { workspaceId },
      include: { order: true },
      orderBy: { receivedAt: "asc" },
    }),
  ]);
  const visibleTasks =
    role === UserRole.EMPLOYEE || role === "Employee"
      ? tasks.filter(
          (task) =>
            task.leadId === actor.id ||
            task.assignees.some((entry) => entry.userId === actor.id),
        )
      : tasks;
  const visibleOrderIds = new Set(
    visibleTasks.map((task) => task.orderId).filter(Boolean),
  );
  const visibleOrders =
    role === UserRole.EMPLOYEE || role === "Employee"
      ? orders.filter((order) => visibleOrderIds.has(order.id))
      : orders;
  const attendanceFields = (user: (typeof users)[number]) => ({
    attendanceSeconds: user.attendance.reduce(
      (sum, record) => sum + record.durationSeconds,
      0,
    ),
    attendanceStartedAt:
      user.attendance.find((record) => !record.clockOut)?.clockIn.getTime() ??
      null,
    attendanceRecords: user.attendance.map((record) => ({
      id: record.id,
      date: dateOnly(record.workDate),
      clockIn: record.clockIn.getTime(),
      clockOut: record.clockOut?.getTime() ?? null,
      durationSeconds: record.durationSeconds,
    })),
  });
  const employees = users
    .filter(
      (user) =>
        user.role === UserRole.EMPLOYEE &&
        ((role !== UserRole.EMPLOYEE && role !== "Employee") ||
          user.id === actor.id),
    )
    .map((user) => ({
      id: user.id,
      name: user.loginName,
      role: user.jobTitle ?? "Employee",
      initials: user.initials ?? user.loginName.slice(0, 2).toUpperCase(),
      color: user.color ?? "orange",
      hours: "0h 0m",
      task:
        tasks.find((task) => task.leadId === user.id)?.title ??
        "No active task",
      active: user.active,
      ...attendanceFields(user),
      manualAttendance: user.manualAttendance.map((entry) => ({
        date: dateOnly(entry.workDate),
        status:
          entry.status === "ABSENT"
            ? ("Absent" as const)
            : ("Present" as const),
        markedAt: entry.updatedAt.getTime(),
        markedBy: entry.markedBy.loginName,
      })),
    }));
  const staff =
    role === UserRole.EMPLOYEE || role === "Employee"
      ? []
      : users
          .filter((user) => user.role !== UserRole.EMPLOYEE)
          .map((user) => ({
            id: user.id,
            name: user.loginName,
            role: roleLabel(user.role) as "Admin" | "Manager",
            ...attendanceFields(user),
          }));
  return {
    employees,
    staff,
    tasks: visibleTasks.map((task) => ({
      title: task.title,
      ...(task.order ? { orderId: task.order.displayId } : {}),
      owner: task.lead?.loginName ?? "Unassigned",
      ...(task.leadId ? { ownerId: task.leadId } : {}),
      ...(task.leadResponsibility
        ? { leadResponsibility: task.leadResponsibility }
        : {}),
      collaborators: task.assignees
        .filter((entry) => !entry.isLead)
        .map((entry) => ({
          employeeId: entry.userId,
          name: entry.user.loginName,
          responsibility: entry.responsibility,
        })),
      due: dateOnly(task.deadline),
      progress: task.progress,
      tone: task.tone ?? "orange",
      completed: task.status === TaskStatus.COMPLETED,
      ...(task.completedAt ? { completedAt: task.completedAt.getTime() } : {}),
      status: fromTaskStatus(task.status),
    })),
    orders: visibleOrders.map((order) => ({
      id: order.displayId,
      createdAt: order.createdAt.getTime(),
      source: sourceLabel(order.source),
      ...(order.externalOrderId
        ? { externalOrderId: order.externalOrderId }
        : {}),
      ...(order.externalOrderNumber
        ? { externalOrderNumber: order.externalOrderNumber }
        : {}),
      ...(order.importPayloadHash
        ? { importPayloadHash: order.importPayloadHash }
        : {}),
      customer: order.customer.name,
      ...(order.customer.phone ? { customerMobile: order.customer.phone } : {}),
      ...(order.customer.email ? { customerEmail: order.customer.email } : {}),
      item: order.itemSummary,
      value: formatRupees(order.totalPaise),
      advanceAmount: safeNumber(order.paidPaise) / 100,
      ...(order.address
        ? {
            shippingAddress: {
              line1: order.address.line1,
              ...(order.address.line2 ? { line2: order.address.line2 } : {}),
              city: order.address.city,
              state: order.address.state,
              pincode: order.address.pincode,
            },
          }
        : {}),
      lineItems: order.items.map((item) => ({
        id: item.externalItemId ?? item.id,
        productId: item.productId ?? "",
        sku: item.sku ?? "",
        name: item.name,
        ...(item.assets[0]?.url ? { imageUrl: item.assets[0].url } : {}),
        quantity: item.quantity,
        unitPricePaise: safeNumber(item.unitPricePaise),
        totalPricePaise: safeNumber(item.totalPricePaise),
        ...(item.variant ? { variant: item.variant } : {}),
        ...(item.customization
          ? { customization: item.customization as Record<string, unknown> }
          : {}),
      })),
      subtotalPaise: safeNumber(order.subtotalPaise),
      discountPaise: safeNumber(order.discountPaise),
      shippingPaise: safeNumber(order.shippingPaise),
      totalPaise: safeNumber(order.totalPaise),
      paidPaise: safeNumber(order.paidPaise),
      balanceDuePaise: safeNumber(order.balanceDuePaise),
      currency: "INR",
      ...(order.placedAt ? { placedAt: order.placedAt.toISOString() } : {}),
      ...(order.paidAt ? { paidAt: order.paidAt.toISOString() } : {}),
      ...(order.promisedDeliveryAt
        ? { promisedDeliveryAt: order.promisedDeliveryAt.toISOString() }
        : {}),
      ...(order.commerceStatus ? { commerceStatus: order.commerceStatus } : {}),
      deadline: dateOnly(order.deadline),
      ...(order.assignedUserId
        ? { assignedEmployeeId: order.assignedUserId }
        : {}),
      ...(order.assignedUser
        ? { assignedEmployeeName: order.assignedUser.loginName }
        : {}),
      status: order.status,
      color: order.color,
      ...(order.customFieldValues.length
        ? {
            customFields: Object.fromEntries(
              order.customFieldValues.map((entry) => [
                entry.field.key,
                entry.value,
              ]),
            ) as Record<string, string | number | boolean | string[] | null>,
          }
        : {}),
    })),
    payments:
      role === UserRole.EMPLOYEE || role === "Employee"
        ? []
        : payments.map((payment) => ({
            id: payment.displayId,
            ...(payment.order ? { orderId: payment.order.displayId } : {}),
            source: paymentSourceLabel(payment.source),
            customer: payment.customerName,
            cashAmount: safeNumber(payment.cashPaise) / 100,
            upiAmount: safeNumber(payment.upiPaise) / 100,
            total: safeNumber(payment.totalPaise) / 100,
            method: payment.method as "Cash" | "UPI" | "Split" | "Razorpay",
            upiReference: payment.providerReference ?? "",
            createdAt: payment.receivedAt.getTime(),
          })),
  };
}

export async function saveWorkspace(
  input: unknown,
  actor: Express.Request["actor"],
  options?: { transaction?: Prisma.TransactionClient },
) {
  if (!actor) throw forbidden();
  const incoming = workspaceSchema.parse(input);
  if (actor.role === UserRole.EMPLOYEE)
    return saveEmployeeWorkspace(incoming, actor);
  const passwordHashes = new Map<string, string>();
  for (const user of [...incoming.employees, ...incoming.staff])
    if (user.password)
      passwordHashes.set(user.id, await hashPassword(user.password));
  const operation = async (database: Prisma.TransactionClient) => {
    const existingUsers = await database.user.findMany({
      where: { workspaceId: actor.workspaceId },
    });
    const incomingUsers = [
      ...incoming.employees.map((user) => ({
        ...user,
        accountRole: UserRole.EMPLOYEE,
      })),
      ...incoming.staff.map((user) => ({
        ...user,
        accountRole: toRole(user.role),
      })),
    ];
    if (!incomingUsers.some((user) => user.accountRole === UserRole.ADMIN))
      throw badRequest("The workspace must keep at least one admin account.");
    for (const user of incomingUsers) {
      const current = existingUsers.find((entry) => entry.id === user.id);
      if (!current && !passwordHashes.has(user.id))
        throw badRequest(`A password is required for ${user.name}.`);
      const account = {
        loginName: user.name,
        normalizedName: user.name.toLocaleLowerCase(),
        role: user.accountRole,
        jobTitle: user.accountRole === UserRole.EMPLOYEE ? user.role : null,
        initials: "initials" in user ? user.initials : null,
        color: "color" in user ? user.color : null,
        active: "active" in user ? user.active : true,
      };
      if (current) {
        await database.user.update({
          where: { id: current.id },
          data: {
            ...account,
            ...(passwordHashes.has(user.id)
              ? { passwordHash: passwordHashes.get(user.id)! }
              : {}),
            archivedAt: null,
            version: { increment: 1 },
          },
        });
      } else {
        await database.user.create({
          data: {
            id: user.id,
            workspaceId: actor.workspaceId,
            passwordHash: passwordHashes.get(user.id)!,
            ...account,
          },
        });
      }
    }
    const retainedIds = incomingUsers.map((user) => user.id);
    await database.user.updateMany({
      where: { workspaceId: actor.workspaceId, id: { notIn: retainedIds } },
      data: { archivedAt: new Date(), active: false },
    });
    for (const employee of incoming.employees) {
      if (employee.attendanceRecords) {
        await database.attendanceSession.deleteMany({
          where: { userId: employee.id },
        });
        if (employee.attendanceRecords.length)
          await database.attendanceSession.createMany({
            data: employee.attendanceRecords.map((record) => ({
              ...(/^[0-9a-f-]{36}$/i.test(record.id) ? { id: record.id } : {}),
              userId: employee.id,
              workDate: new Date(`${record.date}T00:00:00.000Z`),
              clockIn: new Date(record.clockIn),
              clockOut: record.clockOut ? new Date(record.clockOut) : null,
              durationSeconds: record.durationSeconds,
            })),
          });
      }
      if (actor.role === UserRole.MANAGER && employee.manualAttendance) {
        await database.manualAttendance.deleteMany({
          where: { userId: employee.id },
        });
        if (employee.manualAttendance.length)
          await database.manualAttendance.createMany({
            data: employee.manualAttendance.map((entry) => ({
              userId: employee.id,
              workDate: new Date(`${entry.date}T00:00:00.000Z`),
              status: entry.status === "Absent" ? "ABSENT" : "PRESENT",
              markedById: actor.id,
            })),
          });
      }
    }
    const changedSyncIds = await syncOrders(database, actor, incoming.orders);
    const dbOrders = await database.order.findMany({
      where: { workspaceId: actor.workspaceId, archivedAt: null },
    });
    const orderIds = new Map(
      dbOrders.map((order) => [order.displayId, order.id]),
    );
    await database.task.deleteMany({
      where: { workspaceId: actor.workspaceId },
    });
    for (const task of incoming.tasks) {
      const created = await database.task.create({
        data: {
          workspaceId: actor.workspaceId,
          orderId: task.orderId ? (orderIds.get(task.orderId) ?? null) : null,
          leadId: task.ownerId ?? null,
          title: task.title,
          leadResponsibility: task.leadResponsibility ?? null,
          status: toTaskStatus(task.status),
          progress: task.progress,
          tone: task.tone,
          deadline: asDate(task.due),
          completedAt: asDate(task.completedAt),
        },
      });
      const assignees = [
        ...(task.ownerId
          ? [
              {
                employeeId: task.ownerId,
                responsibility: task.leadResponsibility ?? "Lead",
                isLead: true,
              },
            ]
          : []),
        ...(task.collaborators ?? []).map((entry) => ({
          ...entry,
          isLead: false,
        })),
      ];
      if (assignees.length)
        await database.taskAssignee.createMany({
          data: assignees.map((entry) => ({
            taskId: created.id,
            userId: entry.employeeId,
            responsibility: entry.responsibility,
            isLead: entry.isLead,
          })),
        });
    }
    const commerceIds = (
      await database.payment.findMany({
        where: {
          workspaceId: actor.workspaceId,
          source: PaymentSource.COMMERCE,
        },
        select: { displayId: true },
      })
    ).map((entry) => entry.displayId);
    await database.payment.deleteMany({
      where: {
        workspaceId: actor.workspaceId,
        displayId: { notIn: commerceIds },
      },
    });
    for (const payment of incoming.payments.filter(
      (entry) => entry.source !== "Commerce",
    ))
      await database.payment.create({
        data: {
          workspaceId: actor.workspaceId,
          orderId: payment.orderId
            ? (orderIds.get(payment.orderId) ?? null)
            : null,
          displayId: payment.id,
          customerName: payment.customer,
          source:
            payment.source === "Advance"
              ? PaymentSource.ADVANCE
              : PaymentSource.MANUAL,
          method: payment.method,
          providerReference: payment.upiReference || null,
          cashPaise: BigInt(Math.round(payment.cashAmount * 100)),
          upiPaise: BigInt(Math.round(payment.upiAmount * 100)),
          totalPaise: BigInt(Math.round(payment.total * 100)),
          receivedAt: new Date(payment.createdAt),
        },
      });
    return changedSyncIds;
  };
  const pendingSyncIds = options?.transaction
    ? await operation(options.transaction)
    : await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15_000,
      });
  if (options?.transaction) return incoming;
  for (const displayId of pendingSyncIds) await syncOrder(actor, displayId);
  return getWorkspace(actor);
}

async function syncOrders(
  database: Prisma.TransactionClient,
  actor: NonNullable<Express.Request["actor"]>,
  orders: z.infer<typeof workspaceSchema>["orders"],
) {
  const workspaceId = actor.workspaceId;
  const changedSyncIds: string[] = [];
  const fieldDefinitions = await database.orderFieldDefinition.findMany({
    where: { workspaceId, archivedAt: null },
  });
  const existing = await database.order.findMany({
    where: { workspaceId },
    include: { customer: true },
  });
  for (const imported of existing.filter(
    (order) => order.source === "FRAMES_41" && !order.archivedAt,
  ))
    if (!orders.some((order) => order.id === imported.displayId))
      throw badRequest("Frames 41 orders cannot be deleted from Desk.");
  for (const order of orders) {
    const current = existing.find((entry) => entry.displayId === order.id);
    if (order.source === "Frames 41" && !current)
      throw badRequest(
        "Frames 41 orders can only be created by the integration API.",
      );
    if (current?.source === "FRAMES_41") {
      const eventId = crypto.randomUUID();
      const commerceStatus =
        order.status === "Completed"
          ? "READY_TO_SHIP"
          : order.status === "Cancelled"
            ? "CANCELLED"
            : order.status === "In progress"
              ? "PROCESSING"
              : null;
      const payload =
        current.status !== order.status &&
        commerceStatus &&
        current.externalOrderId &&
        current.externalOrderNumber
          ? {
              eventId,
              eventType: "desk.order.status_changed.v1",
              eventVersion: 1,
              occurredAt: new Date().toISOString(),
              source: "desk",
              clientId: "desk",
              correlationId: crypto.randomUUID(),
              aggregateId: current.externalOrderId,
              payload: {
                externalOrderId: current.externalOrderId,
                externalOrderNumber: current.externalOrderNumber,
                deskOrderId: current.displayId,
                deskStatus: order.status,
                commerceStatus,
                changedBy: { id: actor.id, name: actor.name, role: actor.role },
              },
            }
          : null;
      await database.order.update({
        where: { id: current.id },
        data: {
          status: order.status,
          color: order.color,
          assignedUserId: order.assignedEmployeeId ?? null,
          deadline: asDate(order.deadline),
          version: { increment: 1 },
          ...(payload
            ? {
                syncStatus: "PENDING",
                syncEventId: eventId,
                syncVersion: current.version + 1,
                syncPayload: payload,
                syncError: null,
              }
            : {}),
        },
      });
      await syncCustomFieldValues(
        database,
        current.id,
        order.customFields,
        fieldDefinitions,
        false,
      );
      if (payload) changedSyncIds.push(current.displayId);
      continue;
    }
    const customer = current
      ? await database.customer.update({
          where: { id: current.customerId },
          data: {
            name: order.customer,
            phone: order.customerMobile ?? null,
            email: order.customerEmail ?? null,
          },
        })
      : await database.customer.create({
          data: {
            workspaceId,
            name: order.customer,
            phone: order.customerMobile ?? null,
            email: order.customerEmail ?? null,
          },
        });
    const money =
      order.totalPaise ??
      Math.round(Number(order.value.replace(/[^\d.]/g, "")) * 100);
    if (current) {
      await database.order.update({
        where: { id: current.id },
        data: {
          customerId: customer.id,
          assignedUserId: order.assignedEmployeeId ?? null,
          itemSummary: order.item,
          status: order.status,
          color: order.color,
          deadline: asDate(order.deadline),
          totalPaise: BigInt(money || 0),
          paidPaise: BigInt(
            order.paidPaise ?? Math.round((order.advanceAmount ?? 0) * 100),
          ),
          balanceDuePaise: BigInt(
            order.balanceDuePaise ??
              Math.max(0, money - Math.round((order.advanceAmount ?? 0) * 100)),
          ),
          archivedAt: null,
          version: { increment: 1 },
        },
      });
      await syncCustomFieldValues(
        database,
        current.id,
        order.customFields,
        fieldDefinitions,
        false,
      );
    } else {
      const created = await database.order.create({
        data: {
          workspaceId,
          customerId: customer.id,
          displayId: order.id,
          source: "DESK",
          assignedUserId: order.assignedEmployeeId ?? null,
          itemSummary: order.item,
          status: order.status,
          color: order.color,
          deadline: asDate(order.deadline),
          totalPaise: BigInt(money || 0),
          paidPaise: BigInt(
            order.paidPaise ?? Math.round((order.advanceAmount ?? 0) * 100),
          ),
          balanceDuePaise: BigInt(
            order.balanceDuePaise ??
              Math.max(0, money - Math.round((order.advanceAmount ?? 0) * 100)),
          ),
        },
      });
      await syncCustomFieldValues(
        database,
        created.id,
        order.customFields,
        fieldDefinitions,
        true,
      );
    }
  }
  await database.order.updateMany({
    where: {
      workspaceId,
      source: "DESK",
      displayId: { notIn: orders.map((order) => order.id) },
    },
    data: { archivedAt: new Date() },
  });
  return changedSyncIds;
}

type CustomFieldValue = string | number | boolean | string[] | null;

function isEmptyCustomValue(value: CustomFieldValue | undefined) {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function validateCustomFieldValue(
  field: {
    label: string;
    type: string;
    required: boolean;
    options: Prisma.JsonValue | null;
  },
  value: CustomFieldValue | undefined,
  enforceRequired: boolean,
) {
  if (isEmptyCustomValue(value)) {
    if (field.required && enforceRequired)
      throw badRequest(`${field.label} is required.`);
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
    if (field.type === "EMAIL" && !z.string().email().safeParse(value).success)
      throw invalid();
    if (field.type === "PHONE" && value.replace(/\D/g, "").length < 7)
      throw invalid();
    if (field.type === "DATE" && !z.iso.date().safeParse(value).success)
      throw invalid();
    if (field.type === "SELECT" && !options.includes(value)) throw invalid();
  } else if (["NUMBER", "CURRENCY"].includes(field.type)) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw invalid();
    if (field.type === "CURRENCY" && value < 0) throw invalid();
  } else if (field.type === "CHECKBOX") {
    if (typeof value !== "boolean") throw invalid();
    if (field.required && value !== true) throw invalid();
  } else if (field.type === "MULTI_SELECT") {
    if (
      !Array.isArray(value) ||
      value.some((entry) => !options.includes(entry))
    )
      throw invalid();
  }
}

async function syncCustomFieldValues(
  database: Prisma.TransactionClient,
  orderId: string,
  values: Record<string, CustomFieldValue> | undefined,
  definitions: Array<{
    id: string;
    key: string;
    label: string;
    type: string;
    required: boolean;
    options: Prisma.JsonValue | null;
  }>,
  enforceRequired: boolean,
) {
  if (values === undefined) return;
  const definitionsByKey = new Map(
    definitions.map((definition) => [definition.key, definition]),
  );
  for (const key of Object.keys(values))
    if (!definitionsByKey.has(key))
      throw badRequest(`Unknown order custom field: ${key}.`);
  for (const definition of definitions)
    validateCustomFieldValue(
      definition,
      values[definition.key],
      enforceRequired || Object.hasOwn(values, definition.key),
    );
  await database.orderCustomFieldValue.deleteMany({
    where: { orderId, fieldId: { in: definitions.map((field) => field.id) } },
  });
  const populated = definitions.flatMap((field) => {
    const value = values[field.key];
    return isEmptyCustomValue(value)
      ? []
      : [{ orderId, fieldId: field.id, value: value as Prisma.InputJsonValue }];
  });
  if (populated.length)
    await database.orderCustomFieldValue.createMany({ data: populated });
}

async function saveEmployeeWorkspace(
  incoming: z.infer<typeof workspaceSchema>,
  actor: NonNullable<Express.Request["actor"]>,
) {
  const employee = incoming.employees.find((entry) => entry.id === actor.id);
  if (!employee) throw badRequest("Employee account was not found.");
  await prisma.$transaction(async (database) => {
    if (employee.attendanceRecords) {
      await database.attendanceSession.deleteMany({
        where: { userId: actor.id },
      });
      if (employee.attendanceRecords.length)
        await database.attendanceSession.createMany({
          data: employee.attendanceRecords.map((record) => ({
            userId: actor.id,
            workDate: new Date(`${record.date}T00:00:00.000Z`),
            clockIn: new Date(record.clockIn),
            clockOut: record.clockOut ? new Date(record.clockOut) : null,
            durationSeconds: record.durationSeconds,
          })),
        });
    }
    for (const changed of incoming.tasks) {
      const task = await database.task.findFirst({
        where: {
          workspaceId: actor.workspaceId,
          title: changed.title,
          OR: [
            { leadId: actor.id },
            { assignees: { some: { userId: actor.id } } },
          ],
        },
        include: { assignees: true },
      });
      if (!task) continue;
      const isLead = task.leadId === actor.id;
      if (!isLead && changed.status === "Completed")
        throw forbidden("Only the task lead can complete shared work.");
      await database.task.update({
        where: { id: task.id },
        data: {
          status: toTaskStatus(changed.status),
          progress: changed.progress,
          completedAt: asDate(changed.completedAt),
          version: { increment: 1 },
        },
      });
    }
  });
  return getWorkspace(actor);
}
