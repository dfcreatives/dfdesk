import { randomUUID } from "node:crypto";
import { TaskStatus, UserRole } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireActor, requireRole } from "../../middleware/auth.js";
import { conflict, notFound } from "../../shared/errors/app-error.js";
import { ok } from "../../shared/http/respond.js";
import {
  employeeSchema,
  orderSchema,
  orderCustomFieldValueSchema,
  paymentSchema,
  staffSchema,
  taskSchema,
} from "../legacy-workspace/legacy-workspace.schema.js";
import {
  getWorkspace,
  saveWorkspace,
} from "../legacy-workspace/legacy-workspace.service.js";
import { createCustomOrderRecord } from "../integrations/integrations.service.js";

export const resourceRouter = Router();
resourceRouter.use(requireActor);

const userCreateSchema = z.discriminatedUnion("accountRole", [
  employeeSchema
    .omit({ id: true })
    .extend({ accountRole: z.literal("Employee") }),
  staffSchema
    .omit({ id: true })
    .extend({ accountRole: z.enum(["Admin", "Manager"]) }),
]);
const userPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    password: z.string().min(8).max(256).optional(),
    jobTitle: z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional(),
  })
  .strict();
const taskPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    status: z.nativeEnum(TaskStatus).optional(),
    progress: z.number().int().min(0).max(100).optional(),
    tone: z.string().max(40).nullable().optional(),
    deadline: z.coerce.date().nullable().optional(),
    completedAt: z.coerce.date().nullable().optional(),
  })
  .strict();
const statusPatchSchema = z
  .object({
    status: z.string().trim().min(1).max(80),
    color: z.string().trim().min(1).max(40).optional(),
  })
  .strict();
const assignmentSchema = z
  .object({
    employeeId: z.uuid().nullable(),
    employeeName: z.string().max(80).nullable(),
  })
  .strict();
const customOrderSubmissionSchema = z
  .object({
    externalId: z.string().trim().min(1).max(160).optional(),
    fields: z.record(
      z.string().trim().min(1).max(80),
      orderCustomFieldValueSchema,
    ),
  })
  .strict();

resourceRouter.get("/users", async (request, response) => {
  const workspace = await getWorkspace(request.actor!);
  return ok(response, [...workspace.staff, ...workspace.employees]);
});
resourceRouter.post(
  "/users",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const input = userCreateSchema.parse(request.body);
    const workspace = await getWorkspace(request.actor!);
    if (input.accountRole === "Employee")
      workspace.employees.push({
        ...input,
        id: randomUUID(),
        role: input.role,
        task: input.task,
        active: input.active,
      });
    else
      workspace.staff.push({
        ...input,
        id: randomUUID(),
        role: input.accountRole,
      });
    return ok(response, await saveWorkspace(workspace, request.actor), 201);
  },
);
resourceRouter.patch(
  "/users/:id",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const patch = userPatchSchema.parse(request.body);
    const workspace = await getWorkspace(request.actor!);
    const id = String(request.params.id);
    const staff = workspace.staff.find((entry) => entry.id === id);
    const employee = workspace.employees.find((entry) => entry.id === id);
    const current = staff ?? employee;
    if (!current) throw notFound("User was not found.");
    if (patch.name !== undefined) current.name = patch.name;
    if (patch.password !== undefined) current.password = patch.password;
    if (employee && patch.jobTitle !== undefined)
      employee.role = patch.jobTitle;
    if (employee && patch.active !== undefined) employee.active = patch.active;
    return ok(response, await saveWorkspace(workspace, request.actor));
  },
);
resourceRouter.delete(
  "/users/:id",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const workspace = await getWorkspace(request.actor!);
    const id = String(request.params.id);
    workspace.staff = workspace.staff.filter((entry) => entry.id !== id);
    workspace.employees = workspace.employees.filter(
      (entry) => entry.id !== id,
    );
    await saveWorkspace(workspace, request.actor);
    return response.status(204).send();
  },
);

