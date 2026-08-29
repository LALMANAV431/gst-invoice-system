import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { getAiStatus } from "@/server/ai/service";

/**
 * Per-tenant AI usage for the current month.
 *
 * Exposed to the tenant, not just the platform operator: if AI credits are a
 * billable add-on, the customer is entitled to see what they have consumed.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = ctx.company.id;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [status, byFeature, totals] = await Promise.all([
    getAiStatus(companyId),
    db.aiUsageLog.groupBy({
      by: ["feature"],
      where: { companyId, createdAt: { gte: monthStart } },
      _sum: { inputTokens: true, outputTokens: true },
      _count: true,
    }),
    db.aiUsageLog.aggregate({
      where: { companyId, createdAt: { gte: monthStart } },
      _count: true,
    }),
  ]);

  const cacheHits = await db.aiUsageLog.count({
    where: { companyId, createdAt: { gte: monthStart }, cacheHit: true },
  });

  return NextResponse.json({
    ...status,
    periodStart: monthStart.toISOString(),
    totalCalls: totals._count,
    cacheHits,
    // Useful signal: a high ratio means the cache is doing its job and cost is
    // lower than call volume suggests.
    cacheHitRate: totals._count > 0 ? Math.round((cacheHits / totals._count) * 100) : 0,
    byFeature: byFeature.map((f) => ({
      feature: f.feature,
      calls: f._count,
      inputTokens: f._sum.inputTokens ?? 0,
      outputTokens: f._sum.outputTokens ?? 0,
    })),
  });
}
