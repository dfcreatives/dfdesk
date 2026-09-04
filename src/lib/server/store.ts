import "server-only";

import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import type {
  Employee,
  IntegrationSyncState,
  Order,
  PaymentRecord,
  SessionUser,
  StaffMember,
  UserRole,
  Workspace,
} from "@/lib/fieldflow";
import { emptyWorkspace } from "@/lib/fieldflow";
import {
  DESK_STATUS_EVENT,
  INTEGRATION_CLIENT_ID,
  type CommerceOrderPaidEvent,
  type DeskStatusChangedEvent,
} from "@/lib/integrations/contracts";
import { queryDatabase } from "@/lib/server/database";

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

type StoredEmployee = Omit<Employee, "password"> & { passwordHash: string };
type StoredStaff = Omit<StaffMember, "password"> & { passwordHash: string };
type StoredSession = {
  tokenHash: string;
  userId: string;
  role: UserRole;
  expiresAt: number;
};
type Database = Omit<Workspace, "employees" | "staff"> & {
  employees: StoredEmployee[];
  staff: StoredStaff[];
  sessions: StoredSession[];
  revision: number;
};

const initialDatabase = (): Database => ({
  ...emptyWorkspace(),
  employees: [],
  staff: [],
  sessions: [],
  revision: 0,
});

