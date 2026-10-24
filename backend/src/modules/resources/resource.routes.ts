import { randomUUID } from "node:crypto";
import { TaskStatus, UserRole } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireActor, requireRole } from "../../middleware/auth.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../../shared/errors/app-error.js";
import { ok } from "../../shared/http/respond.js";
import { hashPassword } from "../../shared/security/password.js";
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

async function managerTeamIds(actor: NonNullable<Express.Request["actor"]>) {
  const reports = await prisma.user.findMany({
    where: {
      workspaceId: actor.workspaceId,
      reportsToId: actor.id,
      role: UserRole.EMPLOYEE,
      archivedAt: null,
    },
    select: { id: true },
  });
  return new Set([actor.id, ...reports.map(({ id }) => id)]);
}

async function managerCanAccessTask(
  actor: NonNullable<Express.Request["actor"]>,
  task: { leadId: string | null; assignees: { userId: string }[] },
) {
  if (actor.role !== UserRole.MANAGER) return true;
  const teamIds = await managerTeamIds(actor);
  return (
    (teamIds.has(task.leadId ?? "") ||
      task.assignees.some((entry) => teamIds.has(entry.userId))) &&
    (task.leadId === null || teamIds.has(task.leadId)) &&
    task.assignees.every((entry) => teamIds.has(entry.userId))
  );
}

