import "server-only";

import { Pool, type PoolClient } from "pg";

type GlobalWithDatabase = typeof globalThis & {
  fieldflowPostgresPool?: Pool;
  fieldflowPostgresSchema?: Promise<void>;
};

const globalWithDatabase = globalThis as GlobalWithDatabase;

function databaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "DATABASE_URL is not configured. Add the Railway PostgreSQL connection URL to the service variables.",
    );
  }
  return value;
}

function getPool() {
  if (!globalWithDatabase.fieldflowPostgresPool) {
    globalWithDatabase.fieldflowPostgresPool = new Pool({
      connectionString: databaseUrl(),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalWithDatabase.fieldflowPostgresPool;
}

export async function ensureDatabase() {
  if (!globalWithDatabase.fieldflowPostgresSchema) {
    globalWithDatabase.fieldflowPostgresSchema = (async () => {
      const pool = getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS fieldflow_state (
          id SMALLINT PRIMARY KEY CHECK (id = 1),
          data JSONB NOT NULL,
          revision BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS fieldflow_integration_inbox (
          event_id TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          aggregate_id TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          payload JSONB NOT NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          processed_at TIMESTAMPTZ
        )
      `);
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
    })().catch((error) => {
      globalWithDatabase.fieldflowPostgresSchema = undefined;
      throw error;
    });
  }
  await globalWithDatabase.fieldflowPostgresSchema;
}

export async function queryDatabase<T>(
  operation: (client: PoolClient) => Promise<T>,
) {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    return await operation(client);
  } finally {
    client.release();
  }
}

export async function checkDatabaseConnection() {
  await ensureDatabase();
  await getPool().query("SELECT 1");
}
