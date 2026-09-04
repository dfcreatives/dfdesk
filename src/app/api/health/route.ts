import { checkDatabaseConnection } from "@/lib/server/database";

export const runtime = "nodejs";

export async function GET() {
  try {
    await checkDatabaseConnection();
    return Response.json({ status: "ok", database: "connected" });
  } catch {
    return Response.json(
      { status: "error", database: "unavailable" },
      { status: 503 },
    );
  }
}
