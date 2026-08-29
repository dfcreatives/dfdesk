import { currentSession, errorResponse, readJson } from "@/lib/server/http";
import { getWorkspace, saveWorkspace } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentSession();
  if (!user) return errorResponse("Authentication required.", 401);
  return Response.json({ workspace: await getWorkspace(user) });
}

export async function PUT(request: Request) {
  const user = await currentSession();
  if (!user) return errorResponse("Authentication required.", 401);
  try {
    const body = (await readJson(request)) as { workspace?: unknown };
    return Response.json({ workspace: await saveWorkspace(body.workspace, user) });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to save workspace.");
  }
}
