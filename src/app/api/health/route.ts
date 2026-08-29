import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Health check for container orchestrators, uptime monitors and load balancers.
 *
 * Deliberately unauthenticated (probes cannot log in) but it never leaks
 * anything sensitive: no version strings, no connection details, no env values.
 * It verifies the database is genuinely reachable rather than only confirming
 * the Node process is alive, because a running app with a dead database is the
 * failure mode worth catching.
 *
 *   200 -> {"status":"ok","database":"connected"}
 *   503 -> {"status":"degraded","database":"unreachable"}
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        status: "ok",
        database: "connected",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    // The underlying error is intentionally not echoed back: it can contain the
    // database host and credentials. It is logged server-side instead.
    console.error("[health] database unreachable");
    return NextResponse.json(
      {
        status: "degraded",
        database: "unreachable",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
