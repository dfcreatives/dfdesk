import { AttendanceStatus, UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  badRequest,
  forbidden,
  notFound,
} from "../../shared/errors/app-error.js";

export async function clockIn(actor: NonNullable<Express.Request["actor"]>) {
  const open = await prisma.attendanceSession.findFirst({
    where: { userId: actor.id, clockOut: null },
  });
  if (open)
    throw badRequest("You are already clocked in.", "ALREADY_CLOCKED_IN");
  const now = new Date();
  return prisma.attendanceSession.create({
    data: {
      userId: actor.id,
      workDate: new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`),
      clockIn: now,
    },
  });
}

export async function clockOut(actor: NonNullable<Express.Request["actor"]>) {
  const open = await prisma.attendanceSession.findFirst({
    where: { userId: actor.id, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
  if (!open)
    throw badRequest(
      "No active attendance session was found.",
      "NOT_CLOCKED_IN",
    );
  const now = new Date();
  return prisma.attendanceSession.update({
    where: { id: open.id },
    data: {
      clockOut: now,
      durationSeconds: Math.max(
        0,
        Math.floor((now.getTime() - open.clockIn.getTime()) / 1000),
      ),
    },
  });
}

export async function setManualAttendance(
  actor: NonNullable<Express.Request["actor"]>,
  employeeId: string,
  date: string,
  status: "Absent" | null,
) {
  if (actor.role !== UserRole.MANAGER)
    throw forbidden("Only managers can mark attendance manually.");
  const user = await prisma.user.findFirst({
    where: {
      id: employeeId,
      workspaceId: actor.workspaceId,
      role: UserRole.EMPLOYEE,
      archivedAt: null,
    },
  });
  if (!user) throw notFound("Employee account was not found.");
  const workDate = new Date(`${date}T00:00:00.000Z`);
  if (status === null) {
    await prisma.manualAttendance.deleteMany({
      where: { userId: employeeId, workDate },
    });
    return;
  }
  if (
    await prisma.attendanceSession.count({
      where: { userId: employeeId, workDate },
    })
  )
    throw badRequest("An employee with clocked time cannot be marked absent.");
  await prisma.manualAttendance.upsert({
    where: { userId_workDate: { userId: employeeId, workDate } },
    create: {
      userId: employeeId,
      workDate,
      status: AttendanceStatus.ABSENT,
      markedById: actor.id,
    },
    update: { status: AttendanceStatus.ABSENT, markedById: actor.id },
  });
}
