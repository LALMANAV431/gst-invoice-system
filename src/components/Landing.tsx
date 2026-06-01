"use client";
import Link from "next/link";
import {
  Receipt,
  PackageSearch,
  Users,
  IndianRupee,
  PieChart,
  ShieldCheck,
  Zap,
  ArrowRight,
  Check,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { motion } from "framer-motion";
import { FadeIn, Reveal, StaggerGroup, StaggerItem } from "./motion";

const EASE = [0.22, 1, 0.36, 1] as const;

const features = [
  { icon: Receipt, title: "GST Invoicing", desc: "Auto CGST/SGST/IGST. PDF, print & share in one click.", color: "text-brand-600 bg-brand-50" },
  { icon: PackageSearch, title: "Inventory", desc: "HSN codes, low-stock alerts and automatic stock movements.", color: "text-violet-600 bg-violet-50" },
  { icon: Users, title: "Parties Ledger", desc: "Customers & vendors with GSTIN, balances and history.", color: "text-cyan-600 bg-cyan-50" },
  { icon: IndianRupee, title: "Payments", desc: "Track receipts, payments, receivables and payables.", color: "text-emerald-600 bg-emerald-50" },
  { icon: PieChart, title: "Reports & GST", desc: "GSTR-1 summary, P&L, sales register, stock value.", color: "text-amber-600 bg-amber-50" },
  { icon: ShieldCheck, title: "Secure & Isolated", desc: "JWT auth with per-company isolated workspaces.", color: "text-rose-600 bg-rose-50" },
];

const stats = [
  { value: "5%–28%", label: "GST slabs supported" },
  { value: "< 30s", label: "To first invoice" },
  { value: "100%", label: "Browser-based" },
  { value: "0₹", label: "To get started" },
];

export default function Landing() {
  return (
    <div className="min-h-screen mesh-bg overflow-hidden">
      {/* Animated background blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute top-[-10%] left-[10%] h-72 w-72 rounded-full bg-brand-300/30 blur-3xl animate-blob" />
        <div className="absolute top-[20%] right-[5%] h-80 w-80 rounded-full bg-violet-300/30 blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute bottom-[5%] left-[30%] h-72 w-72 rounded-full bg-cyan-300/25 blur-3xl animate-blob animation-delay-4000" />
      </div>

      {/* Nav */}
      <motion.header
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="sticky top-0 z-40"
      >
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="glass rounded-2xl px-4 py-3 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold shadow-glow">
                G
              </div>
              <span className="text-lg font-bold tracking-tight">GST Books</span>
            </div>
            <div className="flex gap-2">
              <Link href="/login" className="btn-secondary">
                Login
              </Link>
              <Link href="/register" className="btn-primary">
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </motion.header>

      <main className="max-w-7xl mx-auto px-6">
        {/* Hero */}
        <section className="py-16 md:py-24 text-center">
          <FadeIn>
            <div className="inline-flex items-center gap-2 bg-white/70 backdrop-blur border border-brand-100 text-brand-700 px-4 py-1.5 rounded-full text-xs font-semibold mb-6 shadow-sm">
              <Sparkles className="h-3.5 w-3.5" /> Built for Indian businesses · Alternative to Tally & Busy
            </div>
          </FadeIn>

          <motion.h1
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12 } } }}
            className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05]"
          >
            {["Accounting & GST", "Invoicing,"].map((line, i) => (
              <motion.span
                key={i}
                variants={{ hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } }}
                className="block"
              >
                {line}
              </motion.span>
            ))}
            <motion.span
              variants={{ hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } }}
              className="block gradient-text"
            >
              beautifully simple.
            </motion.span>
          </motion.h1>

          <FadeIn delay={0.4}>
            <p className="mt-6 text-lg text-slate-600 max-w-2xl mx-auto">
              Create GST invoices, manage inventory, track payments and generate
              file-ready reports — all from your browser. No installs, no clutter.
            </p>
          </FadeIn>

          <FadeIn delay={0.55}>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/register" className="btn-primary px-6 py-3 text-base group">
                Start free
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link href="/login" className="btn-secondary px-6 py-3 text-base">
                Try live demo
              </Link>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Demo: <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200">demo@gst.com</code> /{" "}
              <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200">demo1234</code>
            </p>
          </FadeIn>

          {/* Floating dashboard mockup */}
          <motion.div
            initial={{ opacity: 0, y: 60, rotateX: 12 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.6 }}
            className="mt-16 max-w-4xl mx-auto"
            style={{ perspective: 1000 }}
          >
            <div className="card shadow-2xl shadow-brand-600/10 overflow-hidden border-slate-200">
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                <span className="h-3 w-3 rounded-full bg-rose-400" />
                <span className="h-3 w-3 rounded-full bg-amber-400" />
                <span className="h-3 w-3 rounded-full bg-emerald-400" />
                <span className="ml-3 text-xs text-slate-400">app.gstbooks.in/dashboard</span>
              </div>
              <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3 bg-white">
                {[
                  { l: "Total Sales", v: "₹12.4L", c: "from-emerald-500 to-emerald-600" },
                  { l: "This Month", v: "₹2.1L", c: "from-brand-500 to-brand-700" },
                  { l: "Receivables", v: "₹84,200", c: "from-amber-500 to-amber-600" },
                  { l: "Payables", v: "₹31,500", c: "from-rose-500 to-rose-600" },
                ].map((k, i) => (
                  <motion.div
                    key={k.l}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.9 + i * 0.1, duration: 0.4, ease: EASE }}
                    className="rounded-xl border border-slate-100 p-3 text-left"
                  >
                    <div className={`h-8 w-8 rounded-lg bg-gradient-to-br ${k.c} mb-2`} />
                    <div className="text-[10px] uppercase text-slate-400 font-semibold">{k.l}</div>
                    <div className="text-lg font-bold">{k.v}</div>
                  </motion.div>
                ))}
                <div className="col-span-2 md:col-span-4 h-28 rounded-xl bg-gradient-to-tr from-brand-50 to-violet-50 flex items-end gap-2 p-4">
                  {[40, 65, 50, 80, 55, 90, 70].map((h, i) => (
                    <motion.div
                      key={i}
                      initial={{ height: 0 }}
                      animate={{ height: `${h}%` }}
                      transition={{ delay: 1.2 + i * 0.08, duration: 0.6, ease: EASE }}
                      className="flex-1 rounded-t-md bg-gradient-to-t from-brand-600 to-brand-400"
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Stats */}
        <StaggerGroup className="grid grid-cols-2 md:grid-cols-4 gap-4 py-8">
          {stats.map((s) => (
            <StaggerItem key={s.label}>
              <div className="card card-padding text-center card-hover">
                <div className="text-2xl md:text-3xl font-bold gradient-text">{s.value}</div>
                <div className="text-xs text-slate-500 mt-1">{s.label}</div>
              </div>
            </StaggerItem>
          ))}
        </StaggerGroup>

        {/* Features */}
        <section className="py-16">
          <Reveal className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold">Everything you need to run your books</h2>
            <p className="mt-3 text-slate-600">Powerful, yet simple enough for non-accountants.</p>
          </Reveal>

          <div className="grid md:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={i * 0.08}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="card card-padding h-full"
                >
                  <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${f.color}`}>
                    <f.icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-4 font-semibold text-lg">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{f.desc}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* CTA */}
        <Reveal className="py-12">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-indigo-800 px-8 py-14 text-center text-white shadow-2xl shadow-brand-600/30">
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, white 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
            <div className="relative">
              <TrendingUp className="h-10 w-10 mx-auto mb-4 opacity-90" />
              <h2 className="text-3xl md:text-4xl font-bold">Ready to ditch the spreadsheets?</h2>
              <p className="mt-3 text-brand-100 max-w-xl mx-auto">
                Set up your company and raise your first GST invoice in under a minute.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <Link href="/register" className="btn bg-white text-brand-700 hover:bg-brand-50 px-6 py-3 text-base">
                  Create free account <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-brand-100">
                {["No credit card", "Demo data included", "GST-compliant PDFs"].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <Check className="h-4 w-4" /> {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        <footer className="py-10 text-center text-sm text-slate-500 border-t border-slate-200/60">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="h-6 w-6 rounded-lg bg-brand-600 text-white flex items-center justify-center text-xs font-bold">
              G
            </div>
            <span className="font-semibold text-slate-700">GST Books</span>
          </div>
          Made in India for Indian SMBs · © {new Date().getFullYear()}
        </footer>
      </main>
    </div>
  );
}
