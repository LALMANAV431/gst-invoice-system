"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function UpiQr({
  upiId,
  payeeName,
  amount,
  note,
}: {
  upiId: string;
  payeeName: string;
  amount: number;
  note?: string;
}) {
  const [dataUrl, setDataUrl] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams({
      pa: upiId,
      pn: payeeName,
      am: amount.toFixed(2),
      cu: "INR",
    });
    if (note) params.set("tn", note);
    const intent = `upi://pay?${params.toString()}`;
    QRCode.toDataURL(intent, { width: 220, margin: 1, errorCorrectionLevel: "M" })
      .then(setDataUrl)
      .catch(() => setDataUrl(""));
  }, [upiId, payeeName, amount, note]);

  if (!dataUrl) return null;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dataUrl} alt="UPI QR code" className="h-28 w-28 rounded-lg bg-white p-1" />
      <div className="text-sm">
        <p className="font-semibold">Scan to pay via UPI</p>
        <p className="text-slate-500 dark:text-slate-400 mt-0.5">{upiId}</p>
        <p className="text-slate-500 dark:text-slate-400">
          Any UPI app · GPay, PhonePe, Paytm
        </p>
        <p className="mt-1 font-medium">₹{amount.toFixed(2)}</p>
      </div>
    </div>
  );
}
