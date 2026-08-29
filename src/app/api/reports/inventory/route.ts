import { NextResponse } from "next/server";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { financialYearRange } from "@/server/numbering";
import {
  InventoryError,
  expiryReport,
  itemStockLedger,
  stockSummary,
  valuationPolicy,
} from "@/server/services/inventory.service";

/**
 * Inventory reports, all derived from the stock movement ledger.
 *
 *   ?view=valuation  closing stock and COGS per item (default)
 *   ?view=ageing     how long the stock on hand has been sitting
 *   ?view=dead       items holding stock that has not moved
 *   ?view=expiry     batches at or near their expiry date
 *   ?view=ledger     full movement history for one item (&itemId=)
 *
 * Nothing here is stored: every figure is recomputed from the movements, so a
 * report can never disagree with the transactions behind it.
 */
export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const companyId = ctx.company.id;

  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") ?? "valuation";
  const asOf = parseDate(searchParams.get("asOf")) ?? new Date();
  const godownId = searchParams.get("godownId") ?? undefined;

  // COGS defaults to the current financial year: a lifetime COGS figure is not
  // what anybody means by cost of goods sold.
  const from = parseDate(searchParams.get("from")) ?? financialYearRange(asOf).start;

  try {
    if (view === "ledger") {
      const itemId = searchParams.get("itemId");
      if (!itemId) {
        return NextResponse.json({ error: "itemId is required for the ledger view" }, { status: 400 });
      }
      const ledger = await itemStockLedger(companyId, itemId, { asOf });
      return NextResponse.json({
        view: "ledger",
        method: ledger.method,
        item: {
          id: ledger.item.id,
          name: ledger.item.name,
          sku: ledger.item.sku,
          unit: ledger.item.unit,
        },
        rows: ledger.rows,
        ageing: ledger.ageing,
        closing: {
          quantity: ledger.valuation.closingQuantity,
          valuePaise: ledger.valuation.closingValuePaise,
          ratePaise: ledger.valuation.closingRatePaise,
        },
        cogsPaise: ledger.valuation.cogsPaise,
        negativeStockQuantity: ledger.valuation.negativeStockQuantity,
      });
    }

    if (view === "expiry") {
      const report = await expiryReport(companyId, {
        asOf,
        includeOk: searchParams.get("includeOk") === "true",
      });
      return NextResponse.json({ view: "expiry", ...report });
    }

    const summary = await stockSummary(companyId, { asOf, from, godownId });
    const policy = await valuationPolicy(companyId);

    if (view === "ageing") {
      return NextResponse.json({
        view: "ageing",
        asOf,
        method: summary.method,
        buckets: summary.ageing,
        // Per item as well, because the company total tells you there is old
        // stock but not which stock to act on.
        items: summary.items
          .filter((i) => i.quantity !== 0)
          .map((i) => ({
            itemId: i.itemId,
            name: i.name,
            unit: i.unit,
            quantity: i.quantity,
            valuePaise: i.valuePaise,
            idleDays: i.idleDays,
            lastOutDate: i.lastOutDate,
          })),
      });
    }

    if (view === "dead") {
      const dead = summary.items.filter((i) => i.isDeadStock);
      return NextResponse.json({
        view: "dead",
        asOf,
        thresholdDays: policy.deadStockDays,
        method: summary.method,
        totalValuePaise: dead.reduce((s, i) => s + i.valuePaise, 0),
        items: dead
          .sort((a, b) => b.valuePaise - a.valuePaise)
          .map((i) => ({
            itemId: i.itemId,
            name: i.name,
            sku: i.sku,
            unit: i.unit,
            quantity: i.quantity,
            valuePaise: i.valuePaise,
            idleDays: i.idleDays,
            neverSold: i.neverSold,
            lastOutDate: i.lastOutDate,
          })),
      });
    }

    return NextResponse.json({
      view: "valuation",
      asOf,
      cogsFrom: from,
      method: summary.method,
      methodLabel: summary.method === "FIFO" ? "First in, first out" : "Weighted average",
      totals: summary.totals,
      flags: summary.flags,
      ageing: summary.ageing,
      items: summary.items.map((i) => ({
        itemId: i.itemId,
        name: i.name,
        sku: i.sku,
        hsn: i.hsn,
        unit: i.unit,
        quantity: i.quantity,
        ratePaise: i.ratePaise,
        valuePaise: i.valuePaise,
        cogsPaise: i.cogsPaise,
        salePricePaise: i.salePricePaise,
        realisableValuePaise: i.realisableValuePaise,
        belowCost: i.belowCost,
        negativeStockQuantity: i.negativeStockQuantity,
        ledgerDriftQuantity: i.ledgerDriftQuantity,
        isLowStock: i.isLowStock,
        isDeadStock: i.isDeadStock,
        idleDays: i.idleDays,
        lastInDate: i.lastInDate,
        lastOutDate: i.lastOutDate,
      })),
    });
  } catch (e) {
    if (e instanceof InventoryError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    throw e;
  }
}

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
