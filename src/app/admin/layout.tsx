import { redirect } from "next/navigation";
import { getSuperAdmin } from "@/lib/auth";
import AdminShell from "@/components/AdminShell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getSuperAdmin();
  if (!admin) redirect("/dashboard");
  return <AdminShell adminName={admin.name}>{children}</AdminShell>;
}
