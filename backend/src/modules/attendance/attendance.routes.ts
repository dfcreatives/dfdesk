import { Router } from "express";
import { requireActor } from "../../middleware/auth.js";
import { ok } from "../../shared/http/respond.js";
import { getWorkspace } from "../legacy-workspace/legacy-workspace.service.js";
import {
  clockIn,
  clockOut,
  setManualAttendance,
} from "./attendance.service.js";
import { manualAttendanceSchema } from "./attendance.schema.js";

export const attendanceRouter = Router();
attendanceRouter.use(requireActor);
attendanceRouter.get("/", async (request, response) =>
  ok(response, { workspace: await getWorkspace(request.actor!) }),
);
attendanceRouter.post("/clock-in", async (request, response) => {
  await clockIn(request.actor!);
  return ok(response, { workspace: await getWorkspace(request.actor!) }, 201);
});
attendanceRouter.post("/clock-out", async (request, response) => {
  await clockOut(request.actor!);
  return ok(response, { workspace: await getWorkspace(request.actor!) });
});
attendanceRouter.patch("/manual/:userId/:date", async (request, response) => {
  const patch = manualAttendanceSchema
    .pick({ status: true })
    .parse(request.body);
  const body = manualAttendanceSchema.parse({
    employeeId: String(request.params.userId),
    date: String(request.params.date),
    status: patch.status,
  });
  await setManualAttendance(
    request.actor!,
    body.employeeId,
    body.date,
    body.status,
  );
  return ok(response, { workspace: await getWorkspace(request.actor!) });
});

export const legacyAttendanceRouter = Router();
legacyAttendanceRouter.patch(
  "/manual",
  requireActor,
  async (request, response) => {
    const body = manualAttendanceSchema.parse(request.body);
    await setManualAttendance(
      request.actor!,
      body.employeeId,
      body.date,
      body.status,
    );
    return ok(response, { workspace: await getWorkspace(request.actor!) });
  },
);
