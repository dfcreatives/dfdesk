import { currentSession } from "@/lib/server/http";
import { getSetupRequired, getWorkspace } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentSession();
  return Response.json({
    user,
    setupRequired: await getSetupRequired(),
    workspace: user ? await getWorkspace(user) : null,
  });
}
