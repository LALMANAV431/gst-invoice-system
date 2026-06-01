"use client";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { formatINR } from "@/lib/utils";

const BRAND = "#1f3df5";

export function RevenueAreaChart({
  data,
}: {
  data: { month: string; sales: number; purchases: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.35} />
            <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="purchaseFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : `${v}`)}
        />
        <Tooltip
          formatter={(v: number) => formatINR(v)}
          contentStyle={{
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
            fontSize: 13,
          }}
        />
        <Area
          type="monotone"
          dataKey="sales"
          name="Sales"
          stroke={BRAND}
          strokeWidth={2.5}
          fill="url(#salesFill)"
          animationDuration={1100}
        />
        <Area
          type="monotone"
          dataKey="purchases"
          name="Purchases"
          stroke="#f43f5e"
          strokeWidth={2}
          fill="url(#purchaseFill)"
          animationDuration={1300}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const DONUT_COLORS = ["#1f3df5", "#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b"];

export function CategoryDonut({ data }: { data: { name: string; value: number }[] }) {
  if (!data.length) {
    return (
      <div className="h-[260px] flex items-center justify-center text-sm text-slate-400">
        No data yet
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={3}
          animationDuration={1000}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} stroke="none" />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: number) => formatINR(v)}
          contentStyle={{
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            fontSize: 13,
          }}
        />
        <Legend
          iconType="circle"
          wrapperStyle={{ fontSize: 12 }}
          formatter={(value) => <span className="text-slate-600">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
