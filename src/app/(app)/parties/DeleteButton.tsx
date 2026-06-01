"use client";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  async function onDelete() {
    if (!confirm("Delete this party? This cannot be undone.")) return;
    const res = await fetch(`/api/parties/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Deleted");
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Failed");
    }
  }
  return (
    <button className="btn-ghost p-2 text-rose-600" onClick={onDelete} title="Delete">
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
