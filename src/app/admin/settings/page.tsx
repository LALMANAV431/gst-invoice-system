"use client";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Save, Settings } from "lucide-react";

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500";

const FIELDS: { key: string; label: string; placeholder?: string }[] = [
  { key: "site_name", label: "Site name" },
  { key: "support_phone", label: "Support phone", placeholder: "+91 90000 00000" },
  { key: "support_email", label: "Support email", placeholder: "support@gstbooks.in" },
  { key: "whatsapp_number", label: "WhatsApp number", placeholder: "+919000000000" },
  { key: "address", label: "Address" },
  { key: "facebook_url", label: "Facebook URL" },
  { key: "instagram_url", label: "Instagram URL" },
  { key: "twitter_url", label: "Twitter / X URL" },
];

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/site-settings").then((r) => r.json()).then(setSettings);
  }, []);

  function set(key: string, value: string) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function save() {
    setSaving(true);
    const res = await fetch("/api/admin/site-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    if (res.ok) toast.success("Settings saved");
    else toast.error("Failed");
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6 text-amber-400" /> Site Settings
        </h1>
        <p className="text-sm text-slate-400">Contact details, socials and the homepage announcement</p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
        <div>
          <label className="text-xs text-slate-400">Announcement banner (shown on homepage)</label>
          <input
            className={inputCls}
            value={settings.announcement ?? ""}
            onChange={(e) => set("announcement", e.target.value)}
            placeholder="🎉 New feature launched!"
          />
          <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={settings.announcement_active === "true"}
              onChange={(e) => set("announcement_active", e.target.checked ? "true" : "false")}
            />
            Show announcement banner
          </label>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="text-xs text-slate-400">{f.label}</label>
              <input
                className={inputCls}
                value={settings[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            </div>
          ))}
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-amber-500 text-slate-900 font-semibold px-5 py-2.5 text-sm hover:bg-amber-400"
        >
          <Save className="h-4 w-4 inline" /> {saving ? "Saving..." : "Save settings"}
        </button>
      </div>
    </div>
  );
}
