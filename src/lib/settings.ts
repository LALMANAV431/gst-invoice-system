import { db } from "./db";

export type SiteSettings = Record<string, string>;

/** Reads all site settings into a key→value map (safe defaults if missing). */
export async function getSiteSettings(): Promise<SiteSettings> {
  const defaults: SiteSettings = {
    site_name: "GST Books",
    support_phone: "",
    support_email: "",
    whatsapp_number: "",
    address: "",
    announcement: "",
    announcement_active: "false",
    facebook_url: "",
    instagram_url: "",
    twitter_url: "",
  };
  try {
    const rows = await db.siteSetting.findMany();
    for (const r of rows) defaults[r.key] = r.value ?? "";
  } catch {
    // table not migrated yet
  }
  return defaults;
}


// Feature flags — keys stored in SiteSetting as flag_<name> = "true"|"false".
// Default is enabled (true) when the key is absent.
export const FEATURE_FLAGS: { key: string; label: string; href: string }[] = [
  { key: "flag_pos", label: "POS Billing", href: "/pos" },
  { key: "flag_quotations", label: "Quotations", href: "/quotations" },
  { key: "flag_credit_notes", label: "Credit/Debit Notes", href: "/credit-notes" },
  { key: "flag_expenses", label: "Expenses", href: "/expenses" },
  { key: "flag_godowns", label: "Godowns", href: "/godowns" },
  { key: "flag_bank", label: "Bank Reconciliation", href: "/bank-reconciliation" },
  { key: "flag_budgets", label: "Budgets", href: "/budgets" },
];

export async function getFeatureFlags(): Promise<Record<string, boolean>> {
  const flags: Record<string, boolean> = {};
  for (const f of FEATURE_FLAGS) flags[f.key] = true; // default ON
  try {
    const rows = await db.siteSetting.findMany({
      where: { key: { startsWith: "flag_" } },
    });
    for (const r of rows) flags[r.key] = r.value !== "false";
  } catch {
    // ignore
  }
  return flags;
}
