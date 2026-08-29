import { Paise, toPaise } from "./money";

export type PlanId = "FREE" | "BASIC" | "PREMIUM";

export type Feature =
  | "unlimited_invoices"
  | "gst_reports"
  | "whatsapp_share"
  | "multi_user"
  | "bank_reconciliation"
  | "recurring_invoices"
  | "audit_trail"
  | "e_invoice"
  | "eway_bill"
  | "tds_tcs"
  | "budgets"
  | "godowns";

export type PlanConfig = {
  id: PlanId;
  name: string;
  /**
   * Monthly price in integer PAISE.
   *
   * This was `price: number // monthly in INR`, while `getEffectivePlans()`
   * overwrote it with `PlanSetting.priceMonthlyPaise` from the database. Every
   * consumer then rendered it with `formatPaise()`. So the figure was correct
   * only once PlanSetting rows existed: a fresh install, which falls back to the
   * defaults below, advertised the Basic plan at Rs 2.99 and Premium at Rs 9.99.
   * Named for its unit now, so the two sources cannot disagree again.
   */
  priceMonthlyPaise: Paise;
  /** Annual price in integer paise. */
  priceAnnualPaise: Paise;
  tagline: string;
  invoiceLimit: number; // per month; Infinity for unlimited
  userLimit: number;
  features: Feature[];
  highlight?: boolean;
};

export const PLANS: Record<PlanId, PlanConfig> = {
  FREE: {
    id: "FREE",
    name: "Free",
    priceMonthlyPaise: 0,
    priceAnnualPaise: 0,
    tagline: "For freelancers & new businesses",
    invoiceLimit: 20,
    userLimit: 1,
    features: ["gst_reports", "whatsapp_share"],
  },
  BASIC: {
    id: "BASIC",
    name: "Basic",
    priceMonthlyPaise: toPaise(299),
    priceAnnualPaise: toPaise(2990),
    tagline: "For growing small businesses",
    invoiceLimit: Infinity,
    userLimit: 3,
    features: [
      "unlimited_invoices",
      "gst_reports",
      "whatsapp_share",
      "godowns",
      "budgets",
      "tds_tcs",
    ],
    highlight: true,
  },
  PREMIUM: {
    id: "PREMIUM",
    name: "Premium",
    priceMonthlyPaise: toPaise(999),
    priceAnnualPaise: toPaise(9990),
    tagline: "Full Tally/Busy replacement",
    invoiceLimit: Infinity,
    userLimit: 25,
    features: [
      "unlimited_invoices",
      "gst_reports",
      "whatsapp_share",
      "godowns",
      "budgets",
      "tds_tcs",
      "multi_user",
      "bank_reconciliation",
      "recurring_invoices",
      "audit_trail",
      "e_invoice",
      "eway_bill",
    ],
  },
};

export const FEATURE_LABELS: Record<Feature, string> = {
  unlimited_invoices: "Unlimited invoices",
  gst_reports: "GST reports (GSTR-1, HSN)",
  whatsapp_share: "WhatsApp & email share",
  multi_user: "Multi-user team access",
  bank_reconciliation: "Bank reconciliation",
  recurring_invoices: "Recurring invoices",
  audit_trail: "Audit trail",
  e_invoice: "E-Invoice (IRN + QR)",
  eway_bill: "E-Way Bill generation",
  tds_tcs: "TDS / TCS support",
  budgets: "Budgets & variance",
  godowns: "Godowns & stock transfer",
};

export function getPlan(planId?: string | null): PlanConfig {
  const id = (planId as PlanId) || "FREE";
  return PLANS[id] ?? PLANS.FREE;
}

export function planActive(plan?: string | null, expiry?: Date | string | null): PlanId {
  const id = (plan as PlanId) || "FREE";
  if (id === "FREE") return "FREE";
  if (expiry && new Date(expiry).getTime() < Date.now()) return "FREE"; // expired -> downgrade
  return id;
}

export function hasFeature(planId: string | null | undefined, feature: Feature): boolean {
  return getPlan(planId).features.includes(feature);
}

export function invoiceLimitFor(planId: string | null | undefined): number {
  return getPlan(planId).invoiceLimit;
}


import { db } from "./db";

/**
 * Merge DB PlanSetting overrides on top of the hardcoded PLANS defaults.
 * Lets the SaaS owner edit prices/limits from the admin dashboard.
 */
export async function getEffectivePlans(): Promise<Record<PlanId, PlanConfig>> {
  const defaults: Record<PlanId, PlanConfig> = {
    FREE: { ...PLANS.FREE },
    BASIC: { ...PLANS.BASIC },
    PREMIUM: { ...PLANS.PREMIUM },
  };
  try {
    const rows = await db.planSetting.findMany();
    for (const r of rows) {
      const id = r.id as PlanId;
      if (!defaults[id]) continue;
      defaults[id] = {
        ...defaults[id],
        name: r.name ?? defaults[id].name,
        tagline: r.tagline ?? defaults[id].tagline,
        // Both columns are already paise, matching the field names.
        priceMonthlyPaise: r.priceMonthlyPaise,
        priceAnnualPaise: r.priceAnnualPaise,
        invoiceLimit: r.invoiceLimit < 0 ? Infinity : r.invoiceLimit,
        userLimit: r.userLimit,
      };
    }
  } catch {
    // table may not exist yet (pre-migration) — fall back to defaults
  }
  return defaults;
}
