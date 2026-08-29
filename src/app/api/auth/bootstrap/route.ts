import { cookies } from "next/headers";
import { errorResponse, readJson, SESSION_COOKIE } from "@/lib/server/http";
import { bootstrapAdmin, createSession, getWorkspace } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await readJson(request)) as { name?: unknown; password?: unknown };
    if (typeof body.name !== "string" || body.name.trim().length < 2) {
      return errorResponse("Enter a valid account name.");
    }
    if (typeof body.password !== "string" || body.password.length < 8) {
      return errorResponse("Password must contain at least 8 characters.");
    }
    const user = await bootstrapAdmin(body.name.trim(), body.password);
    const token = await createSession(user);
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    return Response.json({ user, workspace: await getWorkspace(user) }, { status: 201 });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to create the workspace.");
  }
}
