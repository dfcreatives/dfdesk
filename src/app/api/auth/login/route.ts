import { cookies } from "next/headers";
import { errorResponse, readJson, SESSION_COOKIE } from "@/lib/server/http";
import { authenticate, createSession, getWorkspace } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await readJson(request)) as { name?: unknown; password?: unknown };
    if (typeof body.name !== "string" || typeof body.password !== "string") {
      return errorResponse("Name and password are required.");
    }
    const user = await authenticate(body.name, body.password);
    if (!user) return errorResponse("Name or password is incorrect.", 401);

    const token = await createSession(user);
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    return Response.json({ user, workspace: await getWorkspace(user) });
  } catch {
    return errorResponse("Unable to sign in.");
  }
}
