import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate, numberToWords } from "./utils";
import { formatPaise, toRupees } from "./money";

export function generateInvoicePDF(invoice: any, company: any) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(company.name, 14, 18);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  let y = 24;
  if (company.gstin) {
    doc.text(`GSTIN: ${company.gstin}`, 14, y);
    y += 4;
  }
  const addr = [company.addressLine1, company.city, company.state, company.pincode]
    .filter(Boolean)
    .join(", ");
  if (addr) {
    doc.text(addr, 14, y);
    y += 4;
  }
  if (company.phone) {
    doc.text(`Phone: ${company.phone}`, 14, y);
    y += 4;
  }

  // Title
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(31, 61, 245);
  doc.text("TAX INVOICE", pageWidth - 14, 18, { align: "right" });
  doc.setTextColor(0, 0, 0);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Invoice #: ${invoice.number}`, pageWidth - 14, 24, { align: "right" });
  doc.text(`Date: ${formatDate(invoice.date)}`, pageWidth - 14, 29, { align: "right" });
  if (invoice.dueDate) {
    doc.text(`Due: ${formatDate(invoice.dueDate)}`, pageWidth - 14, 34, { align: "right" });
  }

  // Bill To
  y = Math.max(y, 40) + 4;
  doc.setFont("helvetica", "bold");
  doc.text("Bill To", 14, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.text(invoice.party.name, 14, y);
  y += 4;
  if (invoice.party.gstin) {
    doc.text(`GSTIN: ${invoice.party.gstin}`, 14, y);
    y += 4;
  }
  const partyAddr = [
    invoice.party.addressLine1,
    invoice.party.city,
    invoice.party.state,
    invoice.party.pincode,
  ]
    .filter(Boolean)
    .join(", ");
  if (partyAddr) {
    doc.text(partyAddr, 14, y);
    y += 4;
  }
  if (invoice.party.phone) {
    doc.text(`Phone: ${invoice.party.phone}`, 14, y);
    y += 4;
  }
  y += 2;

  // Items table
  autoTable(doc, {
    startY: y,
    head: [
      [
        "#",
        "Item",
        "HSN",
        "Qty",
        "Rate",
        "Taxable",
        "GST%",
        invoice.isInterState ? "IGST" : "CGST+SGST",
        "Total",
      ],
    ],
    body: invoice.items.map((it: any, i: number) => [
      i + 1,
      it.itemName,
      it.hsn || "-",
      `${it.quantity} ${it.unit}`,
      formatPaise(it.ratePaise),
      formatPaise(it.taxablePaise),
      `${it.gstRate}%`,
      formatPaise(it.cgstPaise + it.sgstPaise + it.igstPaise),
      formatPaise(it.totalPaise),
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [31, 61, 245] },
    columnStyles: {
      0: { cellWidth: 8 },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
    },
  });

  let endY = (doc as any).lastAutoTable.finalY + 5;

  // Totals
  const totalsX = pageWidth - 80;
  const valX = pageWidth - 14;
  doc.setFontSize(10);
  doc.text("Subtotal", totalsX, endY);
  doc.text(formatPaise(invoice.subTotalPaise), valX, endY, { align: "right" });
  endY += 5;

  if (invoice.isInterState) {
    doc.text("IGST", totalsX, endY);
    doc.text(formatPaise(invoice.igstTotalPaise), valX, endY, { align: "right" });
    endY += 5;
  } else {
    doc.text("CGST", totalsX, endY);
    doc.text(formatPaise(invoice.cgstTotalPaise), valX, endY, { align: "right" });
    endY += 5;
    doc.text("SGST", totalsX, endY);
    doc.text(formatPaise(invoice.sgstTotalPaise), valX, endY, { align: "right" });
    endY += 5;
  }
  if (invoice.discountPaise > 0) {
    doc.text("Discount", totalsX, endY);
    doc.text(`- ${formatPaise(invoice.discountPaise)}`, valX, endY, { align: "right" });
    endY += 5;
  }
  if (invoice.roundOffPaise) {
    doc.text("Round off", totalsX, endY);
    doc.text(formatPaise(invoice.roundOffPaise), valX, endY, { align: "right" });
    endY += 5;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Grand Total", totalsX, endY + 2);
  doc.text(formatPaise(invoice.grandTotalPaise), valX, endY + 2, { align: "right" });
  doc.setFont("helvetica", "normal");

  // Words
  doc.setFontSize(9);
  endY += 12;
  // numberToWords expects RUPEES. Passing paise here printed a total 100x too
  // large in words while the figures above were correct - on a legal document.
  const words = numberToWords(toRupees(invoice.grandTotalPaise));
  doc.text(`In words: ${words}`, 14, endY, { maxWidth: pageWidth - 28 });
  endY += 8;

  if (invoice.notes) {
    doc.setFont("helvetica", "bold");
    doc.text("Notes:", 14, endY);
    doc.setFont("helvetica", "normal");
    doc.text(invoice.notes, 14, endY + 4, { maxWidth: pageWidth - 28 });
  }

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    "This is a computer-generated invoice.",
    pageWidth / 2,
    doc.internal.pageSize.getHeight() - 10,
    { align: "center" }
  );

  doc.save(`${invoice.number}.pdf`);
}
