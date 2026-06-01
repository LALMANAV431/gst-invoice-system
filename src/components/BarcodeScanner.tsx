"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Camera } from "lucide-react";

const REGION_ID = "barcode-scan-region";

export default function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const scannerRef = useRef<any>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode(REGION_ID, { verbose: false } as any);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 160 } },
          (decodedText: string) => {
            onScan(decodedText);
          },
          () => {
            /* ignore per-frame decode errors */
          }
        );
      } catch (e: any) {
        setError(
          "Camera access failed. Allow camera permission, or type the barcode manually below."
        );
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        s.stop()
          .then(() => s.clear())
          .catch(() => {});
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card card-padding w-full max-w-md"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Camera className="h-4 w-4 text-brand-600" /> Scan barcode
          </h3>
          <button className="btn-ghost p-2" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          id={REGION_ID}
          className="rounded-xl overflow-hidden bg-black aspect-video w-full"
        />

        {error ? (
          <p className="mt-3 text-sm text-rose-600">{error}</p>
        ) : (
          <p className="mt-3 text-xs text-slate-500 text-center">
            Point the camera at the product barcode
          </p>
        )}

        <ManualEntry onSubmit={onScan} />
      </motion.div>
    </div>
  );
}

function ManualEntry({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) onSubmit(code.trim());
        setCode("");
      }}
      className="mt-3 flex gap-2"
    >
      <input
        className="input"
        placeholder="Or enter barcode manually"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <button className="btn-secondary">Add</button>
    </form>
  );
}
