import { currentSession, errorResponse, readJson } from "@/lib/server/http";
import { updateStaffAccount } from "@/lib/server/store";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const user = await currentSession();
  if (!user) return errorResponse("Authentication required.", 401);
  if (user.role === "Employee") {
    return errorResponse("Only admins and managers can update staff credentials.", 403);
  }

  try {
    const body = (await readJson(request)) as {
      name?: unknown;
      currentPassword?: unknown;
      newPassword?: unknown;
    };
    if (typeof body.name !== "string" || typeof body.currentPassword !== "string") {
      return errorResponse("Login name and current password are required.");
    }
    if (body.newPassword !== undefined && typeof body.newPassword !== "string") {
      return errorResponse("New password must be text.");
    }
    return Response.json(
      await updateStaffAccount(
        user,
        body.name,
        body.currentPassword,
        body.newPassword ?? "",
      ),
    );
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Unable to update account.",
    );
  }
}
