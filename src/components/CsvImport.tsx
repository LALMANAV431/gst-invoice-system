"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Papa from "papaparse";
import { Upload, Loader2 } from "lucide-react";

export default function CsvImport({
  endpoint,
  label = "Import CSV",
  sampleHeaders,
}: {
  endpoint: string;
  label?: string;
  sampleHeaders: string[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  function pick() {
    inputRef.current?.click();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        const rows = (result.data as any[]).filter((r) => Object.keys(r).length > 0);
        if (rows.length === 0) {
          toast.error("CSV is empty");
          setLoading(false);
          return;
        }
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        });
        setLoading(false);
        if (inputRef.current) inputRef.current.value = "";
        if (res.ok) {
          const j = await res.json();
          toast.success(`Imported ${j.created} · skipped ${j.skipped}`);
          if (j.errors?.length) toast.error(j.errors[0]);
          router.refresh();
        } else {
          const j = await res.json().catch(() => ({}));
          toast.error(j.error || "Import failed");
        }
      },
      error: () => {
        setLoading(false);
        toast.error("Could not read CSV");
      },
    });
  }

  function downloadSample() {
    const csv = sampleHeaders.join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="file" accept=".csv" onChange={onFile} className="hidden" />
      <button className="btn-secondary" onClick={pick} disabled={loading} title="Upload a CSV file">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {label}
      </button>
      <button
        className="btn-ghost text-xs"
        onClick={downloadSample}
        title="Download a sample CSV template"
      >
        Sample
      </button>
    </div>
  );
}
