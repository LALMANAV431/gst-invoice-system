"use client";
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { Upload, CheckCircle, XCircle, Landmark } from "lucide-react";
import { formatINR } from "@/lib/utils";

export default function BankReconciliationPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [csvText, setCsvText] = useState("");

  useEffect(() => {
    fetch("/api/bank-reconciliation")
      .then((r) => r.json())
      .then(setTransactions)
      .finally(() => setLoading(false));
  }, []);

  async function importCSV(e: React.FormEvent) {
    e.preventDefault();
    if (!csvText.trim()) return toast.error("Paste CSV data");

    // Parse CSV: date, description, reference, debit, credit, balance
    const lines = csvText.trim().split("\n").slice(1); // skip header
    const parsed = lines
      .map((line) => {
        const parts = line.split(",").map((s) => s.trim().replace(/"/g, ""));
        if (parts.length < 5) return null;
        return {
          date: parts[0],
          description: parts[1],
          reference: parts[2] || null,
          debit: parseFloat(parts[3]) || 0,
          credit: parseFloat(parts[4]) || 0,
          balance: parseFloat(parts[5]) || 0,
        };
      })
      .filter(Boolean);

    if (parsed.length === 0) return toast.error("No valid rows found");

    const res = await fetch("/api/bank-reconciliation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: parsed }),
    });

    if (res.ok) {
      const data = await res.json();
      toast.success(`Imported ${data.imported} transactions`);
      setCsvText("");
      // Refresh
      const fresh = await fetch("/api/bank-reconciliation").then((r) => r.json());
      setTransactions(fresh);
    } else toast.error("Import failed");
  }

  async function toggleMatch(id: string, matched: boolean) {
    await fetch("/api/bank-reconciliation/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankTransactionId: id }),
    });
    setTransactions((ts) =>
      ts.map((t) => (t.id === id ? { ...t, isMatched: !matched } : t))
    );
    toast.success(matched ? "Unmatched" : "Matched");
  }

  const matched = transactions.filter((t) => t.isMatched);
  const unmatched = transactions.filter((t) => !t.isMatched);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Landmark className="h-6 w-6 text-brand-600" /> Bank Reconciliation
        </h1>
        <p className="text-sm text-slate-500">
          Import bank statement and match with recorded payments
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card card-padding card-hover">
          <div className="text-xs text-slate-500 uppercase font-semibold">Total Entries</div>
          <div className="text-2xl font-bold mt-2">{transactions.length}</div>
        </div>
        <div className="card card-padding card-hover">
          <div className="text-xs text-slate-500 uppercase font-semibold">Matched</div>
          <div className="text-2xl font-bold text-emerald-600 mt-2">{matched.length}</div>
        </div>
        <div className="card card-padding card-hover">
          <div className="text-xs text-slate-500 uppercase font-semibold">Unmatched</div>
          <div className="text-2xl font-bold text-rose-600 mt-2">{unmatched.length}</div>
        </div>
      </div>

      <form onSubmit={importCSV} className="card card-padding">
        <h2 className="font-semibold mb-2 flex items-center gap-2">
          <Upload className="h-4 w-4" /> Import bank statement (CSV)
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Format: date, description, reference, debit, credit, balance (with header row)
        </p>
        <textarea
          className="input font-mono text-xs"
          rows={5}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={"date,description,reference,debit,credit,balance\n01-04-2025,Opening Balance,,0,0,50000\n03-04-2025,Sharma Electronics,PMT-0001,0,15000,65000"}
        />
        <button className="btn-primary mt-3">
          <Upload className="h-4 w-4" /> Import
        </button>
      </form>

      <div className="card card-padding">
        <h2 className="font-semibold mb-3">Bank transactions ({transactions.length})</h2>
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Ref</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Credit</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-500">
                    Import a bank statement to begin reconciliation.
                  </td>
                </tr>
              ) : (
                transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="text-xs">{new Date(t.date).toLocaleDateString("en-IN")}</td>
                    <td>{t.description}</td>
                    <td className="text-xs">{t.reference || "—"}</td>
                    <td className="text-right">{t.debit > 0 ? formatINR(t.debit) : "—"}</td>
                    <td className="text-right">{t.credit > 0 ? formatINR(t.credit) : "—"}</td>
                    <td className="text-right font-medium">{formatINR(t.balance)}</td>
                    <td>
                      {t.isMatched ? (
                        <span className="badge-green"><CheckCircle className="h-3 w-3" /> Matched</span>
                      ) : (
                        <span className="badge-red"><XCircle className="h-3 w-3" /> Unmatched</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => toggleMatch(t.id, t.isMatched)}
                      >
                        {t.isMatched ? "Unmatch" : "Match"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
