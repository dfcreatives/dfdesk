import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { env } from "../../config/env.js";
import { unauthorized } from "../../shared/errors/app-error.js";
import { INTEGRATION_CLIENT_ID } from "./contracts.js";

const MAX_CLOCK_SKEW_SECONDS = 300;
export function signIntegrationBody(timestamp: string, body: string) {
  return signBodyWithSecret(timestamp, body, env().DF_INTEGRATION_SECRET);
}
function signBodyWithSecret(timestamp: string, body: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}
export function deriveConnectionSecret(clientKey: string) {
  return createHmac("sha256", env().DF_INTEGRATION_SECRET)
    .update(`desk-integration-connection:${clientKey}`)
    .digest("hex");
}

function verifySignedRequest(
  request: Request,
  body: string,
  expectedClientId: string,
  secret: string,
) {
  const clientId = request.header("x-df-client");
  const timestamp = request.header("x-df-timestamp");
  const signature = request.header("x-df-signature")?.replace(/^sha256=/, "");
  const eventId = request.header("x-df-event-id");
  const correlationId = request.header("x-correlation-id");
  const idempotencyKey = request.header("idempotency-key");
  if (!timestamp || !signature || !eventId || !correlationId || !idempotencyKey)
    throw unauthorized("Integration authentication failed.");
  if (clientId !== expectedClientId || eventId !== idempotencyKey)
    throw unauthorized("Integration authentication failed.");
  const seconds = Number(timestamp);
  if (
    !Number.isInteger(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > MAX_CLOCK_SKEW_SECONDS
  )
    throw unauthorized("Integration authentication failed.");
  const expected = Buffer.from(signBodyWithSecret(timestamp, body, secret), "hex");
  const supplied = Buffer.from(signature, "hex");
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    throw unauthorized("Integration authentication failed.");
  return { clientId, eventId, correlationId };
}

export function verifyIntegrationRequest(request: Request, body: string) {
  return verifySignedRequest(
    request,
    body,
    INTEGRATION_CLIENT_ID,
    env().DF_INTEGRATION_SECRET,
  );
}

export function verifyConnectionIntegrationRequest(
  request: Request,
  body: string,
  clientKey: string,
) {
  return verifySignedRequest(
    request,
    body,
    clientKey,
    deriveConnectionSecret(clientKey),
  );
}

export function verifyConnectionReadRequest(request: Request, clientKey: string) {
  const suppliedClient = request.header("x-df-client");
  const timestamp = request.header("x-df-timestamp");
  const signature = request.header("x-df-signature")?.replace(/^sha256=/, "");
  if (suppliedClient !== clientKey || !timestamp || !signature)
    throw unauthorized("Integration authentication failed.");
  const seconds = Number(timestamp);
  if (
    !Number.isInteger(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > MAX_CLOCK_SKEW_SECONDS
  )
    throw unauthorized("Integration authentication failed.");
  const secret =
    clientKey === INTEGRATION_CLIENT_ID
      ? env().DF_INTEGRATION_SECRET
      : deriveConnectionSecret(clientKey);
  const expected = Buffer.from(signBodyWithSecret(timestamp, "", secret), "hex");
  const supplied = Buffer.from(signature, "hex");
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    throw unauthorized("Integration authentication failed.");
}
