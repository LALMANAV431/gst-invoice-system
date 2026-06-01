"use client";
import { motion } from "framer-motion";
import { TrendingUp, Receipt, Wallet, ShoppingCart, type LucideIcon } from "lucide-react";
import AnimatedCounter from "./AnimatedCounter";

const ICONS: Record<string, LucideIcon> = {
  sales: TrendingUp,
  month: Receipt,
  receivable: Wallet,
  payable: ShoppingCart,
};

const GRADIENTS: Record<string, string> = {
  sales: "from-emerald-500 to-emerald-600",
  month: "from-brand-500 to-brand-700",
  receivable: "from-amber-500 to-amber-600",
  payable: "from-rose-500 to-rose-600",
};

export type Kpi = { key: string; label: string; value: number };

const EASE = [0.22, 1, 0.36, 1] as const;

export default function DashboardKpis({ kpis }: { kpis: Kpi[] }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
      className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      {kpis.map((c) => {
        const Icon = ICONS[c.key] ?? TrendingUp;
        return (
          <motion.div
            key={c.key}
            variants={{
              hidden: { opacity: 0, y: 18 },
              show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
            }}
            whileHover={{ y: -4 }}
            className="card card-padding relative overflow-hidden"
          >
            <div className={`absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br ${GRADIENTS[c.key]} opacity-10`} />
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wide font-semibold">
                  {c.label}
                </div>
                <div className="mt-2 text-2xl font-bold">
                  <AnimatedCounter value={c.value} />
                </div>
              </div>
              <div
                className={`h-11 w-11 rounded-xl bg-gradient-to-br ${GRADIENTS[c.key]} text-white flex items-center justify-center shadow-lg`}
              >
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
