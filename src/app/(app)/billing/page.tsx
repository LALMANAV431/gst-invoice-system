import { getCurrentUserAndCompany } from "@/lib/auth";
import { planActive } from "@/lib/plan";
import PricingClient from "./PricingClient";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const active = planActive(ctx.company.plan, ctx.company.planExpiry);
  return (
    <PricingClient
      currentPlan={active}
      planExpiry={ctx.company.planExpiry ? ctx.company.planExpiry.toISOString() : null}
    />
  );
}
