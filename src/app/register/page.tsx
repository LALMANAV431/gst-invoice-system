"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Check } from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as const;

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    companyName: "",
    gstin: "",
    state: "",
    stateCode: "",
  });
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (res.ok) {
      toast.success("Account created!");
      router.push("/dashboard");
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Failed to register");
    }
  }

  return (
    <div className="min-h-screen mesh-bg flex items-center justify-center p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/4 h-72 w-72 rounded-full bg-brand-300/30 blur-3xl animate-blob" />
        <div className="absolute bottom-0 right-1/4 h-72 w-72 rounded-full bg-violet-300/30 blur-3xl animate-blob animation-delay-2000" />
      </div>

      <motion.form
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        onSubmit={onSubmit}
        className="card card-padding w-full max-w-2xl shadow-xl"
      >
        <div className="flex items-center gap-2 mb-6">
          <div className="h-10 w-10 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold text-lg shadow-glow">
            G
          </div>
          <span className="text-lg font-bold">GST Books</span>
        </div>

        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">
          Start managing your business in under 60 seconds.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mt-6">
          {[
            { k: "name", label: "Your name *", type: "text", req: true },
            { k: "email", label: "Email *", type: "email", req: true },
            { k: "password", label: "Password *", type: "password", req: true },
            { k: "companyName", label: "Company name *", type: "text", req: true },
            { k: "gstin", label: "GSTIN (optional)", type: "text", req: false },
            { k: "state", label: "State (optional)", type: "text", req: false },
          ].map((f, i) => (
            <motion.div
              key={f.k}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE, delay: 0.1 + i * 0.06 }}
            >
              <label className="label">{f.label}</label>
              <input
                required={f.req}
                type={f.type}
                minLength={f.k === "password" ? 6 : undefined}
                maxLength={f.k === "gstin" ? 15 : undefined}
                className="input"
                value={(form as any)[f.k]}
                onChange={(e) =>
                  setForm({
                    ...form,
                    [f.k]: f.k === "gstin" ? e.target.value.toUpperCase() : e.target.value,
                  })
                }
              />
            </motion.div>
          ))}
        </div>

        <button disabled={loading} className="btn-primary w-full mt-6 group">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Creating account...
            </>
          ) : (
            <>
              Create account
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </button>

        <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-slate-500">
          {["Free forever plan", "No credit card", "GST-ready PDFs"].map((t) => (
            <span key={t} className="inline-flex items-center gap-1">
              <Check className="h-3.5 w-3.5 text-emerald-500" /> {t}
            </span>
          ))}
        </div>

        <p className="mt-4 text-sm text-slate-500 text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-brand-600 font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      </motion.form>
    </div>
  );
}
