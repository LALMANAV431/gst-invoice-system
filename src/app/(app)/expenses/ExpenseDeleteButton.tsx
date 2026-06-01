"use client";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function ExpenseDeleteButton({ id }: { id: string }) {
  const router = useRouter();
  async function onDelete() {
    if (!confirm("Delete this expense?")) return;
    const res = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Deleted");
      router.refresh();
    } else toast.error("Failed");
  }
  return (
    <button className="btn-ghost p-2 text-rose-600" onClick={onDelete}>
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
