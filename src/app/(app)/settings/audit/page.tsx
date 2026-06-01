import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;

  const logs = await db.auditLog.findMany({
    where: { companyId: ctx.company.id },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div>
        <Link href="/settings" className="btn-ghost text-sm -ml-2 mb-1">
          <ArrowLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="h-6 w-6 text-brand-600" /> Audit Trail
        </h1>
        <p className="text-sm text-slate-500">Every action on your data is logged here</p>
      </div>

      <div className="card card-padding">
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Entity ID</th>
                <th>Changes</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-500">
                    No audit logs yet. Actions will be recorded as you use the system.
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id}>
                    <td className="text-xs whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString("en-IN")}
                    </td>
                    <td>
                      <div className="text-sm font-medium">{l.user.name}</div>
                      <div className="text-xs text-slate-400">{l.user.email}</div>
                    </td>
                    <td>
                      <span
                        className={
                          l.action === "CREATE"
                            ? "badge-green"
                            : l.action === "DELETE"
                            ? "badge-red"
                            : "badge-amber"
                        }
                      >
                        {l.action}
                      </span>
                    </td>
                    <td className="font-medium">{l.entity}</td>
                    <td className="text-xs font-mono">{l.entityId.slice(0, 10)}...</td>
                    <td className="text-xs max-w-[200px] truncate" title={l.changes || ""}>
                      {l.changes ? "View" : "—"}
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
