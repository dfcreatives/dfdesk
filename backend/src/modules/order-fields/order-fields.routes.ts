import { OrderFieldType, UserRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireActor, requireRole } from "../../middleware/auth.js";
import { badRequest, notFound } from "../../shared/errors/app-error.js";
import { ok } from "../../shared/http/respond.js";

const fieldBaseSchema = z.object({
  label: z.string().trim().min(1).max(120),
  type: z.nativeEnum(OrderFieldType),
  required: z.boolean().default(false),
  placeholder: z.string().trim().max(160).nullable().default(null),
  helpText: z.string().trim().max(300).nullable().default(null),
  options: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  position: z.number().int().min(0).max(1_000).optional(),
  showInList: z.boolean().default(false),
});
export const fieldInputSchema = fieldBaseSchema.superRefine(
  (field, context) => {
    const usesOptions = new Set<OrderFieldType>([
      OrderFieldType.SELECT,
      OrderFieldType.MULTI_SELECT,
    ]).has(field.type);
    if (usesOptions && field.options.length === 0)
      context.addIssue({
        code: "custom",
        message: "Add at least one option for this field type.",
        path: ["options"],
      });
    if (
      new Set(field.options.map((option) => option.toLowerCase())).size !==
      field.options.length
    )
      context.addIssue({
        code: "custom",
        message: "Field options must be unique.",
        path: ["options"],
      });
  },
);

const fieldPatchSchema = fieldBaseSchema.partial();

function keyFromLabel(label: string) {
  const normalized = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 68);
  return normalized || "field";
}

function responseField(field: {
  id: string;
  key: string;
  label: string;
  type: OrderFieldType;
  required: boolean;
  placeholder: string | null;
  helpText: string | null;
  options: unknown;
  position: number;
  showInList: boolean;
}) {
  return {
    ...field,
    options: Array.isArray(field.options)
      ? field.options.filter(
          (option): option is string => typeof option === "string",
        )
      : [],
  };
}

export const orderFieldsRouter = Router();
orderFieldsRouter.use(requireActor);

orderFieldsRouter.get("/", async (request, response) => {
  const fields = await prisma.orderFieldDefinition.findMany({
    where: { workspaceId: request.actor!.workspaceId, archivedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return ok(response, { fields: fields.map(responseField) });
});

orderFieldsRouter.post(
  "/",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const input = fieldInputSchema.parse(request.body);
    const workspaceId = request.actor!.workspaceId;
    const count = await prisma.orderFieldDefinition.count({
      where: { workspaceId, archivedAt: null },
    });
    if (count >= 50)
      throw badRequest("An order form can contain at most 50 custom fields.");
    const baseKey = keyFromLabel(input.label);
    const matchingKeys = await prisma.orderFieldDefinition.findMany({
      where: { workspaceId, key: { startsWith: baseKey } },
      select: { key: true },
    });
    const keys = new Set(matchingKeys.map((entry) => entry.key));
    let key = baseKey;
    for (let suffix = 2; keys.has(key); suffix += 1)
      key = `${baseKey}_${suffix}`;
    const last = await prisma.orderFieldDefinition.aggregate({
      where: { workspaceId, archivedAt: null },
      _max: { position: true },
    });
    const field = await prisma.orderFieldDefinition.create({
      data: {
        workspaceId,
        key,
        ...input,
        position: input.position ?? (last._max.position ?? -1) + 1,
        options: input.options,
      },
    });
    return ok(response, { field: responseField(field) }, 201);
  },
);

orderFieldsRouter.patch(
  "/:id",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const id = z.uuid().parse(request.params.id);
    const patch = fieldPatchSchema.parse(request.body);
    const current = await prisma.orderFieldDefinition.findFirst({
      where: { id, workspaceId: request.actor!.workspaceId, archivedAt: null },
    });
    if (!current) throw notFound("Custom field was not found.");
    if (patch.type && patch.type !== current.type) {
      const usedByOrders = await prisma.orderCustomFieldValue.count({
        where: { fieldId: current.id },
      });
      if (usedByOrders)
        throw badRequest(
          "The field type cannot be changed after orders contain values.",
        );
    }
    if (
      patch.options &&
      new Set<OrderFieldType>([
        OrderFieldType.SELECT,
        OrderFieldType.MULTI_SELECT,
      ]).has(current.type)
    ) {
      const storedValues = await prisma.orderCustomFieldValue.findMany({
        where: { fieldId: current.id },
        select: { value: true },
      });
      const removedOptionInUse = storedValues.some(({ value }) =>
        (Array.isArray(value) ? value : [value]).some(
          (entry) =>
            typeof entry === "string" && !patch.options!.includes(entry),
        ),
      );
      if (removedOptionInUse)
        throw badRequest(
          "An option currently used by an order cannot be removed.",
        );
    }
    const input = fieldInputSchema.parse({
      label: current.label,
      type: current.type,
      required: current.required,
      placeholder: current.placeholder,
      helpText: current.helpText,
      options: responseField(current).options,
      position: current.position,
      showInList: current.showInList,
      ...patch,
    });
    const field = await prisma.orderFieldDefinition.update({
      where: { id },
      data: {
        label: input.label,
        type: input.type,
        required: input.required,
        placeholder: input.placeholder,
        helpText: input.helpText,
        options: input.options,
        position: input.position ?? current.position,
        showInList: input.showInList,
      },
    });
    return ok(response, { field: responseField(field) });
  },
);

orderFieldsRouter.delete(
  "/:id",
  requireRole(UserRole.ADMIN, UserRole.MANAGER),
  async (request, response) => {
    const id = z.uuid().parse(request.params.id);
    const result = await prisma.orderFieldDefinition.updateMany({
      where: { id, workspaceId: request.actor!.workspaceId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (!result.count) throw notFound("Custom field was not found.");
    return response.status(204).send();
  },
);
