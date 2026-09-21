import { Pool } from "pg";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getWorkspace } from "../src/modules/legacy-workspace/legacy-workspace.service.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const workspace = await prisma.workspace.findUniqueOrThrow({
  where: { slug: "desk" },
});
const admin = await prisma.user.findFirstOrThrow({
  where: { workspaceId: workspace.id, role: UserRole.ADMIN, archivedAt: null },
});
const data = await getWorkspace({
  id: admin.id,
  workspaceId: workspace.id,
  name: admin.loginName,
  role: admin.role,
});
if (!process.argv.includes("--write"))
  console.log(JSON.stringify(data, null, 2));
else {
  if (process.env.ALLOW_LEGACY_EXPORT !== "true")
    throw new Error(
      "Set ALLOW_LEGACY_EXPORT=true after reviewing the backup and export target.",
    );
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query(
      "UPDATE public.fieldflow_state SET data = $1::jsonb, revision = revision + 1, updated_at = NOW() WHERE id = 1",
      [JSON.stringify(data)],
    );
  } finally {
    await pool.end();
  }
  console.log("Legacy workspace export completed.");
}
await prisma.$disconnect();
