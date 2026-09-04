import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import pg from "pg";

loadEnvConfig(process.cwd());

const sourceFile = path.resolve(
  process.cwd(),
  process.argv[2] ?? ".data/fieldflow.json",
);
const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured in the environment or .env.local.");
}

const raw = await readFile(sourceFile, "utf8");
const database = JSON.parse(raw);
const collections = ["employees", "staff", "tasks", "orders", "payments", "sessions"];

if (!collections.every((key) => Array.isArray(database[key]))) {
  throw new Error("The source file is not a valid Desk/FieldFlow database.");
}

const pool = new pg.Pool({ connectionString, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS fieldflow_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      data JSONB NOT NULL,
      revision BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const currentResult = await client.query(
    "SELECT data FROM fieldflow_state WHERE id = 1 FOR UPDATE",
  );
  const current = currentResult.rows[0]?.data;
  const hasExistingData =
    current &&
    ["employees", "staff", "tasks", "orders", "payments"].some(
      (key) => Array.isArray(current[key]) && current[key].length > 0,
    );

  if (hasExistingData) {
    throw new Error(
      "The PostgreSQL workspace already contains data; migration was cancelled to avoid overwriting it.",
    );
  }

  const revision = Number.isFinite(Number(database.revision))
    ? Number(database.revision)
    : 0;
  await client.query(
    `INSERT INTO fieldflow_state (id, data, revision, updated_at)
     VALUES (1, $1::jsonb, $2, NOW())
     ON CONFLICT (id) DO UPDATE
       SET data = EXCLUDED.data,
           revision = EXCLUDED.revision,
           updated_at = NOW()`,
    [JSON.stringify({ ...database, revision }), revision],
  );
  await client.query("COMMIT");
  console.log(`Migrated ${sourceFile} to PostgreSQL successfully.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
