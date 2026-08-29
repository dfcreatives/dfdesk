import "server-only";

import { cookies } from "next/headers";
import type { SessionUser } from "@/lib/fieldflow";
import { resolveSession } from "@/lib/server/store";

export const SESSION_COOKIE = "fieldflow_session";

export async function currentSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  return resolveSession(cookieStore.get(SESSION_COOKIE)?.value);
}

export function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Content-Type must be application/json.");
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 2_000_000) throw new Error("Request body is too large.");
  return request.json() as Promise<unknown>;
}
