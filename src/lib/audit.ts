import { db } from "./db";

export async function logAudit(opts: {
  companyId: string;
  userId: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  entity: string;
  entityId: string;
  changes?: Record<string, unknown> | null;
}) {
  try {
    await db.auditLog.create({
      data: {
        companyId: opts.companyId,
        userId: opts.userId,
        action: opts.action,
        entity: opts.entity,
        entityId: opts.entityId,
        changes: opts.changes ? JSON.stringify(opts.changes) : null,
      },
    });
  } catch (e) {
    // non-blocking
    console.error("Audit log failed:", e);
  }
}
