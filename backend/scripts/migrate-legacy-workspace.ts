import { Pool } from "pg";
import { prisma } from "../src/lib/prisma.js";
import {
  checksum,
  migrateNormalized,
  normalizeLegacy,
  type LegacyInboxEvent,
} from "./migration-shared.js";

function assertTarget(urlValue: string) {
  const url = new URL(urlValue);
  const host = process.env.MIGRATION_TARGET_HOST;
  const database = process.env.MIGRATION_TARGET_DATABASE;
  if (!host || !database)
    throw new Error(
      "Set MIGRATION_TARGET_HOST and MIGRATION_TARGET_DATABASE to the reviewed production target.",
    );
  if (url.hostname !== host || url.pathname.slice(1) !== database)
    throw new Error(
      `Database target ${url.hostname}/${url.pathname.slice(1)} does not match the explicitly approved target.`,
    );
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
assertTarget(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const state = await client.query<{
      data: Record<string, unknown>;
      revision: string;
    }>(
      "SELECT data, revision FROM public.fieldflow_state WHERE id = 1 FOR SHARE",
    );
    if (!state.rows[0])
      throw new Error("public.fieldflow_state row 1 was not found.");
    const pending = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM public.fieldflow_integration_outbox WHERE status <> 'DELIVERED'",
    );
    const inbox = await client.query<LegacyInboxEvent>(
      "SELECT event_id, client_id, event_type, aggregate_id, payload_hash, payload, received_at, processed_at FROM public.fieldflow_integration_inbox ORDER BY received_at",
    );
    const unresolved = Number(pending.rows[0]?.count ?? 0);
    const source = state.rows[0];
    const normalized = normalizeLegacy(source.data);
    const report = {
      revision: source.revision,
      checksum: checksum(source.data),
      counts: {
        employees: normalized.employees.length,
        staff: normalized.staff.length,
        tasks: normalized.tasks.length,
        orders: normalized.orders.length,
        payments: normalized.payments.length,
      },
      unresolvedOutboundEvents: unresolved,
      integrationEvents: inbox.rowCount ?? 0,
    };
    if (process.argv.includes("--dry-run"))
      console.log(JSON.stringify(report, null, 2));
    else {
      if (unresolved)
        throw new Error(
          `${unresolved} unresolved legacy outbound event(s) remain. Deliver or explicitly reconcile them before migration.`,
        );
      console.log(
        JSON.stringify(
          {
            ...report,
            result: await migrateNormalized(
              source.data,
              BigInt(source.revision),
              report.checksum,
              inbox.rows,
            ),
          },
          null,
          2,
        ),
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
  await prisma.$disconnect();
}
