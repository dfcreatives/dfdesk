import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { INTEGRATION_CLIENT_ID } from "@/lib/integrations/contracts";

const MAX_CLOCK_SKEW_SECONDS = 300;

function integrationSecret() {
  const secret = process.env.DF_INTEGRATION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("DF_INTEGRATION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

export function signIntegrationBody(timestamp: string, body: string) {
  return createHmac("sha256", integrationSecret())
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function verifyIntegrationRequest(request: Request, body: string) {
  const clientId = request.headers.get("x-df-client");
  const timestamp = request.headers.get("x-df-timestamp");
  const signatureHeader = request.headers.get("x-df-signature");
  const eventId = request.headers.get("x-df-event-id");
  const correlationId = request.headers.get("x-correlation-id");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!timestamp || !signatureHeader || !eventId || !correlationId || !idempotencyKey) {
    throw new Error("Required integration headers are missing.");
  }
  if (clientId !== INTEGRATION_CLIENT_ID || eventId !== idempotencyKey) {
    throw new Error("Integration identity is invalid.");
  }
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > MAX_CLOCK_SKEW_SECONDS) {
    throw new Error("Integration timestamp is stale or invalid.");
  }
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;
  const expected = signIntegrationBody(timestamp, body);
  const providedBuffer = Buffer.from(provided, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error("Integration signature is invalid.");
  }
  return { eventId, correlationId, clientId };
}
