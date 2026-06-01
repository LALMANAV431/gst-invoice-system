"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Plus, Warehouse, ArrowRightLeft } from "lucide-react";

export default function GodownsPage() {
  const router = useRouter();
  const [godowns, setGodowns] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/godowns").then((r) => r.json()).then(setGodowns);
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    const res = await fetch("/api/godowns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, city }),
    });
    setLoading(false);
    if (res.ok) {
      const g = await res.json();
      setGodowns((gs) => [...gs, g]);
      setName("");
      setCity("");
      toast.success("Godown added");
    } else toast.error("Failed");
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Warehouse className="h-6 w-6 text-brand-600" /> Godowns / Warehouses
          </h1>
          <p className="text-sm text-slate-500">Manage storage locations and transfer stock</p>
        </div>
      </div>

      <form onSubmit={add} className="card card-padding flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="label">Godown name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="min-w-[140px]">
          <label className="label">City</label>
          <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <button disabled={loading} className="btn-primary">
          <Plus className="h-4 w-4" /> Add
        </button>
      </form>

      <div className="card card-padding">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>City</th>
              <th>Default</th>
            </tr>
          </thead>
          <tbody>
            {godowns.length === 0 ? (
              <tr><td colSpan={3} className="text-center py-6 text-slate-500">No godowns yet.</td></tr>
            ) : (
              godowns.map((g) => (
                <tr key={g.id}>
                  <td className="font-medium">{g.name}</td>
                  <td>{g.city || "—"}</td>
                  <td>{g.isDefault ? <span className="badge-green">Default</span> : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
