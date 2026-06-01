/**
 * Export data as CSV file download (browser-side)
 */
export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => {
        const s = String(cell).replace(/"/g, '""');
        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
      }).join(",")
    ),
  ].join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Open WhatsApp share with a message
 */
export function shareWhatsApp(message: string, phone?: string) {
  const encoded = encodeURIComponent(message);
  const url = phone
    ? `https://wa.me/${phone.replace(/\D/g, "")}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
  window.open(url, "_blank");
}

/**
 * Open email compose with invoice details
 */
export function shareEmail(opts: { to?: string; subject: string; body: string }) {
  const params = new URLSearchParams();
  if (opts.to) params.set("to", opts.to);
  params.set("subject", opts.subject);
  params.set("body", opts.body);
  window.open(`mailto:${opts.to || ""}?${params.toString()}`, "_blank");
}
