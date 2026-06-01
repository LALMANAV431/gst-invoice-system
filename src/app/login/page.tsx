"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Receipt, PackageSearch, BarChart3 } from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as const;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("demo@gst.com");
  const [password, setPassword] = useState("demo1234");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (res.ok) {
      toast.success("Welcome back!");
      router.push("/dashboard");
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Login failed");
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex bg-gradient-to-br from-brand-600 via-brand-700 to-indigo-900 text-white p-12 flex-col justify-between overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 30% 20%, white 1px, transparent 1px)", backgroundSize: "26px 26px" }} />
        <div className="absolute -top-20 -right-20 h-72 w-72 rounded-full bg-white/10 blur-3xl animate-blob" />
        <div className="absolute bottom-10 -left-10 h-64 w-64 rounded-full bg-violet-400/20 blur-3xl animate-blob animation-delay-2000" />

        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="relative flex items-center gap-2"
        >
          <div className="h-10 w-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center font-bold text-lg">
            G
          </div>
          <span className="text-xl font-bold">GST Books</span>
        </motion.div>

        <div className="relative">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
            className="text-4xl font-bold leading-tight"
          >
            Welcome back.
            <br />
            Run your business smarter.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
            className="mt-4 text-brand-100 text-lg max-w-md"
          >
            All your invoices, inventory, payments and GST reports in one beautiful place.
          </motion.p>

          <div className="mt-8 space-y-3">
            {[
              { icon: Receipt, t: "GST-compliant invoices in seconds" },
              { icon: PackageSearch, t: "Real-time inventory tracking" },
              { icon: BarChart3, t: "GSTR-ready reports & P&L" },
            ].map((f, i) => (
              <motion.div
                key={f.t}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, ease: EASE, delay: 0.35 + i * 0.1 }}
                className="flex items-center gap-3"
              >
                <div className="h-9 w-9 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center">
                  <f.icon className="h-4.5 w-4.5" />
                </div>
                <span className="text-brand-50">{f.t}</span>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="relative text-xs text-brand-200">
          © {new Date().getFullYear()} GST Books · Made in India
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 mesh-bg">
        <motion.form
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          onSubmit={onSubmit}
          className="w-full max-w-sm card card-padding shadow-xl"
        >
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <div className="h-9 w-9 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold">
              G
            </div>
            <span className="text-lg font-bold">GST Books</span>
          </div>

          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Enter your credentials to continue.</p>

          <div className="mt-6">
            <label className="label">Email</label>
            <input
              type="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="mt-3">
            <label className="label">Password</label>
            <input
              type="password"
              required
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button disabled={loading} className="btn-primary w-full mt-5 group">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Signing in...
              </>
            ) : (
              <>
                Sign in
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>

          <p className="mt-4 text-sm text-slate-500 text-center">
            New here?{" "}
            <Link href="/register" className="text-brand-600 font-semibold hover:underline">
              Create an account
            </Link>
          </p>

          <div className="mt-6 p-3 rounded-xl bg-brand-50 border border-brand-100 text-xs text-brand-800">
            <strong>Demo account</strong> · demo@gst.com / demo1234
          </div>
        </motion.form>
      </div>
    </div>
  );
}
