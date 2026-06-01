import { redirect } from "next/navigation";
import { getCurrentUserAndCompany } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx) redirect("/login");
  const { user, company } = ctx;

  return (
    <AppShell userName={user.name} companyName={company?.name ?? "My Company"}>
      {children}
    </AppShell>
  );
}
