"use client";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { LifeBuoy } from "lucide-react";

type Ticket = {
  id: string;
  subject: string;
  message: string;
  status: string;
  reply: string | null;
  userName: string | null;
  userEmail: string | null;
  createdAt: string;
};

export default function AdminTicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  function load() {
    fetch("/api/admin/tickets")
      .then((r) => r.json())
      .then(setTickets)
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function saveReply(id: string, status: string) {
    const res = await fetch(`/api/admin/tickets/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: replyText[id], status }),
    });
    if (res.ok) {
      setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, reply: replyText[id] ?? t.reply, status } : t)));
      toast.success("Saved");
    } else toast.error("Failed");
  }

  const open = tickets.filter((t) => t.status !== "RESOLVED");
  const resolved = tickets.filter((t) => t.status === "RESOLVED");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LifeBuoy className="h-6 w-6 text-amber-400" /> Support Inbox
        </h1>
        <p className="text-sm text-slate-400">
          {open.length} open · {resolved.length} resolved
        </p>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading...</div>
      ) : tickets.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center text-slate-500">
          No support tickets yet.
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <div key={t.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{t.subject}</div>
                  <div className="text-xs text-slate-400">
                    {t.userName} · {t.userEmail} · {new Date(t.createdAt).toLocaleString("en-IN")}
                  </div>
                </div>
                <span className={t.status === "RESOLVED" ? "text-emerald-400 text-xs font-semibold" : "text-amber-400 text-xs font-semibold"}>
                  {t.status}
                </span>
              </div>
              <p className="text-sm text-slate-300 mt-2">{t.message}</p>
              {t.reply && (
                <div className="mt-2 rounded-lg bg-slate-800 p-2 text-sm">
                  <span className="text-amber-300 font-semibold">Your reply:</span> {t.reply}
                </div>
              )}
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <input
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                  placeholder="Write a reply..."
                  defaultValue={t.reply ?? ""}
                  onChange={(e) => setReplyText((r) => ({ ...r, [t.id]: e.target.value }))}
                />
                <button
                  onClick={() => saveReply(t.id, "OPEN")}
                  className="rounded-xl bg-slate-700 text-white px-4 py-2 text-sm hover:bg-slate-600"
                >
                  Save reply
                </button>
                <button
                  onClick={() => saveReply(t.id, t.status === "RESOLVED" ? "OPEN" : "RESOLVED")}
                  className="rounded-xl bg-amber-500 text-slate-900 font-semibold px-4 py-2 text-sm hover:bg-amber-400"
                >
                  {t.status === "RESOLVED" ? "Reopen" : "Resolve"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
