import { getCurrentUserAndCompany } from "@/lib/auth";
import { planActive, getEffectivePlans } from "@/lib/plan";
import PricingClient from "./PricingClient";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const active = planActive(ctx.company.plan, ctx.company.planExpiry);
  const plans = await getEffectivePlans();

  // Make plans serializable (Infinity → null for "unlimited")
  const serialPlans = Object.fromEntries(
    Object.entries(plans).map(([k, p]) => [
      k,
      {
        id: p.id,
        name: p.name,
        tagline: p.tagline,
        priceMonthlyPaise: p.priceMonthlyPaise,
        priceAnnualPaise: p.priceAnnualPaise,
        invoiceLimit: p.invoiceLimit === Infinity ? null : p.invoiceLimit,
        userLimit: p.userLimit,
        features: p.features,
        highlight: p.highlight ?? false,
      },
    ])
  );

  return (
    <PricingClient
      currentPlan={active}
      planExpiry={ctx.company.planExpiry ? ctx.company.planExpiry.toISOString() : null}
      plans={serialPlans as any}
    />
  );
}
