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
  LifeBuoy,
  Eye,
  Sparkles,
  BookOpenCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import { useT } from "@/lib/i18n/client";
import type { Locale, TranslationKey } from "@/lib/i18n";

// Labels are translation KEYS, resolved at render time. Holding English strings
// here is what made the sidebar untranslatable.
type NavItem = { href: string; labelKey: TranslationKey; icon: any; flag?: string };

const NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/pos", labelKey: "nav.pos", icon: ScanLine, flag: "flag_pos" },
  { href: "/parties", labelKey: "nav.parties", icon: Users },
  { href: "/items", labelKey: "nav.items", icon: Boxes },
  { href: "/quotations", labelKey: "nav.quotations", icon: FileSpreadsheet, flag: "flag_quotations" },
  { href: "/invoices", labelKey: "nav.invoices", icon: FileText },
  { href: "/purchases", labelKey: "nav.purchases", icon: ShoppingCart },
  { href: "/credit-notes", labelKey: "nav.creditNotes", icon: RotateCcw, flag: "flag_credit_notes" },
  { href: "/payments", labelKey: "nav.payments", icon: IndianRupee },
  { href: "/expenses", labelKey: "nav.expenses", icon: Wallet, flag: "flag_expenses" },
  { href: "/journal", labelKey: "doc.journalVoucher", icon: BookOpenCheck, flag: "flag_journal" },
  { href: "/godowns", labelKey: "nav.godowns", icon: Warehouse, flag: "flag_godowns" },
  { href: "/bank-reconciliation", labelKey: "nav.bankRecon", icon: Landmark, flag: "flag_bank" },
  { href: "/budgets", labelKey: "nav.budgets", icon: PiggyBank, flag: "flag_budgets" },
  { href: "/reports", labelKey: "nav.reports", icon: BarChart3 },
  { href: "/assistant", labelKey: "ai.title", icon: Sparkles, flag: "flag_ai" },
  { href: "/billing", labelKey: "nav.billing", icon: Crown },
  { href: "/support", labelKey: "nav.support", icon: LifeBuoy },
  { href: "/settings", labelKey: "nav.settings", icon: Settings },
];

const EASE = [0.22, 1, 0.36, 1] as const;

function NavLinks({
  onNavigate,
  flags,
}: {
  onNavigate?: () => void;
  flags?: Record<string, boolean>;
}) {
  const pathname = usePathname();
  const { t } = useT();
  const items = NAV.filter((it) => !it.flag || !flags || flags[it.flag] !== false);
  return (
    <nav className="p-3 space-y-1">
      {items.map((it) => {
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
            <span className="relative">{t(it.labelKey)}</span>
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
  flags,
  impersonating,
  locale,
  children,
}: {
  userName: string;
  companyName: string;
  planName: string;
  planId: string;
  invoiceUsed: number;
  invoiceLimit: number | null;
  isSuperAdmin?: boolean;
  flags?: Record<string, boolean>;
  impersonating?: boolean;
  locale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useT();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    toast.success(t("nav.logout"));
    router.push("/login");
    router.refresh();
  }

  async function stopImpersonating() {
    await fetch("/api/admin/impersonate/stop", { method: "POST" });
    toast.success("Returned to admin");
    router.push("/admin/companies");
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
          <NavLinks flags={flags} />
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
                <NavLinks onNavigate={() => setMobileOpen(false)} flags={flags} />
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
        {impersonating && (
          <div className="bg-amber-500 text-slate-900 text-sm font-medium px-4 py-2 flex items-center justify-center gap-3">
            <Eye className="h-4 w-4" />
            Viewing as <strong>{companyName}</strong> (admin impersonation)
            <button
              onClick={stopImpersonating}
              className="ml-2 rounded-lg bg-slate-900 text-white px-2.5 py-1 text-xs font-semibold hover:bg-slate-800"
            >
              Exit
            </button>
          </div>
        )}
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
            <LanguageToggle current={locale} />
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
              <Plus className="h-4 w-4" /> {t("nav.newInvoice")}
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
