import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import PaymentForm from "./PaymentForm";

export default async function NewPaymentPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const parties = await db.party.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { name: "asc" },
  });
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Record Payment</h1>
      <PaymentForm parties={parties} />
    </div>
  );
}
