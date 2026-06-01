import { redirect } from "next/navigation";
import { getCurrentUserAndCompany } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { db } from "@/lib/db";
import { planActive, invoiceLimitFor, getPlan } from "@/lib/plan";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx) redirect("/login");
  const { user, company } = ctx;

  // Plan + monthly invoice usage for the topbar meter
  const activePlan = company ? planActive(company.plan, company.planExpiry) : "FREE";
  let invoiceUsed = 0;
  if (company) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    invoiceUsed = await db.invoice.count({
      where: { companyId: company.id, date: { gte: monthStart } },
    });
  }
  const limit = invoiceLimitFor(activePlan);

  return (
    <AppShell
      userName={user.name}
      companyName={company?.name ?? "My Company"}
      planName={getPlan(activePlan).name}
      planId={activePlan}
      invoiceUsed={invoiceUsed}
      invoiceLimit={limit === Infinity ? null : limit}
      isSuperAdmin={user.isSuperAdmin}
    >
      {children}
    </AppShell>
  );
}