const userCreateSchema = z.discriminatedUnion("accountRole", [
  employeeSchema
    .omit({ id: true })
    .extend({
      accountRole: z.literal("Employee"),
      password: z.string().min(8).max(256),
      reportsToId: z.uuid().nullable().optional(),
    }),
  staffSchema
    .omit({ id: true })
    .extend({
      accountRole: z.literal("Manager"),
      password: z.string().min(8).max(256),
      reportsToId: z.uuid().nullable().optional(),
    }),
]);
const userPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    password: z.string().min(8).max(256).optional(),
    accountRole: z.literal("Manager").optional(),
    reportsToId: z.uuid().nullable().optional(),
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
    formId: z.uuid().optional(),
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
    const actor = request.actor!;
    if (actor.role === UserRole.MANAGER && input.accountRole !== "Employee")
      throw forbidden("Only admins can create admin or manager accounts.");
    const reportsToId =
      actor.role === UserRole.MANAGER
        ? actor.id
        : input.reportsToId ?? null;
    if (actor.role === UserRole.ADMIN && reportsToId) {
      const parent = await prisma.user.findFirst({
        where: {
          id: reportsToId,
          workspaceId: actor.workspaceId,
          archivedAt: null,
        },
        select: { role: true },
      });
      const expectedParentRole =
        input.accountRole === "Employee" ? UserRole.MANAGER : UserRole.ADMIN;
      if (!parent || parent.role !== expectedParentRole)
        throw badRequest(
          input.accountRole === "Employee"
            ? "Employees must report to a manager in this workspace."
            : "Managers must report to an admin in this workspace.",
        );
    }
    const normalizedName = input.name.toLocaleLowerCase();
    const duplicate = await prisma.user.findFirst({
      where: { workspaceId: actor.workspaceId, normalizedName },
      select: { id: true },
    });
    if (duplicate) throw conflict("A user with this login name already exists.");

    try {
      await prisma.user.create({
        data: {
          id: randomUUID(),
          workspaceId: actor.workspaceId,
          loginName: input.name,
          normalizedName,
          passwordHash: await hashPassword(input.password),
          role:
            input.accountRole === "Employee"
              ? UserRole.EMPLOYEE
              : UserRole.MANAGER,
          jobTitle: input.accountRole === "Employee" ? input.role : null,
          initials: input.accountRole === "Employee" ? input.initials : null,
          color: input.accountRole === "Employee" ? input.color : null,
          active: input.accountRole === "Employee" ? input.active : true,
          reportsToId,
        },
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      )
        throw conflict("A user with this login name already exists.");
      throw error;
    }

    return ok(response, await getWorkspace(actor), 201);
  },
);
resourceRouter.patch(
  "/users/:id",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const patch = userPatchSchema.parse(request.body);
    const id = String(request.params.id);
    const actor = request.actor!;
    const current = await prisma.user.findFirst({
      where: {
        id,
        workspaceId: request.actor!.workspaceId,
        archivedAt: null,
      },
    });
    if (!current) throw notFound("User was not found.");
    if (actor.role === UserRole.MANAGER) {
      if (current.role !== UserRole.EMPLOYEE || current.reportsToId !== actor.id)
        throw forbidden("Managers can only manage their assigned employees.");
      if (patch.accountRole || patch.reportsToId !== undefined)
        throw forbidden("Only admins can change roles or reporting lines.");
    }
    if (patch.accountRole && current.role === UserRole.EMPLOYEE)
      throw badRequest("Employee access must be edited from the team workspace.");
    const nextRole = patch.accountRole
      ? UserRole.MANAGER
      : current.role;
    const effectiveReportsToId =
      patch.reportsToId !== undefined
        ? patch.reportsToId
        : patch.accountRole
          ? null
          : current.reportsToId;
    if (actor.role === UserRole.ADMIN && effectiveReportsToId) {
      if (nextRole === UserRole.ADMIN)
        throw badRequest("Admin accounts cannot report to another user.");
      const parentId = effectiveReportsToId;
      if (parentId) {
        const parent = await prisma.user.findFirst({
          where: {
            id: parentId,
            workspaceId: actor.workspaceId,
            archivedAt: null,
          },
          select: { role: true },
        });
        const expectedParentRole =
          nextRole === UserRole.EMPLOYEE ? UserRole.MANAGER : UserRole.ADMIN;
        if (!parent || parent.role !== expectedParentRole)
          throw badRequest(
            nextRole === UserRole.EMPLOYEE
              ? "Employees must report to a manager in this workspace."
              : "Managers must report to an admin in this workspace.",
          );
      }
    }
    if (current.role === UserRole.ADMIN && nextRole !== UserRole.ADMIN) {
      const adminCount = await prisma.user.count({
        where: {
          workspaceId: request.actor!.workspaceId,
          role: UserRole.ADMIN,
          archivedAt: null,
        },
      });
      if (adminCount <= 1)
        throw badRequest("The workspace must keep at least one admin account.");
    }
    if (patch.name) {
      const duplicate = await prisma.user.findFirst({
        where: {
          workspaceId: request.actor!.workspaceId,
          normalizedName: patch.name.toLocaleLowerCase(),
          id: { not: id },
        },
      });
      if (duplicate)
        throw conflict("A user with this login name already exists.");
    }
    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(patch.name
          ? {
              loginName: patch.name,
              normalizedName: patch.name.toLocaleLowerCase(),
            }
          : {}),
        ...(patch.password
          ? { passwordHash: await hashPassword(patch.password) }
          : {}),
        ...(patch.accountRole ? { role: nextRole } : {}),
        ...(actor.role === UserRole.ADMIN &&
        (patch.reportsToId !== undefined || patch.accountRole !== undefined)
          ? { reportsToId: effectiveReportsToId }
          : {}),
        ...(current.role === UserRole.EMPLOYEE && patch.jobTitle !== undefined
          ? { jobTitle: patch.jobTitle }
          : {}),
        ...(current.role === UserRole.EMPLOYEE && patch.active !== undefined
          ? { active: patch.active }
          : {}),
        version: { increment: 1 },
      },
    });
    if (nextRole !== current.role)
      await prisma.user.updateMany({
        where: { workspaceId: actor.workspaceId, reportsToId: id },
        data: { reportsToId: null },
      });
    return ok(response, {
      user: {
        id: updated.id,
        name: updated.loginName,
        reportsToId: updated.reportsToId,
        role:
          updated.role === UserRole.ADMIN
            ? ("Admin" as const)
            : updated.role === UserRole.MANAGER
              ? ("Manager" as const)
              : ("Employee" as const),
      },
    });
  },
);
resourceRouter.delete(
  "/users/:id",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const id = String(request.params.id);
    const current = await prisma.user.findFirst({
      where: {
        id,
        workspaceId: request.actor!.workspaceId,
        archivedAt: null,
      },
    });
    if (!current) throw notFound("User was not found.");
    if (
      request.actor!.role === UserRole.MANAGER &&
      (current.role !== UserRole.EMPLOYEE || current.reportsToId !== request.actor!.id)
    )
      throw forbidden("Managers can only manage their assigned employees.");
    if (current.id === request.actor!.id)
      throw badRequest("You cannot delete your own signed-in account.");
    if (current.role === UserRole.ADMIN) {
      const adminCount = await prisma.user.count({
        where: {
          workspaceId: request.actor!.workspaceId,
          role: UserRole.ADMIN,
          archivedAt: null,
        },
      });
      if (adminCount <= 1)
        throw badRequest("The workspace must keep at least one admin account.");
    }
    await prisma.user.updateMany({
      where: { workspaceId: request.actor!.workspaceId, reportsToId: id },
      data: { reportsToId: null },
    });
    await prisma.user.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        active: false,
        version: { increment: 1 },
      },
    });
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
  if (!task || !(await managerCanAccessTask(request.actor!, task)))
    throw notFound("Task was not found.");
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
    !(await managerCanAccessTask(request.actor!, task)) ||
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
    const task = await prisma.task.findFirst({
      where: {
        id: String(request.params.id),
        workspaceId: request.actor!.workspaceId,
        archivedAt: null,
      },
      include: { assignees: true },
    });
    if (!task || !(await managerCanAccessTask(request.actor!, task)))
      throw notFound("Task was not found.");
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
      include: { assignees: true },
    });
    if (!task || !(await managerCanAccessTask(request.actor!, task)))
      throw notFound("Task was not found.");
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
    if (request.actor!.role === UserRole.MANAGER) {
      const teamIds = await managerTeamIds(request.actor!);
      if (assignees.some((entry) => !teamIds.has(entry.userId)))
        throw forbidden("Tasks can only be assigned to your team.");
    }
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
  requireRole(UserRole.ADMIN),
  async (request, response) => {
    const input = customOrderSubmissionSchema.parse(request.body);
    const order = await prisma.$transaction((database) =>
      createCustomOrderRecord(
        database,
        request.actor!.workspaceId,
        input.fields,
        {
          ...(input.externalId ? { externalId: input.externalId } : {}),
          ...(input.formId ? { formId: input.formId } : {}),
        },
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
  requireRole(UserRole.ADMIN),
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
