import "server-only";

import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  Employee,
  SessionUser,
  StaffMember,
  UserRole,
  Workspace,
} from "@/lib/fieldflow";
import { emptyWorkspace } from "@/lib/fieldflow";

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const DATA_DIRECTORY = path.join(process.cwd(), ".data");
const DATA_FILE = process.env.FIELDFLOW_DATA_FILE ?? path.join(DATA_DIRECTORY, "fieldflow.json");

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

let writeQueue: Promise<unknown> = Promise.resolve();

async function readDatabase(): Promise<Database> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Database;
    return { ...initialDatabase(), ...parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const database = initialDatabase();
    await writeDatabase(database);
    return database;
  }
}

async function writeDatabase(database: Database) {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  const temporaryFile = `${DATA_FILE}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(database, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryFile, DATA_FILE);
}

function mutate<T>(operation: (database: Database) => Promise<T> | T): Promise<T> {
  const pending = writeQueue.then(async () => {
    const database = await readDatabase();
    const result = await operation(database);
    database.revision += 1;
    await writeDatabase(database);
    return result;
  });
  writeQueue = pending.catch(() => undefined);
  return pending;
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
  return mutate(async (database) => {
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
    database.orders = incoming.orders;
    database.payments = incoming.payments;

    if (!database.staff.some((member) => member.role === "Admin")) {
      throw new Error("The workspace must keep at least one admin account.");
    }
    return workspaceFor(database, actor);
  });
}