resourceRouter.get("/tasks", async (request, response) =>
  ok(response, (await getWorkspace(request.actor!)).tasks),
);
resourceRouter.post(
  "/tasks",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const input = taskSchema.parse(request.body);
    const workspace = await getWorkspace(request.actor!);
    workspace.tasks.push(input);
    return ok(response, await saveWorkspace(workspace, request.actor), 201);
  },
);
resourceRouter.get("/tasks/:id", async (request, response) => {
  const task = await prisma.task.findFirst({
    where: {
      id: String(request.params.id),
      workspaceId: request.actor!.workspaceId,
      archivedAt: null,
    },
    include: { assignees: true },
  });
  if (!task) throw notFound("Task was not found.");
  return ok(response, task);
});
resourceRouter.patch("/tasks/:id", async (request, response) => {
  const task = await prisma.task.findFirst({
    where: {
      id: String(request.params.id),
      workspaceId: request.actor!.workspaceId,
      archivedAt: null,
    },
    include: { assignees: true },
  });
  if (
    !task ||
    (request.actor!.role === UserRole.EMPLOYEE &&
      task.leadId !== request.actor!.id &&
      !task.assignees.some((entry) => entry.userId === request.actor!.id))
  )
    throw notFound("Task was not found.");
  const patch = taskPatchSchema.parse(request.body);
  const permitted =
    request.actor!.role === UserRole.EMPLOYEE
      ? new Set(["status", "progress", "completedAt"])
      : new Set(Object.keys(patch));
  const data: Prisma.TaskUncheckedUpdateInput = { version: { increment: 1 } };
  for (const [key, value] of Object.entries(patch))
    if (permitted.has(key) && value !== undefined)
      Object.assign(data, { [key]: value });
  return ok(
    response,
    await prisma.task.update({ where: { id: task.id }, data }),
  );
});
resourceRouter.delete(
  "/tasks/:id",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    await prisma.task.updateMany({
      where: {
        id: String(request.params.id),
        workspaceId: request.actor!.workspaceId,
      },
      data: { archivedAt: new Date() },
    });
    return response.status(204).send();
  },
);
resourceRouter.put(
  "/tasks/:id/assignees",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const taskId = String(request.params.id);
    const task = await prisma.task.findFirst({
      where: { id: taskId, workspaceId: request.actor!.workspaceId },
    });
    if (!task) throw notFound("Task was not found.");
    const assignees = z
      .array(
        z.object({
          userId: z.uuid(),
          responsibility: z.string().trim().min(1).max(300),
          isLead: z.boolean().optional(),
        }),
      )
      .max(20)
      .parse(request.body);
    await prisma.$transaction(async (database) => {
      await database.taskAssignee.deleteMany({ where: { taskId } });
      if (assignees.length)
        await database.taskAssignee.createMany({
          data: assignees.map((entry) => ({
            taskId,
            userId: entry.userId,
            responsibility: entry.responsibility,
            isLead: entry.isLead ?? false,
          })),
        });
    });
    return ok(response, { updated: true });
  },
);

resourceRouter.get("/orders", async (request, response) =>
  ok(response, (await getWorkspace(request.actor!)).orders),
);
resourceRouter.post(
  "/custom-orders",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const input = customOrderSubmissionSchema.parse(request.body);
    const order = await prisma.$transaction((database) =>
      createCustomOrderRecord(
        database,
        request.actor!.workspaceId,
        input.fields,
        input.externalId ? { externalId: input.externalId } : {},
      ),
    );
    return ok(
      response,
      {
        order: {
          id: order.displayId,
          externalId: order.externalOrderId,
          fields: Object.fromEntries(
            order.customFieldValues.map((value) => [
              value.field.key,
              value.value,
            ]),
          ),
        },
      },
      201,
    );
  },
);
resourceRouter.get("/orders/:id", async (request, response) => {
  const order = (await getWorkspace(request.actor!)).orders.find(
    (entry) => entry.id === String(request.params.id),
  );
  if (!order) throw notFound("Order was not found.");
  return ok(response, order);
});
resourceRouter.post(
  "/orders",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const input = orderSchema.parse(request.body);
    const workspace = await getWorkspace(request.actor!);
    if (workspace.orders.some((order) => order.id === input.id))
      throw conflict("An order with this display ID already exists.");
    workspace.orders.push(input);
    return ok(response, await saveWorkspace(workspace, request.actor), 201);
  },
);
resourceRouter.patch(
  "/orders/:id",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const patch = orderSchema
      .partial()
      .omit({
        id: true,
        source: true,
        externalOrderId: true,
        externalOrderNumber: true,
        importPayloadHash: true,
        lineItems: true,
        shippingAddress: true,
      })
      .parse(request.body);
    const workspace = await getWorkspace(request.actor!);
    const order = workspace.orders.find(
      (entry) => entry.id === String(request.params.id),
    );
    if (!order) throw notFound("Order was not found.");
    Object.assign(order, patch);
    return ok(response, await saveWorkspace(workspace, request.actor));
  },
);
resourceRouter.patch("/orders/:id/status", async (request, response) => {
  const patch = statusPatchSchema.parse(request.body);
  const workspace = await getWorkspace(request.actor!);
  const order = workspace.orders.find(
    (entry) => entry.id === String(request.params.id),
  );
  if (!order) throw notFound("Order was not found.");
  order.status = patch.status;
  if (patch.color) order.color = patch.color;
  return ok(response, await saveWorkspace(workspace, request.actor));
});
resourceRouter.patch(
  "/orders/:id/assignment",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const patch = assignmentSchema.parse(request.body);
    const workspace = await getWorkspace(request.actor!);
    const order = workspace.orders.find(
      (entry) => entry.id === String(request.params.id),
    );
    if (!order) throw notFound("Order was not found.");
    order.assignedEmployeeId = patch.employeeId ?? undefined;
    order.assignedEmployeeName = patch.employeeName ?? undefined;
    return ok(response, await saveWorkspace(workspace, request.actor));
  },
);

resourceRouter.get(
  "/payments",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) =>
    ok(response, (await getWorkspace(request.actor!)).payments),
);
resourceRouter.post(
  "/payments",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const input = paymentSchema.parse(request.body);
    const workspace = await getWorkspace(request.actor!);
    workspace.payments.push(input);
    return ok(response, await saveWorkspace(workspace, request.actor), 201);
  },
);
resourceRouter.get(
  "/reports/summary",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const workspace = await getWorkspace(request.actor!);
    return ok(response, {
      users: workspace.employees.length + workspace.staff.length,
      openTasks: workspace.tasks.filter((task) => !task.completed).length,
      orders: workspace.orders.length,
      collected: workspace.payments.reduce(
        (sum, payment) => sum + payment.total,
        0,
      ),
    });
  },
);
