import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { notFound } from "next/navigation";
import ItemForm from "../ItemForm";

export default async function EditItemPage({ params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const item = await db.item.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
  });
  if (!item) notFound();
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Edit Item</h1>
      <ItemForm initial={item} />
    </div>
  );
}
