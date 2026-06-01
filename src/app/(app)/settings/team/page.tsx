"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Plus, Trash2, Shield } from "lucide-react";

type Member = {
  id: string;
  role: string;
  user: { id: string; name: string; email: string };
};

const ROLES = ["ADMIN", "ACCOUNTANT", "OPERATOR", "VIEWER"];

export default function TeamPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "ACCOUNTANT" });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetch("/api/team")
      .then((r) => r.json())
      .then(setMembers)
      .finally(() => setLoading(false));
  }, []);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setAdding(false);
    if (res.ok) {
      const m = await res.json();
      setMembers((ms) => [...ms, m]);
      setForm({ name: "", email: "", password: "", role: "ACCOUNTANT" });
      toast.success("Team member added");
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this team member?")) return;
    const res = await fetch(`/api/team/${id}`, { method: "DELETE" });
    if (res.ok) {
      setMembers((ms) => ms.filter((m) => m.id !== id));
      toast.success("Removed");
    }
  }

  async function changeRole(id: string, role: string) {
    await fetch(`/api/team/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, role } : m)));
    toast.success("Role updated");
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Team & Access</h1>
        <p className="text-sm text-slate-500">Invite team members and assign roles</p>
      </div>

      <form onSubmit={addMember} className="card card-padding grid md:grid-cols-5 gap-3 items-end">
        <div>
          <label className="label">Name</label>
          <input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Email</label>
          <input required type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="label">Password</label>
          <input required type="password" minLength={6} className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button disabled={adding} className="btn-primary">
          <Plus className="h-4 w-4" /> Add
        </button>
      </form>

      <div className="card card-padding">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4 text-brand-600" /> Members
        </h2>
        {loading ? (
          <div className="text-center py-6 text-slate-500">Loading...</div>
        ) : members.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">No team members yet. You are the only admin.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.user.name}</td>
                  <td>{m.user.email}</td>
                  <td>
                    <select
                      className="input !py-1 !px-2 w-32"
                      value={m.role}
                      onChange={(e) => changeRole(m.id, e.target.value)}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    <button className="btn-ghost p-2 text-rose-600" onClick={() => remove(m.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card card-padding text-sm text-slate-600">
        <h3 className="font-semibold mb-2">Role permissions</h3>
        <ul className="space-y-1">
          <li><strong>ADMIN</strong> — Full access, manage team, company settings</li>
          <li><strong>ACCOUNTANT</strong> — Create/edit invoices, purchases, payments, reports</li>
          <li><strong>OPERATOR</strong> — Create invoices & purchases only (no delete)</li>
          <li><strong>VIEWER</strong> — Read-only access to all data</li>
        </ul>
      </div>
    </div>
  );
}
