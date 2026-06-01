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
  price: number; // monthly in INR
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
    price: 0,
    tagline: "For freelancers & new businesses",
    invoiceLimit: 20,
    userLimit: 1,
    features: ["gst_reports", "whatsapp_share"],
  },
  BASIC: {
    id: "BASIC",
    name: "Basic",
    price: 299,
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
    price: 999,
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
