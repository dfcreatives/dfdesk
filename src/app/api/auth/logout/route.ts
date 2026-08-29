import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/server/http";
import { destroySession } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  await destroySession(cookieStore.get(SESSION_COOKIE)?.value);
  cookieStore.delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}
