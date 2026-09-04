import { createHash } from "node:crypto";
import { parseCommerceOrderPaidEvent } from "@/lib/integrations/contracts";
import { verifyIntegrationRequest } from "@/lib/server/integration-auth";
import { importCommerceOrder } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    }
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 2_000_000) {
      return Response.json({ error: "Request body is too large." }, { status: 413 });
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 2_000_000) {
      return Response.json({ error: "Request body is too large." }, { status: 413 });
    }
    const headers = verifyIntegrationRequest(request, rawBody);
    const event = parseCommerceOrderPaidEvent(JSON.parse(rawBody));
    if (
      headers.eventId !== event.eventId ||
      headers.correlationId !== event.correlationId ||
      event.aggregateId !== event.payload.externalOrderId
    ) {
      return Response.json({ error: "Event headers and payload do not match." }, { status: 400 });
    }
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const result = await importCommerceOrder(event, payloadHash);
    return Response.json(
      {
        accepted: true,
        duplicate: result.duplicate,
        deskOrderId: result.order.id,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import order.";
    const authenticationFailure =
      message.includes("signature") ||
      message.includes("timestamp") ||
      message.includes("headers") ||
      message.includes("identity") ||
      message.includes("DF_INTEGRATION_SECRET");
    const conflict = message.includes("already") || message.includes("previously imported");
    return Response.json(
      { error: authenticationFailure ? "Integration authentication failed." : message },
      { status: authenticationFailure ? 401 : conflict ? 409 : 400 },
    );
  }
}
