"use client";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { LifeBuoy, Send } from "lucide-react";
import { formatDate } from "@/lib/utils";

type Ticket = {
  id: string;
  subject: string;
  message: string;
  status: string;
  reply: string | null;
  createdAt: string;
};

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [form, setForm] = useState({ subject: "", message: "" });
  const [loading, setLoading] = useState(false);

  function load() {
    fetch("/api/support").then((r) => r.json()).then(setTickets);
  }
  useEffect(load, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) return toast.error("Fill all fields");
    setLoading(true);
    const res = await fetch("/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (res.ok) {
      const t = await res.json();
      setTickets((ts) => [t, ...ts]);
      setForm({ subject: "", message: "" });
      toast.success("Ticket submitted — we'll get back to you!");
    } else toast.error("Failed");
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LifeBuoy className="h-6 w-6 text-brand-600" /> Help & Support
        </h1>
        <p className="text-sm text-slate-500">Raise a ticket and our team will respond</p>
      </div>

      <form onSubmit={submit} className="card card-padding space-y-3">
        <div>
          <label className="label">Subject</label>
          <input
            className="input"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="e.g. How do I export GSTR-1?"
          />
        </div>
        <div>
          <label className="label">Message</label>
          <textarea
            className="input"
            rows={4}
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder="Describe your issue or question..."
          />
        </div>
        <button disabled={loading} className="btn-primary">
          <Send className="h-4 w-4" /> {loading ? "Sending..." : "Submit ticket"}
        </button>
      </form>

      <div className="card card-padding">
        <h2 className="font-semibold mb-3">Your tickets</h2>
        {tickets.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">No tickets yet.</p>
        ) : (
          <ul className="space-y-3">
            {tickets.map((t) => (
              <li key={t.id} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{t.subject}</span>
                  {t.status === "RESOLVED" ? (
                    <span className="badge-green">Resolved</span>
                  ) : (
                    <span className="badge-amber">Open</span>
                  )}
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.message}</p>
                <div className="text-xs text-slate-400 mt-1">{formatDate(t.createdAt)}</div>
                {t.reply && (
                  <div className="mt-2 rounded-lg bg-brand-50 dark:bg-brand-500/10 p-2 text-sm">
                    <span className="font-semibold text-brand-700 dark:text-brand-300">Support reply:</span> {t.reply}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
