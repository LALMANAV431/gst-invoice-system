"use client";
import { Download } from "lucide-react";
import toast from "react-hot-toast";

export default function Gstr1Export({ data, period }: { data: unknown; period: string }) {
  function download() {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `GSTR1-${period}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("GSTR-1 JSON downloaded");
    } catch {
      toast.error("Export failed");
    }
  }
  return (
    <button className="btn-primary" onClick={download}>
      <Download className="h-4 w-4" /> Export GSTR-1 JSON
    </button>
  );
}
