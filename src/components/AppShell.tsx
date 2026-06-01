"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
  LayoutDashboard,
  Users,
  Boxes,
  FileText,
  ShoppingCart,
  IndianRupee,
  BarChart3,
  Settings,
  LogOut,
  Building2,
  Menu,
  X,
  Plus,
  FileSpreadsheet,
  RotateCcw,
  Wallet,
  Warehouse,
  Landmark,
  PiggyBank,
  Crown,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ThemeToggle from "@/components/ThemeToggle";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pos", label: "POS Billing", icon: ScanLine },
  { href: "/parties", label: "Parties", icon: Users },
  { href: "/items", label: "Items", icon: Boxes },
  { href: "/quotations", label: "Quotations", icon: FileSpreadsheet },
  { href: "/invoices", label: "Sales Invoices", icon: FileText },
  { href: "/purchases", label: "Purchases", icon: ShoppingCart },
  { href: "/credit-notes", label: "Credit/Debit Notes", icon: RotateCcw },
  { href: "/payments", label: "Payments", icon: IndianRupee },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/godowns", label: "Godowns", icon: Warehouse },
  { href: "/bank-reconciliation", label: "Bank Recon", icon: Landmark },
  { href: "/budgets", label: "Budgets", icon: PiggyBank },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/billing", label: "Plans & Billing", icon: Crown },
  { href: "/settings", label: "Settings", icon: Settings },
];

const EASE = [0.22, 1, 0.36, 1] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="p-3 space-y-1">
      {NAV.map((it) => {
        const active = pathname === it.href || pathname.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            onClick={onNavigate}
            className={cn(
              "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors duration-200",
              active
                ? "text-brand-700 dark:text-brand-300"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-xl bg-brand-50 ring-1 ring-brand-100 dark:bg-brand-500/10 dark:ring-brand-500/20"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <it.icon className={cn("relative h-[18px] w-[18px]", active && "text-brand-600")} />
            <span className="relative">{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function AppShell({
  userName,
  companyName,
  planName,
  planId,
  invoiceUsed,
  invoiceLimit,
  isSuperAdmin,
  children,
}: {
  userName: string;
  companyName: string;
  planName: string;
  planId: string;
  invoiceUsed: number;
  invoiceLimit: number | null;
  isSuperAdmin?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    toast.success("Logged out");
    router.push("/login");
    router.refresh();
  }

  const planColor =
    planId === "PREMIUM"
      ? "bg-amber-50 text-amber-700 ring-amber-600/20"
      : planId === "BASIC"
      ? "bg-brand-50 text-brand-700 ring-brand-600/20"
      : "bg-slate-100 text-slate-600 ring-slate-500/20";
  const usagePct =
    invoiceLimit && invoiceLimit > 0 ? Math.min(100, (invoiceUsed / invoiceLimit) * 100) : 0;
  const nearLimit = invoiceLimit !== null && invoiceUsed >= invoiceLimit * 0.8;

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-white border-r border-slate-200 flex-col sticky top-0 h-screen dark:bg-slate-900 dark:border-slate-800">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 dark:border-slate-800">
          <div className="h-9 w-9 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold shadow-glow">
            G
          </div>
          <span className="font-bold tracking-tight">GST Books</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <div className="p-3 border-t border-slate-100 dark:border-slate-800">
          <Link
            href="/billing"
            className={`block rounded-xl p-3 mb-2 ring-1 ring-inset transition hover:opacity-90 ${planColor}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold flex items-center gap-1">
                <Crown className="h-3.5 w-3.5" /> {planName} plan
              </span>
              {planId !== "PREMIUM" && <span className="text-[11px] font-semibold underline">Upgrade</span>}
            </div>
            {invoiceLimit !== null && (
              <div className="mt-2">
                <div className="h-1.5 rounded-full bg-white/60 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${nearLimit ? "bg-rose-500" : "bg-current"}`}
                    style={{ width: `${usagePct}%` }}
                  />
                </div>
                <div className="mt-1 text-[11px]">
                  {invoiceUsed}/{invoiceLimit} invoices this month
                </div>
              </div>
            )}
          </Link>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-600 transition-colors"
          >
            <LogOut className="h-[18px] w-[18px]" /> Logout
          </button>
          <div className="px-3 pt-2 text-xs text-slate-400">v1.0 · GST Books</div>
        </div>
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 md:hidden"
            />
            <motion.aside
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="fixed left-0 top-0 bottom-0 w-72 bg-white z-50 md:hidden flex flex-col shadow-2xl dark:bg-slate-900"
            >
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold">
                    G
                  </div>
                  <span className="font-bold">GST Books</span>
                </div>
                <button className="btn-ghost p-2" onClick={() => setMobileOpen(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <NavLinks onNavigate={() => setMobileOpen(false)} />
              </div>
              <div className="p-3 border-t border-slate-100">
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-rose-600 hover:bg-rose-50"
                >
                  <LogOut className="h-[18px] w-[18px]" /> Logout
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-30 glass border-b border-slate-200/70 px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              className="btn-ghost p-2 md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 text-slate-400" />
              <span className="font-semibold text-slate-800 dark:text-slate-100">{companyName}</span>
              <Link
                href="/billing"
                className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${planColor}`}
              >
                <Crown className="h-3 w-3" /> {planName}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {isSuperAdmin && (
              <Link
                href="/admin"
                className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-600/20 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Admin
              </Link>
            )}
            <Link href="/pos" className="btn-secondary hidden sm:inline-flex !py-2 !px-3.5">
              POS
            </Link>
            <Link href="/invoices/new" className="btn-primary hidden sm:inline-flex !py-2 !px-3.5">
              <Plus className="h-4 w-4" /> New Invoice
            </Link>
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium text-slate-900 leading-tight dark:text-slate-100">{userName}</div>
              <div className="text-xs text-slate-500">Owner</div>
            </div>
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 text-white flex items-center justify-center font-semibold shadow-sm">
              {userName.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* Animated page content */}
        <main className="flex-1 p-4 md:p-6 max-w-[1400px] w-full mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
