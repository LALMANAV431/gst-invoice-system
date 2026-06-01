"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { motion } from "framer-motion";
import { Check, Sparkles, Loader2, Crown } from "lucide-react";
import { PLANS, FEATURE_LABELS, type PlanId, type Feature } from "@/lib/plan";
import { formatINR } from "@/lib/utils";

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
}: {
  currentPlan: PlanId;
  planExpiry: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<PlanId | null>(null);

  async function choose(planId: PlanId) {
    if (planId === currentPlan) return;
    setLoading(planId);
    const res = await fetch("/api/company/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: planId }),
    });
    setLoading(null);
    if (res.ok) {
      toast.success(
        planId === "FREE"
          ? "Switched to Free plan"
          : `${PLANS[planId].name} plan activated! 🎉`
      );
      router.refresh();
    } else {
      toast.error("Failed to change plan");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Crown className="h-6 w-6 text-amber-500" /> Plans & Billing
          </h1>
          <p className="text-sm text-slate-500">
            You are on the <strong>{PLANS[currentPlan].name}</strong> plan
            {planExpiry && currentPlan !== "FREE"
              ? ` · renews ${new Date(planExpiry).toLocaleDateString("en-IN")}`
              : ""}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full text-xs font-semibold ring-1 ring-amber-600/20">
          <Sparkles className="h-3.5 w-3.5" /> Demo: upgrades activate instantly (no real payment)
        </span>
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        {ORDER.map((id, i) => {
          const plan = PLANS[id];
          const isCurrent = id === currentPlan;
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
                <span className="text-3xl font-bold">{plan.price === 0 ? "Free" : formatINR(plan.price)}</span>
                {plan.price > 0 && <span className="text-sm text-slate-500">/month</span>}
              </div>

              <div className="mt-3 text-sm text-slate-600">
                <div>
                  {plan.invoiceLimit === Infinity
                    ? "Unlimited invoices"
                    : `${plan.invoiceLimit} invoices / month`}
                </div>
                <div>{plan.userLimit === 1 ? "1 user" : `Up to ${plan.userLimit} users`}</div>
              </div>

              <ul className="mt-4 space-y-2 text-sm flex-1">
                {ALL_FEATURES.map((f) => {
                  const has = plan.features.includes(f);
                  return (
                    <li
                      key={f}
                      className={`flex items-center gap-2 ${has ? "text-slate-700" : "text-slate-300 line-through"}`}
                    >
                      <Check className={`h-4 w-4 shrink-0 ${has ? "text-emerald-500" : "text-slate-200"}`} />
                      {FEATURE_LABELS[f]}
                    </li>
                  );
                })}
              </ul>

              <button
                onClick={() => choose(id)}
                disabled={isCurrent || loading !== null}
                className={`mt-5 w-full ${plan.highlight ? "btn-primary" : "btn-secondary"}`}
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

      <div className="card card-padding text-sm text-slate-600">
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
