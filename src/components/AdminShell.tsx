"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Building2,
  Ticket,
  IndianRupee,
  Settings,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/companies", label: "Companies", icon: Building2 },
  { href: "/admin/coupons", label: "Coupons", icon: Ticket },
  { href: "/admin/pricing", label: "Pricing", icon: IndianRupee },
  { href: "/admin/settings", label: "Site Settings", icon: Settings },
];

export default function AdminShell({
  adminName,
  children,
}: {
  adminName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="hidden md:flex w-64 shrink-0 bg-slate-900 border-r border-slate-800 flex-col sticky top-0 h-screen">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-900 flex items-center justify-center font-bold">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="font-bold leading-tight">Admin Console</div>
            <div className="text-[11px] text-slate-400">GST Books Platform</div>
          </div>
        </div>
        <nav className="p-3 space-y-1">
          {NAV.map((it) => {
            const active = pathname === it.href || (it.href !== "/admin" && pathname.startsWith(it.href));
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                  active ? "text-amber-300" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="admin-nav-active"
                    className="absolute inset-0 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/30"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <it.icon className="relative h-[18px] w-[18px]" />
                <span className="relative">{it.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto p-3 border-t border-slate-800">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <ArrowLeft className="h-[18px] w-[18px]" /> Back to App
          </Link>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-slate-900/80 backdrop-blur border-b border-slate-800 px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            <span className="font-semibold">Super Admin</span>
            <span className="text-xs text-slate-400 hidden sm:inline">· Platform owner controls</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-slate-300 hover:text-white md:hidden">
              ← App
            </Link>
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-slate-900 flex items-center justify-center font-semibold">
              {adminName.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 max-w-[1300px] w-full mx-auto">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
