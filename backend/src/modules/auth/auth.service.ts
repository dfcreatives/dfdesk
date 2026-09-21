import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  conflict,
  forbidden,
  unauthorized,
} from "../../shared/errors/app-error.js";
import {
  hashPassword,
  verifyPassword,
} from "../../shared/security/password.js";
import { hashToken, randomToken } from "../../shared/security/tokens.js";
import { env } from "../../config/env.js";

const publicUser = (user: {
  id: string;
  workspaceId: string;
  loginName: string;
  role: UserRole;
}) => ({
  id: user.id,
  workspaceId: user.workspaceId,
  name: user.loginName,
  role:
    user.role === UserRole.ADMIN
      ? ("Admin" as const)
      : user.role === UserRole.MANAGER
        ? ("Manager" as const)
        : ("Employee" as const),
});

export async function setupRequired() {
  return (await prisma.user.count({ where: { archivedAt: null } })) === 0;
}

export async function bootstrap(name: string, password: string) {
  const passwordHash = await hashPassword(password);
  try {
    const user = await prisma.$transaction(
      async (database) => {
        if (await database.user.count())
          throw conflict(
            "Workspace setup is already complete.",
            "SETUP_COMPLETE",
          );
        const workspace = await database.workspace.create({
          data: { name: "Desk", slug: "desk" },
        });
        return database.user.create({
          data: {
            workspaceId: workspace.id,
            loginName: name,
            normalizedName: name.toLocaleLowerCase(),
            passwordHash,
            role: UserRole.ADMIN,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return publicUser(user);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw conflict("Workspace setup is already complete.", "SETUP_COMPLETE");
    throw error;
  }
}

export async function authenticate(name: string, password: string) {
  const user = await prisma.user.findFirst({
    where: {
      normalizedName: name.trim().toLocaleLowerCase(),
      archivedAt: null,
      active: true,
    },
  });
  if (!user || !(await verifyPassword(password, user.passwordHash)))
    return null;
  return publicUser(user);
}

export async function createSession(
  userId: string,
  metadata: { ipAddress?: string; userAgent?: string },
) {
  const token = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_DAYS * 86_400_000);
  await prisma.$transaction([
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.session.create({
      data: { tokenHash: hashToken(token), userId, expiresAt, ...metadata },
    }),
  ]);
  return { token, csrfToken, expiresAt };
}

export async function resolveSession(token: string | undefined) {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    session.user.archivedAt ||
    !session.user.active
  )
    return null;
  return publicUser(session.user);
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function updateAccount(
  actor: Express.Request["actor"],
  name: string,
  currentPassword: string,
  newPassword: string,
) {
  if (!actor || actor.role === UserRole.EMPLOYEE)
    throw forbidden("Only admins and managers can update staff credentials.");
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash)))
    throw unauthorized("Current password is incorrect.");
  const updated = await prisma.user.update({
    where: { id: actor.id },
    data: {
      loginName: name,
      normalizedName: name.toLocaleLowerCase(),
      ...(newPassword ? { passwordHash: await hashPassword(newPassword) } : {}),
      version: { increment: 1 },
    },
  });
  return publicUser(updated);
}
