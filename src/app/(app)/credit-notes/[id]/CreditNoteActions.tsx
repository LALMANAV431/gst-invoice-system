"use client";
import { Trash2, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function CreditNoteActions({ note }: { note: any }) {
  const router = useRouter();

  async function onDelete() {
    if (!confirm("Delete this note? Stock changes will be reversed.")) return;
    const res = await fetch(`/api/credit-notes/${note.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Deleted");
      router.push("/credit-notes");
      router.refresh();
    } else toast.error("Failed");
  }

  return (
    <div className="flex gap-2 items-center">
      <button className="btn-secondary" onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> Print
      </button>
      <button className="btn-ghost text-rose-600" onClick={onDelete}>
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
