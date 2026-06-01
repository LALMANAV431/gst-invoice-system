import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { notFound } from "next/navigation";
import PartyForm from "../PartyForm";

export default async function EditPartyPage({ params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const party = await db.party.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
  });
  if (!party) notFound();

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Edit Party</h1>
      <PartyForm initial={party} />
    </div>
  );
}
