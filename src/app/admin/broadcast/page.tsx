"use client";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Megaphone, MessageCircle, Mail, Send } from "lucide-react";

type Recipient = { name: string; email: string; phone: string };
type Broadcast = { id: string; title: string; message: string; channel: string; createdAt: string };

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500";

export default function AdminBroadcastPage() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [past, setPast] = useState<Broadcast[]>([]);
  const [form, setForm] = useState({ title: "", message: "" });
  const [saving, setSaving] = useState(false);

  function load() {
    fetch("/api/admin/broadcast")
      .then((r) => r.json())
      .then((d) => {
        setRecipients(d.recipients || []);
        setPast(d.broadcasts || []);
      });
  }
  useEffect(load, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.message.trim()) return toast.error("Fill all fields");
    setSaving(true);
    const res = await fetch("/api/admin/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      const b = await res.json();
      setPast((p) => [b, ...p]);
      toast.success("Broadcast saved. Use the links below to send.");
    } else toast.error("Failed");
  }

  const fullMsg = `${form.title}\n\n${form.message}`;
  const waAll = recipients.filter((r) => r.phone);
  const emailList = recipients.filter((r) => r.email).map((r) => r.email).join(",");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Megaphone className="h-6 w-6 text-amber-400" /> Broadcast
        </h1>
        <p className="text-sm text-slate-400">Compose a message and send it to all customers</p>
      </div>

      <form onSubmit={save} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3">
        <div>
          <label className="text-xs text-slate-400">Title</label>
          <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="New feature announcement" />
        </div>
        <div>
          <label className="text-xs text-slate-400">Message</label>
          <textarea className={inputCls} rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Hi! We just launched..." />
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={saving} className="rounded-xl bg-amber-500 text-slate-900 font-semibold px-4 py-2.5 text-sm hover:bg-amber-400">
            <Send className="h-4 w-4 inline" /> Save broadcast
          </button>
          {emailList && (
            <a
              href={`mailto:?bcc=${emailList}&subject=${encodeURIComponent(form.title)}&body=${encodeURIComponent(form.message)}`}
              className="rounded-xl bg-slate-700 text-white px-4 py-2.5 text-sm hover:bg-slate-600"
            >
              <Mail className="h-4 w-4 inline" /> Email all ({recipients.filter((r) => r.email).length})
            </a>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Tip: Email uses your mail app (BCC to all). WhatsApp opens per-recipient links below
          (free, no API). For automated sending, connect an email/WhatsApp provider later.
        </p>
      </form>

      {form.message && waAll.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-emerald-400" /> WhatsApp recipients ({waAll.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {waAll.map((r, i) => (
              <a
                key={i}
                href={`https://wa.me/${r.phone}?text=${encodeURIComponent(fullMsg)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-emerald-500/10 text-emerald-400 px-3 py-1.5 text-xs hover:bg-emerald-500/20"
              >
                {r.name}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="font-semibold mb-3">Recent broadcasts</h2>
        {past.length === 0 ? (
          <p className="text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {past.map((b) => (
              <li key={b.id} className="border-b border-slate-800 pb-2">
                <div className="font-medium text-sm">{b.title}</div>
                <div className="text-xs text-slate-400">{b.message}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{new Date(b.createdAt).toLocaleString("en-IN")}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
