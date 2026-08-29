"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { motion } from "framer-motion";
import { Check, Sparkles, Loader2, Crown, Ticket } from "lucide-react";
import { FEATURE_LABELS, type PlanId, type Feature } from "@/lib/plan";
import { formatPaise } from "@/lib/utils";

type SerialPlan = {
  id: PlanId;
  name: string;
  tagline?: string | null;
  price: number;
  priceAnnualPaise: number;
  invoiceLimit: number | null; // null = unlimited
  userLimit: number;
  features: Feature[];
  highlight?: boolean;
};

const ORDER: PlanId[] = ["FREE", "BASIC", "PREMIUM"];
const ALL_FEATURES: Feature[] = [
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
];

const EASE = [0.22, 1, 0.36, 1] as const;

export default function PricingClient({
  currentPlan,
  planExpiry,
  plans,
}: {
  currentPlan: PlanId;
  planExpiry: string | null;
  plans: Record<PlanId, SerialPlan>;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<PlanId | null>(null);
  const [coupon, setCoupon] = useState("");
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [applied, setApplied] = useState<{ code: string; discount: number; finalPrice: number; plan: PlanId } | null>(null);

  async function validateCoupon(planId: PlanId, price: number) {
    if (!coupon.trim()) return toast.error("Enter a coupon code");
    const res = await fetch("/api/coupons/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: coupon, plan: planId, price }),
    });
    const j = await res.json();
    if (res.ok) {
      setApplied({ code: j.code, discount: j.discountPaise, finalPrice: j.finalPrice, plan: planId });
      toast.success(`Coupon applied: ${formatPaise(j.discountPaise)} off → ${formatPaise(j.finalPrice)}`);
    } else {
      setApplied(null);
      toast.error(j.error || "Invalid coupon");
    }
  }

  async function choose(planId: PlanId) {
    if (planId === currentPlan) return;
    setLoading(planId);
    const res = await fetch("/api/company/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: planId,
        coupon: applied && applied.plan === planId ? applied.code : undefined,
      }),
    });
    setLoading(null);
    if (res.ok) {
      const j = await res.json();
      toast.success(
        planId === "FREE"
          ? "Switched to Free plan"
          : `${plans[planId].name} plan activated!${j.appliedCoupon ? ` (coupon ${j.appliedCoupon})` : ""} 🎉`
      );
      setApplied(null);
      setCoupon("");
      router.refresh();
    } else {
      toast.error("Failed to change plan");
    }
  }

  function priceFor(p: SerialPlan) {
    return billing === "annual" ? p.priceAnnualPaise : p.price;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Crown className="h-6 w-6 text-amber-500" /> Plans & Billing
          </h1>
          <p className="text-sm text-slate-500">
            You are on the <strong>{plans[currentPlan].name}</strong> plan
            {planExpiry && currentPlan !== "FREE"
              ? ` · renews ${new Date(planExpiry).toLocaleDateString("en-IN")}`
              : ""}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full text-xs font-semibold ring-1 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300">
          <Sparkles className="h-3.5 w-3.5" /> Demo: upgrades activate instantly (no real payment)
        </span>
      </div>

      {/* Billing cycle toggle + coupon */}
      <div className="card card-padding flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
          {(["monthly", "annual"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBilling(b)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                billing === b ? "bg-white dark:bg-slate-700 shadow text-brand-700 dark:text-white" : "text-slate-500"
              }`}
            >
              {b === "monthly" ? "Monthly" : "Annual (2 months free)"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9 w-44"
              placeholder="Coupon code"
              value={coupon}
              onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            />
          </div>
          <span className="text-xs text-slate-400">Apply on a paid plan below</span>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        {ORDER.map((id, i) => {
          const plan = plans[id];
          const isCurrent = id === currentPlan;
          const price = priceFor(plan);
          const showDiscount = applied && applied.plan === id;
          return (
            <motion.div
              key={id}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE, delay: i * 0.1 }}
              className={`card card-padding relative flex flex-col ${
                plan.highlight ? "ring-2 ring-brand-500 shadow-xl" : ""
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  Most Popular
                </span>
              )}
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-bold">{plan.name}</h2>
                {isCurrent && <span className="badge-green">Current</span>}
              </div>
              <p className="text-xs text-slate-500 mt-1">{plan.tagline}</p>
              <div className="mt-4">
                {showDiscount ? (
                  <>
                    <span className="text-3xl font-bold">{formatPaise(applied!.finalPrice)}</span>
                    <span className="text-sm text-slate-400 line-through ml-2">{formatPaise(price)}</span>
                  </>
                ) : (
                  <span className="text-3xl font-bold">{price === 0 ? "Free" : formatPaise(price)}</span>
                )}
                {price > 0 && <span className="text-sm text-slate-500">/{billing === "annual" ? "year" : "month"}</span>}
              </div>

              <div className="mt-3 text-sm text-slate-600 dark:text-slate-400">
                <div>{plan.invoiceLimit === null ? "Unlimited invoices" : `${plan.invoiceLimit} invoices / month`}</div>
                <div>{plan.userLimit === 1 ? "1 user" : `Up to ${plan.userLimit} users`}</div>
              </div>

              <ul className="mt-4 space-y-2 text-sm flex-1">
                {ALL_FEATURES.map((f) => {
                  const has = plan.features.includes(f);
                  return (
                    <li key={f} className={`flex items-center gap-2 ${has ? "text-slate-700 dark:text-slate-300" : "text-slate-300 dark:text-slate-600 line-through"}`}>
                      <Check className={`h-4 w-4 shrink-0 ${has ? "text-emerald-500" : "text-slate-200 dark:text-slate-700"}`} />
                      {FEATURE_LABELS[f]}
                    </li>
                  );
                })}
              </ul>

              {id !== "FREE" && !isCurrent && (
                <button
                  onClick={() => validateCoupon(id, price)}
                  className="mt-4 text-xs font-semibold text-brand-600 hover:underline"
                >
                  Apply coupon to this plan
                </button>
              )}

              <button
                onClick={() => choose(id)}
                disabled={isCurrent || loading !== null}
                className={`mt-3 w-full ${plan.highlight ? "btn-primary" : "btn-secondary"}`}
              >
                {loading === id ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Activating...
                  </>
                ) : isCurrent ? (
                  "Your current plan"
                ) : id === "FREE" ? (
                  "Downgrade to Free"
                ) : (
                  `Upgrade to ${plan.name}`
                )}
              </button>
            </motion.div>
          );
        })}
      </div>

      <div className="card card-padding text-sm text-slate-600 dark:text-slate-400">
        <h3 className="font-semibold mb-2">How billing works</h3>
        <p>
          This is a demo SaaS. In production, the upgrade button would open Razorpay/Stripe checkout,
          and the plan would activate via a payment webhook. Paid plans here are valid for 30 days
          and auto-downgrade to Free on expiry.
        </p>
      </div>
    </div>
  );
}
