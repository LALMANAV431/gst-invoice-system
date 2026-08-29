import { NextResponse } from "next/server";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { getAiStatus } from "@/server/ai/service";

/**
 * Whether AI is available, and how much budget is left.
 *
 * The UI calls this to decide whether to show AI controls at all. It returns 200
 * with `available: false` rather than an error, so "AI is off" is a normal state
 * the client renders, not an exception it has to handle.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = await getAiStatus(ctx.company.id);
  return NextResponse.json(status);
}
