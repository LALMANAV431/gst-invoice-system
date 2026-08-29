"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, AlertTriangle, AlertCircle, Info, Check, X } from "lucide-react";
import { useT } from "@/lib/i18n/client";

type Notification = {
  id: string;
  kind: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  body: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

/**
 * Notification centre.
 *
 * Polls rather than using a websocket: the alerts here are hours-relevant, not
 * seconds-relevant, and a polling interval costs nothing to operate. Polling only
 * happens while the tab is visible, so a backgrounded tab on a phone does not
 * drain battery or burn the rate limit.
 */
export default function NotificationBell() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  async function load(generate: boolean) {
    setLoading(true);
    try {
      const res = await fetch(`/api/notifications?generate=${generate}&pageSize=20`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.data ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      // A failed poll is not worth interrupting the user for.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Generate reminders on the first load of a session, then poll cheaply.
    load(true);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load(false);
    }, 120_000);

    return () => clearInterval(interval);
  }, []);

  // Close on outside click and on Escape — expected of any popover.
  useEffect(() => {
    if (!open) return;

    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markAllRead() {
    // Optimistic: the count is the thing the user is watching.
    setUnread(0);
    setItems((prev) => prev.map((i) => ({ ...i, readAt: new Date().toISOString() })));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "READ_ALL" }),
    }).catch(() => undefined);
  }

  async function dismiss(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "DISMISS", id }),
    }).catch(() => undefined);
  }

  const hasCritical = items.some((i) => i.severity === "CRITICAL" && !i.readAt);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${unread} unread notifications`}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${
              hasCritical ? "bg-rose-600" : "bg-brand-600"
            }`}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
            <span className="text-sm font-semibold">Alerts</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-brand-600 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[24rem] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                {t("state.loading")}
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                Nothing needs your attention.
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={`flex gap-2.5 border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-800 ${
                    n.readAt ? "" : "bg-slate-50/70 dark:bg-slate-800/40"
                  }`}
                >
                  <SeverityIcon severity={n.severity} />
                  <div className="min-w-0 flex-1">
                    {n.actionUrl ? (
                      <Link
                        href={n.actionUrl}
                        onClick={() => setOpen(false)}
                        className="text-sm font-medium hover:underline"
                      >
                        {n.title}
                      </Link>
                    ) : (
                      <div className="text-sm font-medium">{n.title}</div>
                    )}
                    <p className="mt-0.5 text-xs text-slate-500">{n.body}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(n.id)}
                    aria-label="Dismiss"
                    className="shrink-0 self-start rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "CRITICAL") {
    return <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />;
  }
  if (severity === "WARNING") {
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />;
  }
  return <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />;
}
