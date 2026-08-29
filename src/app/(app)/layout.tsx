import { redirect } from "next/navigation";
import { getCurrentUserAndCompany, getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { db } from "@/lib/db";
import { planActive, invoiceLimitFor, getPlan } from "@/lib/plan";
import { getFeatureFlags } from "@/lib/settings";
import { normaliseLocale } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx) redirect("/login");
  const { user, company } = ctx;
  const session = await getSession();

  // Resolved server-side so there is no flash of English before the user's
  // language loads, and no client round-trip to discover it.
  const locale = normaliseLocale(user.locale);

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
  const flags = await getFeatureFlags();

  return (
    <LocaleProvider locale={locale}>
      <AppShell
        userName={user.name}
        companyName={company?.name ?? "My Company"}
        planName={getPlan(activePlan).name}
        planId={activePlan}
        invoiceUsed={invoiceUsed}
        invoiceLimit={limit === Infinity ? null : limit}
        isSuperAdmin={user.isSuperAdmin}
        flags={flags}
        impersonating={!!session?.impersonatorId}
        locale={locale}
      >
        {children}
      </AppShell>
    </LocaleProvider>
  );
}
