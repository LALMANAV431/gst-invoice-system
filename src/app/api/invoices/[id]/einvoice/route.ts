import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { hasFeature, planActive } from "@/lib/plan";

/**
 * Generate an E-Invoice IRN (Invoice Reference Number).
 *
 * NOTE: This is a functional simulation. In production this endpoint would
 * call the NIC / GSP e-invoice API (with GSP credentials) which returns the
 * signed IRN, AckNo, AckDate and a signed QR payload. Here we generate a
 * deterministic 64-char IRN + QR data so the full flow (store, display,
 * print on invoice) works end-to-end.
 */
function makeIRN(seed: string): string {
  // 64 hex chars derived from a simple hash of the seed
  let h1 = 0x811c9dc5;
  let out = "";
  for (let i = 0; i < 64; i++) {
    h1 ^= seed.charCodeAt((i * 7 + 3) % seed.length) || i;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    out += (h1 & 0xf).toString(16);
  }
  return out;
}

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasFeature(planActive(ctx.company.plan, ctx.company.planExpiry), "e_invoice"))
    return NextResponse.json(
      { error: "E-Invoice (IRN) requires the Premium plan. Please upgrade.", code: "PLAN_LIMIT", upgrade: true },
      { status: 402 }
    );

  const invoice = await db.invoice.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
    include: { party: true },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.irn) return NextResponse.json({ error: "IRN already generated" }, { status: 400 });
  if (!ctx.company.gstin)
    return NextResponse.json({ error: "Add your company GSTIN in Settings first" }, { status: 400 });

  const irn = makeIRN(`${ctx.company.gstin}-${invoice.number}-${invoice.grandTotalPaise}`);
  const ackNo = String(Math.floor(1e14 + Math.random() * 9e14)); // 15-digit ack no
  const ackDate = new Date();

  // Signed QR payload (simplified GSTN format)
  const qrData = JSON.stringify({
    SellerGstin: ctx.company.gstin,
    BuyerGstin: invoice.party.gstin || "URP",
    DocNo: invoice.number,
    DocTyp: "INV",
    DocDt: new Date(invoice.date).toLocaleDateString("en-GB"),
    TotInvVal: invoice.grandTotalPaise,
    ItemCnt: undefined,
    MainHsnCode: undefined,
    Irn: irn,
    IrnDt: ackDate.toISOString().slice(0, 10),
  });

  const updated = await db.invoice.update({
    where: { id: invoice.id },
    data: { irn, ackNo, ackDate, qrData },
  });

  return NextResponse.json({
    ok: true,
    irn: updated.irn,
    ackNo: updated.ackNo,
    ackDate: updated.ackDate,
    qrData: updated.qrData,
  });
}
