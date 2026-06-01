"use client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export function NewCompaniesChart({ data }: { data: { month: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "rgba(245,158,11,0.08)" }}
          contentStyle={{ borderRadius: 12, border: "1px solid #334155", background: "#0f172a", fontSize: 13, color: "#fff" }}
        />
        <Bar dataKey="count" name="New companies" radius={[6, 6, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill="#f59e0b" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RevenueByPlanChart({ data }: { data: { plan: string; revenue: number }[] }) {
  const colors: Record<string, string> = { Free: "#64748b", Basic: "#3b82f6", Premium: "#f59e0b" };
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
        <XAxis dataKey="plan" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : `${v}`)} />
        <Tooltip
          cursor={{ fill: "rgba(245,158,11,0.08)" }}
          formatter={(v: number) => `₹${v.toLocaleString("en-IN")}`}
          contentStyle={{ borderRadius: 12, border: "1px solid #334155", background: "#0f172a", fontSize: 13, color: "#fff" }}
        />
        <Bar dataKey="revenue" name="MRR" radius={[6, 6, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={colors[d.plan] || "#f59e0b"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
