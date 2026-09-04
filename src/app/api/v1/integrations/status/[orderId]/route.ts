import { currentSession, errorResponse } from "@/lib/server/http";
import { getIntegrationSyncState, retryIntegrationSync } from "@/lib/server/store";

export const runtime = "nodejs";

type RouteContextValue = { params: Promise<{ orderId: string }> };

async function actorAndOrderId(context: RouteContextValue) {
  const actor = await currentSession();
  if (!actor) return { response: errorResponse("Authentication required.", 401) } as const;
  if (actor.role === "Employee") {
    return { response: errorResponse("Staff access is required.", 403) } as const;
  }
  const { orderId } = await context.params;
  return { actor, orderId } as const;
}

export async function GET(
  _request: Request,
  context: RouteContextValue,
) {
  const resolved = await actorAndOrderId(context);
  if ("response" in resolved) return resolved.response;
  try {
    return Response.json({ sync: await getIntegrationSyncState(resolved.actor, resolved.orderId) });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to read sync status.");
  }
}

export async function POST(
  _request: Request,
  context: RouteContextValue,
) {
  const resolved = await actorAndOrderId(context);
  if ("response" in resolved) return resolved.response;
  try {
    return Response.json({ sync: await retryIntegrationSync(resolved.actor, resolved.orderId) });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to retry sync.");
  }
}
