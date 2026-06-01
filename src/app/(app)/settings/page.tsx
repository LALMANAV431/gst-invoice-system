import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import SettingsForm from "./SettingsForm";

export default async function SettingsPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Company settings</h1>
      <p className="text-sm text-slate-500 mb-4">
        These details appear on your invoices and reports.
      </p>
      <SettingsForm initial={JSON.parse(JSON.stringify(ctx.company))} />
    </div>
  );
}