async function readDatabase(): Promise<Database> {
  return queryDatabase(async (client) => {
    const initial = initialDatabase();
    await client.query(
      `INSERT INTO fieldflow_state (id, data, revision)
       VALUES (1, $1::jsonb, 0)
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(initial)],
    );
    const result = await client.query(
      "SELECT data, revision FROM fieldflow_state WHERE id = 1",
    );
    const row = result.rows[0] as { data: Database; revision: string } | undefined;
    if (!row) throw new Error("The database state could not be initialized.");
    return {
      ...initial,
      ...row.data,
      revision: Number(row.revision),
    };
  });
}

function mutate<T>(
  operation: (database: Database, client: PoolClient) => Promise<T> | T,
): Promise<T> {
  return queryDatabase(async (client) => {
    await client.query("BEGIN");
    try {
      const initial = initialDatabase();
      await client.query(
        `INSERT INTO fieldflow_state (id, data, revision)
         VALUES (1, $1::jsonb, 0)
         ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(initial)],
      );
      const selected = await client.query(
        "SELECT data, revision FROM fieldflow_state WHERE id = 1 FOR UPDATE",
      );
      const row = selected.rows[0] as
        | { data: Database; revision: string }
        | undefined;
      if (!row) throw new Error("The database state could not be initialized.");
      const database: Database = {
        ...initial,
        ...row.data,
        revision: Number(row.revision),
      };
      const result = await operation(database, client);
      database.revision += 1;
      await client.query(
        `UPDATE fieldflow_state
         SET data = $1::jsonb, revision = $2, updated_at = NOW()
         WHERE id = 1`,
        [JSON.stringify(database), database.revision],
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

const COMMERCE_ORDER_FIELDS = [
  "source",
  "externalOrderId",
  "externalOrderNumber",
  "importPayloadHash",
  "customer",
  "customerMobile",
  "customerEmail",
  "item",
  "value",
  "advanceAmount",
  "advancePaymentMethod",
  "shippingAddress",
  "lineItems",
  "subtotalPaise",
  "discountPaise",
  "shippingPaise",
  "totalPaise",
  "paidPaise",
  "balanceDuePaise",
  "currency",
  "paymentProvider",
  "paymentReference",
  "paymentMethod",
  "partialPayment",
  "placedAt",
  "paidAt",
  "promisedDeliveryAt",
  "commerceStatus",
  "createdAt",
] as const satisfies readonly (keyof Order)[];

function protectCommerceOrder(incoming: Order, current: Order) {
  const protectedOrder = { ...incoming };
  for (const key of COMMERCE_ORDER_FIELDS) {
    Object.assign(protectedOrder, { [key]: current[key] });
  }
  return protectedOrder;
}

function statusForFrames(status: string) {
  if (status === "In progress") return "PROCESSING" as const;
  if (status === "Completed") return "READY_TO_SHIP" as const;
  if (status === "Cancelled") return "CANCELLED" as const;
  return null;
}

async function enqueueCommerceStatusChanges(
  client: PoolClient,
  previous: Order[],
  current: Order[],
  actor: SessionUser,
) {
  const previousById = new Map(previous.map((order) => [order.id, order]));
  for (const order of current) {
    if (order.source !== "Frames 41" || !order.externalOrderId || !order.externalOrderNumber) {
      continue;
    }
    const before = previousById.get(order.id);
    if (!before || before.status === order.status) continue;
    const commerceStatus = statusForFrames(order.status);
    if (!commerceStatus) continue;
    const eventId = randomUUID();
    const event: DeskStatusChangedEvent = {
      eventId,
      eventType: DESK_STATUS_EVENT,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      source: "desk",
      clientId: INTEGRATION_CLIENT_ID,
      correlationId: randomUUID(),
      aggregateId: order.externalOrderId,
      payload: {
        externalOrderId: order.externalOrderId,
        externalOrderNumber: order.externalOrderNumber,
        deskOrderId: order.id,
        deskStatus: order.status as DeskStatusChangedEvent["payload"]["deskStatus"],
        commerceStatus,
        changedBy: { id: actor.id, name: actor.name, role: actor.role },
      },
    };
    await client.query(
      `INSERT INTO fieldflow_integration_outbox
         (event_id, client_id, event_type, aggregate_id, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [eventId, INTEGRATION_CLIENT_ID, DESK_STATUS_EVENT, order.externalOrderId, JSON.stringify(event)],
    );
  }
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, expectedHex] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function publicWorkspace(database: Database): Workspace {
  const publicEmployee = (employee: StoredEmployee): Employee => {
    const copy: Partial<StoredEmployee> = { ...employee };
    delete copy.passwordHash;
    return copy as Employee;
  };
  const publicStaff = (member: StoredStaff): StaffMember => {
    const copy: Partial<StoredStaff> = { ...member };
    delete copy.passwordHash;
    return copy as StaffMember;
  };
  return {
    employees: database.employees.map(publicEmployee),
    staff: database.staff.map(publicStaff),
    tasks: database.tasks,
    orders: database.orders,
    payments: database.payments,
  };
}

function workspaceFor(database: Database, actor: SessionUser): Workspace {
  const workspace = publicWorkspace(database);
  if (actor.role !== "Employee") return workspace;
  const tasks = workspace.tasks.filter(
    (task) =>
      task.ownerId === actor.id ||
      task.owner === actor.name ||
      task.collaborators?.some(
        (collaborator) => collaborator.employeeId === actor.id,
      ),
  );
  const orderIds = new Set(tasks.map((task) => task.orderId).filter(Boolean));
  return {
    employees: workspace.employees.filter((employee) => employee.id === actor.id),
    staff: [],
    tasks,
    orders: workspace.orders.filter((order) => orderIds.has(order.id)),
    payments: [],
  };
}

function findUser(database: Database, id: string, role: UserRole): SessionUser | null {
  if (role === "Employee") {
    const employee = database.employees.find((entry) => entry.id === id);
    return employee ? { id: employee.id, name: employee.name, role } : null;
  }
  const member = database.staff.find((entry) => entry.id === id && entry.role === role);
  return member ? { id: member.id, name: member.name, role: member.role } : null;
}

export async function getSetupRequired() {
  const database = await readDatabase();
  return database.staff.length === 0 && database.employees.length === 0;
}

export async function bootstrapAdmin(name: string, password: string) {
  return mutate(async (database) => {
    if (database.staff.length || database.employees.length) {
      throw new Error("Workspace setup is already complete.");
    }
    const member: StoredStaff = {
      id: randomUUID(),
      name,
      role: "Admin",
      passwordHash: await hashPassword(password),
      attendanceSeconds: 0,
      attendanceStartedAt: null,
      attendanceRecords: [],
    };
    database.staff.push(member);
    return { id: member.id, name: member.name, role: member.role } satisfies SessionUser;
  });
}

export async function authenticate(name: string, password: string) {
  const database = await readDatabase();
  const normalizedName = name.trim().toLocaleLowerCase();
  const account = [...database.staff, ...database.employees].find(
    (entry) => entry.name.toLocaleLowerCase() === normalizedName,
  );
  if (!account || !(await verifyPassword(password, account.passwordHash))) return null;
  const staffAccount = database.staff.find((entry) => entry.id === account.id);
  const role: UserRole = staffAccount ? staffAccount.role : "Employee";
  return { id: account.id, name: account.name, role } satisfies SessionUser;
}

export async function createSession(user: SessionUser) {
  const token = randomBytes(32).toString("base64url");
  await mutate((database) => {
    const now = Date.now();
    database.sessions = database.sessions.filter(
      (session) => session.expiresAt > now && session.userId !== user.id,
    );
    database.sessions.push({
      tokenHash: tokenHash(token),
      userId: user.id,
      role: user.role,
      expiresAt: now + SESSION_TTL_MS,
    });
  });
  return token;
}

export async function resolveSession(token: string | undefined) {
  if (!token) return null;
  const database = await readDatabase();
  const session = database.sessions.find(
    (entry) => entry.tokenHash === tokenHash(token) && entry.expiresAt > Date.now(),
  );
  return session ? findUser(database, session.userId, session.role) : null;
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await mutate((database) => {
    const hashed = tokenHash(token);
    database.sessions = database.sessions.filter((entry) => entry.tokenHash !== hashed);
  });
}

export async function getWorkspace(actor: SessionUser) {
  return workspaceFor(await readDatabase(), actor);
}

function importedOrderId(orderNumber: string, existing: Order[]) {
  const base = `#F41-${orderNumber.replace(/[^a-zA-Z0-9-]/g, "").slice(-24)}`;
  if (!existing.some((order) => order.id === base)) return base;
  return `${base}-${randomUUID().slice(0, 6)}`;
}

function formatImportedRupees(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

export async function importCommerceOrder(
  event: CommerceOrderPaidEvent,
  payloadHash: string,
) {
  return mutate(async (database, client) => {
    const inserted = await client.query(
      `INSERT INTO fieldflow_integration_inbox
         (event_id, client_id, event_type, aggregate_id, payload_hash, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [
        event.eventId,
        event.clientId,
        event.eventType,
        event.aggregateId,
        payloadHash,
        JSON.stringify(event),
      ],
    );

    if (!inserted.rowCount) {
      const existingEvent = await client.query(
        "SELECT payload_hash FROM fieldflow_integration_inbox WHERE event_id = $1",
        [event.eventId],
      );
      if (existingEvent.rows[0]?.payload_hash !== payloadHash) {
        throw new Error("The event ID has already been used with a different payload.");
      }
      const order = database.orders.find(
        (entry) => entry.externalOrderId === event.payload.externalOrderId,
      );
      if (!order) throw new Error("The duplicate event has no matching Desk order.");
      return { order, duplicate: true };
    }

    const existingOrder = database.orders.find(
      (entry) => entry.externalOrderId === event.payload.externalOrderId,
    );
    if (existingOrder) {
      if (existingOrder.importPayloadHash !== payloadHash) {
        throw new Error("This Frames 41 order was previously imported with different data.");
      }
      await client.query(
        "UPDATE fieldflow_integration_inbox SET processed_at = NOW() WHERE event_id = $1",
        [event.eventId],
      );
      return { order: existingOrder, duplicate: true };
    }

    const payload = event.payload;
    const order: Order = {
      id: importedOrderId(payload.externalOrderNumber, database.orders),
      createdAt: Date.parse(payload.placedAt),
      source: "Frames 41",
      externalOrderId: payload.externalOrderId,
      externalOrderNumber: payload.externalOrderNumber,
      importPayloadHash: payloadHash,
      customer: payload.customer.name,
      customerMobile: payload.customer.phone,
      customerEmail: payload.customer.email,
      item: payload.items.map((item) => `${item.name} × ${item.quantity}`).join(", "),
      value: formatImportedRupees(payload.amounts.totalPaise),
      advanceAmount: payload.amounts.paidPaise / 100,
      advancePaymentMethod: "Razorpay",
      shippingAddress: payload.shippingAddress,
      lineItems: payload.items,
      subtotalPaise: payload.amounts.subtotalPaise,
      discountPaise: payload.amounts.discountPaise,
      shippingPaise: payload.amounts.shippingPaise,
      totalPaise: payload.amounts.totalPaise,
      paidPaise: payload.amounts.paidPaise,
      balanceDuePaise: payload.amounts.balanceDuePaise,
      currency: "INR",
      paymentProvider: "Razorpay",
      paymentReference: payload.payment.paymentId,
      paymentMethod: payload.payment.method,
      partialPayment: payload.payment.isPartial,
      placedAt: payload.placedAt,
      paidAt: payload.paidAt,
      promisedDeliveryAt: payload.promisedDeliveryAt,
      commerceStatus: payload.commerceStatus,
      deadline: payload.promisedDeliveryAt.slice(0, 10),
      status: "Pending",
      color: "orange",
    };
    const payment: PaymentRecord = {
      id: `commerce-${payload.payment.paymentId}`,
      orderId: order.id,
      source: "Commerce",
      customer: payload.customer.name,
      cashAmount: 0,
      upiAmount: payload.amounts.paidPaise / 100,
      total: payload.amounts.paidPaise / 100,
      method: "Razorpay",
      upiReference: payload.payment.paymentId,
      createdAt: Date.parse(payload.payment.capturedAt),
    };
    database.orders.unshift(order);
    database.payments.push(payment);
    await client.query(
      "UPDATE fieldflow_integration_inbox SET processed_at = NOW() WHERE event_id = $1",
      [event.eventId],
    );
    return { order, duplicate: false };
  });
}

export async function getIntegrationSyncState(
  actor: SessionUser,
  orderId: string,
): Promise<IntegrationSyncState | null> {
  if (actor.role === "Employee") throw new Error("Staff access is required.");
  return queryDatabase(async (client) => {
    const result = await client.query(
      `SELECT event_id, status, attempts, max_attempts, last_error, delivered_at, updated_at
       FROM fieldflow_integration_outbox
       WHERE payload->'payload'->>'deskOrderId' = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [orderId],
    );
    const row = result.rows[0] as
      | {
          event_id: string;
          status: IntegrationSyncState["status"];
          attempts: number;
          max_attempts: number;
          last_error: string | null;
          delivered_at: Date | null;
          updated_at: Date;
        }
      | undefined;
    return row
      ? {
          eventId: row.event_id,
          status: row.status,
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
          lastError: row.last_error,
          deliveredAt: row.delivered_at?.toISOString() ?? null,
          updatedAt: row.updated_at.toISOString(),
        }
      : null;
  });
}

export async function retryIntegrationSync(actor: SessionUser, orderId: string) {
  if (actor.role === "Employee") throw new Error("Staff access is required.");
  return queryDatabase(async (client) => {
    const result = await client.query(
      `UPDATE fieldflow_integration_outbox
       SET status = 'PENDING', attempts = 0, next_attempt_at = NOW(),
           locked_at = NULL, locked_by = NULL, last_error = NULL, updated_at = NOW()
       WHERE event_id = (
         SELECT event_id FROM fieldflow_integration_outbox
         WHERE payload->'payload'->>'deskOrderId' = $1 AND status = 'FAILED'
         ORDER BY created_at DESC LIMIT 1
       )
       RETURNING event_id`,
      [orderId],
    );
    if (!result.rowCount) throw new Error("No failed Frames 41 sync was found.");
    return getIntegrationSyncState(actor, orderId);
  });
}

function cleanText(value: unknown, field: string, maxLength = 160) {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength) throw new Error(`${field} is invalid.`);
  return cleaned;
}

export async function updateStaffAccount(
  actor: SessionUser,
  name: string,
  currentPassword: string,
  newPassword: string,
) {
  return mutate(async (database) => {
    if (actor.role === "Employee") {
      throw new Error("Only admins and managers can update staff credentials.");
    }
    const member = database.staff.find((entry) => entry.id === actor.id);
    if (!member || member.role !== actor.role) {
      throw new Error("Staff account was not found.");
    }
    if (!(await verifyPassword(currentPassword, member.passwordHash))) {
      throw new Error("Current password is incorrect.");
    }

    const nextName = cleanText(name, "Login name", 80);
    const normalizedName = nextName.toLocaleLowerCase();
    const duplicateAccount = [...database.staff, ...database.employees].some(
      (entry) =>
        entry.id !== member.id &&
        entry.name.trim().toLocaleLowerCase() === normalizedName,
    );
    if (duplicateAccount) throw new Error("That login name is already in use.");
    if (newPassword && newPassword.length < 8) {
      throw new Error("New password must contain at least 8 characters.");
    }

    member.name = nextName;
    if (newPassword) member.passwordHash = await hashPassword(newPassword);

    const user = {
      id: member.id,
      name: member.name,
      role: member.role,
    } satisfies SessionUser;
    return { user, workspace: workspaceFor(database, user) };
  });
}

export async function setManualAttendance(
  actor: SessionUser,
  employeeId: string,
  date: string,
  status: "Absent" | null,
) {
  return mutate((database) => {
    if (actor.role !== "Manager") {
      throw new Error("Only managers can mark attendance manually.");
    }
    const employee = database.employees.find((entry) => entry.id === employeeId);
    if (!employee) throw new Error("Employee account was not found.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("Attendance date is invalid.");
    }
    if (status === "Absent" && employee.attendanceRecords?.some((record) => record.date === date)) {
      throw new Error("An employee with clocked time cannot be marked absent.");
    }

    if (status === null) {
      employee.manualAttendance = (employee.manualAttendance ?? []).filter(
        (item) => item.date !== date,
      );
      return { workspace: workspaceFor(database, actor) };
    }

    const entry = {
      date,
      status,
      markedAt: Date.now(),
      markedBy: actor.name,
    } as const;
    employee.manualAttendance = [
      ...(employee.manualAttendance ?? []).filter((item) => item.date !== date),
      entry,
    ].sort((left, right) => right.date.localeCompare(left.date));
    return { workspace: workspaceFor(database, actor) };
  });
}

function validateWorkspace(input: unknown): Workspace {
  if (!input || typeof input !== "object") throw new Error("Invalid workspace payload.");
  const value = input as Partial<Workspace>;
  for (const key of ["employees", "staff", "tasks", "orders", "payments"] as const) {
    if (!Array.isArray(value[key]) || value[key]!.length > 10_000) {
      throw new Error(`Invalid ${key} collection.`);
    }
  }
  const workspace = value as Workspace;
  const normalizedNames = [
    ...workspace.employees.map((entry) => entry.name.trim().toLocaleLowerCase()),
    ...workspace.staff.map((entry) => entry.name.trim().toLocaleLowerCase()),
  ];
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    throw new Error("Account names must be unique.");
  }
  workspace.employees.forEach((entry) => {
    cleanText(entry.id, "Employee id");
    cleanText(entry.name, "Employee name");
    cleanText(entry.role, "Employee role");
    if (entry.manualAttendance !== undefined && !Array.isArray(entry.manualAttendance)) {
      throw new Error("Invalid manual attendance collection.");
    }
    entry.manualAttendance?.forEach((attendance) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(attendance.date)) {
        throw new Error("Manual attendance date is invalid.");
      }
      if (attendance.status !== "Present" && attendance.status !== "Absent") {
        throw new Error("Manual attendance status is invalid.");
      }
      cleanText(attendance.markedBy, "Attendance marker", 80);
    });
  });
  workspace.staff.forEach((entry) => {
    cleanText(entry.id, "Staff id");
    cleanText(entry.name, "Staff name");
    if (entry.role !== "Admin" && entry.role !== "Manager") throw new Error("Invalid staff role.");
  });
  workspace.tasks.forEach((entry) => cleanText(entry.title, "Task title", 300));
  workspace.tasks.forEach((entry) =>
    entry.collaborators?.forEach((collaborator) => {
      cleanText(collaborator.employeeId, "Collaborator id");
      cleanText(collaborator.name, "Collaborator name");
      cleanText(collaborator.responsibility, "Collaborator responsibility", 300);
    }),
  );
  workspace.orders.forEach((entry) => cleanText(entry.id, "Order id"));
  workspace.orders.forEach((entry) => {
    if (entry.source === "Frames 41") {
      cleanText(entry.externalOrderId, "External order id");
      cleanText(entry.externalOrderNumber, "External order number");
      if (!Array.isArray(entry.lineItems) || !entry.lineItems.length) {
        throw new Error("Imported orders must keep their line items.");
      }
    }
  });
  workspace.payments.forEach((entry) => cleanText(entry.id, "Payment id"));
  return workspace;
}

async function mergeEmployees(incoming: Employee[], current: StoredEmployee[]) {
  return Promise.all(incoming.map(async ({ password, ...employee }) => {
    const existing = current.find((entry) => entry.id === employee.id);
    if (!existing && (!password || password.length < 6)) {
      throw new Error("New employee passwords must contain at least 6 characters.");
    }
    return {
      ...employee,
      passwordHash: password ? await hashPassword(password) : existing!.passwordHash,
    };
  }));
}

async function mergeStaff(incoming: StaffMember[], current: StoredStaff[]) {
  return Promise.all(incoming.map(async ({ password, ...member }) => {
    const existing = current.find((entry) => entry.id === member.id);
    if (!existing && (!password || password.length < 8)) {
      throw new Error("New staff passwords must contain at least 8 characters.");
    }
    return {
      ...member,
      passwordHash: password ? await hashPassword(password) : existing!.passwordHash,
    };
  }));
}

export async function saveWorkspace(input: unknown, actor: SessionUser) {
  const incoming = validateWorkspace(input);
  return mutate(async (database, client) => {
    const previousOrders = database.orders.map((order) => ({ ...order }));
    if (actor.role === "Employee") {
      const currentEmployee = database.employees.find((entry) => entry.id === actor.id);
      const nextEmployee = incoming.employees.find((entry) => entry.id === actor.id);
      if (!currentEmployee || !nextEmployee) throw new Error("Employee account was not found.");

      currentEmployee.attendanceSeconds = nextEmployee.attendanceSeconds;
      currentEmployee.attendanceStartedAt = nextEmployee.attendanceStartedAt;
      currentEmployee.attendanceRecords = nextEmployee.attendanceRecords;
      const clockedDates = new Set(
        (nextEmployee.attendanceRecords ?? []).map((record) => record.date),
      );
      currentEmployee.manualAttendance = (
        currentEmployee.manualAttendance ?? []
      ).filter((entry) => !clockedDates.has(entry.date));
      currentEmployee.active = nextEmployee.active;
      currentEmployee.hours = nextEmployee.hours;

      const ownedTaskIds = new Set(
        database.tasks
          .filter(
            (task) =>
              task.ownerId === actor.id ||
              task.owner === actor.name ||
              task.collaborators?.some(
                (collaborator) => collaborator.employeeId === actor.id,
              ),
          )
          .map((task) => `${task.orderId ?? ""}\u0000${task.title}`),
      );
      for (const changedTask of incoming.tasks) {
        const key = `${changedTask.orderId ?? ""}\u0000${changedTask.title}`;
        if (!ownedTaskIds.has(key)) continue;
        const task = database.tasks.find(
          (entry) => `${entry.orderId ?? ""}\u0000${entry.title}` === key,
        );
        if (task) {
          const isLead = task.ownerId === actor.id || task.owner === actor.name;
          if (!isLead && changedTask.completed) {
            throw new Error("Only the task lead can mark shared work as completed.");
          }
          task.status = changedTask.status;
          task.completed = changedTask.completed;
          task.completedAt = changedTask.completedAt;
          task.progress = changedTask.progress;
        }
        if (changedTask.orderId) {
          const order = database.orders.find((entry) => entry.id === changedTask.orderId);
          if (order) {
            order.status = changedTask.completed ? "Completed" : "In progress";
            order.color = changedTask.completed ? "green" : "orange";
          }
        }
      }
      await enqueueCommerceStatusChanges(client, previousOrders, database.orders, actor);
      return workspaceFor(database, actor);
    }

    const incomingEmployees =
      actor.role === "Admin"
        ? incoming.employees.map((employee) => ({
            ...employee,
            manualAttendance: database.employees.find(
              (current) => current.id === employee.id,
            )?.manualAttendance,
          }))
        : incoming.employees;
    database.employees = await mergeEmployees(incomingEmployees, database.employees);
    database.staff = await mergeStaff(incoming.staff, database.staff);
    database.tasks = incoming.tasks;

    const currentImportedOrders = database.orders.filter(
      (order) => order.source === "Frames 41",
    );
    for (const current of currentImportedOrders) {
      if (!incoming.orders.some((order) => order.id === current.id)) {
        throw new Error("Frames 41 orders cannot be deleted from Desk.");
      }
    }
    database.orders = incoming.orders.map((order) => {
      const current = database.orders.find((entry) => entry.id === order.id);
      if (order.source === "Frames 41" && !current) {
        throw new Error("Frames 41 orders can only be created by the integration API.");
      }
      return current?.source === "Frames 41"
        ? protectCommerceOrder(order, current)
        : { ...order, source: order.source ?? "Desk" };
    });

    const currentCommercePayments = database.payments.filter(
      (payment) => payment.source === "Commerce",
    );
    for (const current of currentCommercePayments) {
      if (!incoming.payments.some((payment) => payment.id === current.id)) {
        throw new Error("Frames 41 payment records cannot be deleted from Desk.");
      }
    }
    database.payments = incoming.payments.map((payment) => {
      const current = database.payments.find((entry) => entry.id === payment.id);
      if (payment.source === "Commerce" && !current) {
        throw new Error("Commerce payments can only be created by the integration API.");
      }
      return current?.source === "Commerce" ? current : payment;
    });

    if (!database.staff.some((member) => member.role === "Admin")) {
      throw new Error("The workspace must keep at least one admin account.");
    }
    await enqueueCommerceStatusChanges(client, previousOrders, database.orders, actor);
    return workspaceFor(database, actor);
  });
}
