import { createHmac } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import pg from "pg";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim();
const framesUrl = process.env.FRAMES41_API_URL?.trim().replace(/\/$/, "");
const secret = process.env.DF_INTEGRATION_SECRET?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!framesUrl) throw new Error("FRAMES41_API_URL is required.");
if (!secret || secret.length < 32) {
  throw new Error("DF_INTEGRATION_SECRET must contain at least 32 characters.");
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
const workerId = `desk-worker-${process.pid}-${Date.now()}`;
let stopping = false;

async function ensureOutboxSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fieldflow_integration_outbox (
      event_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'DELIVERED', 'FAILED')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 10,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_at TIMESTAMPTZ,
      locked_by TEXT,
      last_error TEXT,
      delivered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS fieldflow_outbox_ready_idx
    ON fieldflow_integration_outbox (status, next_attempt_at)
  `);
}

async function claimEvent() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE fieldflow_integration_outbox
       SET status = 'PENDING', locked_at = NULL, locked_by = NULL, updated_at = NOW()
       WHERE status = 'RUNNING' AND locked_at < NOW() - INTERVAL '5 minutes'`,
    );
    const result = await client.query(
      `SELECT event_id, payload, attempts, max_attempts
       FROM fieldflow_integration_outbox
       WHERE status = 'PENDING' AND next_attempt_at <= NOW() AND attempts < max_attempts
       ORDER BY next_attempt_at, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    await client.query(
      `UPDATE fieldflow_integration_outbox
       SET status = 'RUNNING', attempts = attempts + 1, locked_at = NOW(),
           locked_by = $2, updated_at = NOW()
       WHERE event_id = $1`,
      [row.event_id, workerId],
    );
    await client.query("COMMIT");
    return { ...row, attempts: row.attempts + 1 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function signedHeaders(event, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-df-client": "frames41",
    "x-df-timestamp": timestamp,
    "x-df-signature": `sha256=${signature}`,
    "x-df-event-id": event.eventId,
    "x-correlation-id": event.correlationId,
    "idempotency-key": event.eventId,
  };
}

async function markDelivered(eventId) {
  await pool.query(
    `UPDATE fieldflow_integration_outbox
     SET status = 'DELIVERED', delivered_at = NOW(), locked_at = NULL,
         locked_by = NULL, last_error = NULL, updated_at = NOW()
     WHERE event_id = $1`,
    [eventId],
  );
}

async function markFailed(event, error, permanent) {
  const exhausted = event.attempts >= event.max_attempts;
  const delaySeconds = Math.min(900, 2 ** event.attempts) + Math.random();
  await pool.query(
    `UPDATE fieldflow_integration_outbox
     SET status = $2, next_attempt_at = NOW() + ($3 * INTERVAL '1 second'),
         locked_at = NULL, locked_by = NULL, last_error = $4, updated_at = NOW()
     WHERE event_id = $1`,
    [
      event.event_id,
      permanent || exhausted ? "FAILED" : "PENDING",
      delaySeconds,
      String(error).slice(0, 2_000),
    ],
  );
}

async function deliver(event) {
  const payload = event.payload;
  const body = JSON.stringify(payload);
  try {
    const response = await fetch(`${framesUrl}/api/v1/integrations/desk/order-status`, {
      method: "POST",
      headers: signedHeaders(payload, body),
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      await markDelivered(event.event_id);
      return;
    }
    const detail = (await response.text()).slice(0, 1_500);
    await markFailed(event, `HTTP ${response.status}: ${detail}`, response.status < 500 && response.status !== 408 && response.status !== 429);
  } catch (error) {
    await markFailed(event, error instanceof Error ? error.message : error, false);
  }
}

async function poll() {
  try {
    const event = await claimEvent();
    if (event) await deliver(event);
  } catch (error) {
    console.error("Desk integration worker error:", error);
  }
}

async function shutdown() {
  stopping = true;
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await ensureOutboxSchema();
console.log(`Desk integration worker started as ${workerId}.`);
while (!stopping) {
  await poll();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
