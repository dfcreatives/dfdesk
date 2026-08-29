import { currentSession, errorResponse, readJson } from "@/lib/server/http";
import { setManualAttendance } from "@/lib/server/store";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const user = await currentSession();
  if (!user) return errorResponse("Authentication required.", 401);
  if (user.role !== "Manager") {
    return errorResponse("Only managers can mark attendance manually.", 403);
  }

  try {
    const body = (await readJson(request)) as {
      employeeId?: unknown;
      date?: unknown;
      status?: unknown;
    };
    if (
      typeof body.employeeId !== "string" ||
      typeof body.date !== "string" ||
      (body.status !== "Absent" && body.status !== null)
    ) {
      return errorResponse("Employee, date, and attendance status are required.");
    }
    return Response.json(
      await setManualAttendance(user, body.employeeId, body.date, body.status),
    );
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Unable to mark attendance.",
    );
  }
}
