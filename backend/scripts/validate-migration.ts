import { Pool } from "pg";
import { prisma } from "../src/lib/prisma.js";
import { checksum, normalizeLegacy } from "./migration-shared.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  const result = await pool.query<{
    data: Record<string, unknown>;
    revision: string;
  }>("SELECT data, revision FROM public.fieldflow_state WHERE id = 1");
  const row = result.rows[0];
  if (!row) throw new Error("Legacy workspace was not found.");
  const legacy = normalizeLegacy(row.data);
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "desk" },
  });
  const [users, attendance, tasks, orders, payments] = await Promise.all([
    prisma.user.count({
      where: { workspaceId: workspace.id, archivedAt: null },
    }),
    prisma.attendanceSession.count({
      where: { user: { workspaceId: workspace.id } },
    }),
    prisma.task.count({
      where: { workspaceId: workspace.id, archivedAt: null },
    }),
    prisma.order.count({
      where: { workspaceId: workspace.id, archivedAt: null },
    }),
    prisma.payment.count({ where: { workspaceId: workspace.id } }),
  ]);
  const expected = {
    users: legacy.employees.length + legacy.staff.length,
    attendance: legacy.employees.reduce(
      (sum, user) => sum + (user.attendanceRecords?.length ?? 0),
      0,
    ),
    tasks: legacy.tasks.length,
    orders: legacy.orders.length,
    payments: legacy.payments.length,
  };
  const actual = { users, attendance, tasks, orders, payments };
  const mismatches = Object.keys(expected).filter(
    (key) =>
      expected[key as keyof typeof expected] !==
      actual[key as keyof typeof actual],
  );
  const run = await prisma.migrationRun.findUnique({
    where: {
      sourceRevision_sourceChecksum: {
        sourceRevision: BigInt(row.revision),
        sourceChecksum: checksum(row.data),
      },
    },
  });
  console.log(
    JSON.stringify(
      {
        valid: !mismatches.length && Boolean(run),
        sourceRevision: row.revision,
        expected,
        actual,
        mismatches,
        migrationRecorded: Boolean(run),
      },
      null,
      2,
    ),
  );
  if (mismatches.length || !run) process.exitCode = 1;
} finally {
  await pool.end();
  await prisma.$disconnect();
}
