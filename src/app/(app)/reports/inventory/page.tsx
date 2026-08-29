import Link from "next/link";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatPaise } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/utils";
import { getTranslator, normaliseLocale } from "@/lib/i18n";
import { financialYearRange } from "@/server/numbering";
import { expiryReport, stockSummary, valuationPolicy } from "@/server/services/inventory.service";
import { AlertTriangle, ArrowLeft, Package } from "lucide-react";

export const dynamic = "force-dynamic";

type View = "valuation" | "ageing" | "dead" | "expiry";

const EXPIRY_LABEL_KEYS = {
  EXPIRED: "inv.expired",
  EXPIRING_30: "inv.expiring30",
  EXPIRING_90: "inv.expiring90",
  OK: "inv.ok",
  NO_EXPIRY: "inv.noExpiry",
} as const;

/**
 * Inventory reports.
 *
 * Every figure here is recomputed from the stock movement ledger on each
 * request, so a report can never disagree with the transactions behind it.
 */
export default async function InventoryReportPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const { t } = getTranslator(normaliseLocale(ctx.user.locale));
  const companyId = ctx.company.id;

  const view: View = (["valuation", "ageing", "dead", "expiry"] as const).includes(
    searchParams.view as View
  )
    ? (searchParams.view as View)
    : "valuation";

  const asOf = new Date();
  const fy = financialYearRange(asOf);
  const policy = await valuationPolicy(companyId);
  const summary = await stockSummary(companyId, { asOf, from: fy.start });
  const expiry = view === "expiry" ? await expiryReport(companyId, { asOf }) : null;

  const tabs: { key: View; label: string }[] = [
    { key: "valuation", label: t("inv.valuation") },
    { key: "ageing", label: t("inv.ageing") },
    { key: "dead", label: t("inv.deadStock") },
    { key: "expiry", label: t("inv.expiry") },
  ];

  const withStock = summary.items.filter((i) => i.quantity !== 0 || i.valuePaise !== 0);
  const deadItems = summary.items
    .filter((i) => i.isDeadStock)
    .sort((a, b) => b.valuePaise - a.valuePaise);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="btn-ghost p-2">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6 text-brand-600" /> {t("inv.title")}
          </h1>
          <p className="text-sm text-slate-500">{t("inv.subtitle")}</p>
        </div>
      </div>

      {/* Headline figures. The method is stated on screen because the same stock
          is worth a different amount under FIFO and weighted average, and a
          number without its basis is not an answer. */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={t("inv.closingValue")} value={formatPaise(summary.totals.valuePaise)} />
        <Stat
          label={`${t("inv.cogs")} (${fy.label})`}
          value={formatPaise(summary.totals.cogsPaise)}
        />
        <Stat
          label={t("inv.method")}
          value={summary.method === "FIFO" ? t("inv.fifo") : t("inv.weightedAverage")}
          small
        />
        <Stat label={t("inv.item")} value={String(summary.totals.itemCount)} />
      </div>

      {/* Things that need a human decision, surfaced rather than buried. */}
      {(summary.flags.negativeStockItems > 0 ||
        summary.flags.belowCostItems > 0 ||
        summary.flags.driftItems > 0) && (
        <div className="card card-padding border-amber-200 bg-amber-50 space-y-2">
          {summary.flags.negativeStockItems > 0 && (
            <Flag
              title={`${t("inv.negativeStock")} — ${summary.flags.negativeStockItems}`}
              detail={t("inv.negativeStockHint")}
            />
          )}
          {summary.flags.belowCostItems > 0 && (
            <Flag
              title={`${t("inv.belowCost")} — ${summary.flags.belowCostItems}`}
              detail={t("inv.belowCostHint")}
            />
          )}
          {summary.flags.driftItems > 0 && (
            <Flag
              title={`${t("inv.drift")} — ${summary.flags.driftItems}`}
              detail={t("inv.driftHint")}
            />
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/reports/inventory?view=${tab.key}`}
            className={view === tab.key ? "btn-primary" : "btn-ghost"}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {view === "valuation" && (
        <div className="card card-padding overflow-x-auto">
          {withStock.length === 0 ? (
            <p className="text-sm text-slate-500">{t("inv.noStock")}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("inv.item")}</th>
                  <th className="text-right">{t("inv.quantity")}</th>
                  <th className="text-right">{t("inv.rate")}</th>
                  <th className="text-right">{t("inv.value")}</th>
                  <th className="text-right">{t("inv.realisable")}</th>
                  <th className="text-right">{t("inv.cogs")}</th>
                </tr>
              </thead>
              <tbody>
                {withStock.map((i) => (
                  <tr key={i.itemId}>
                    <td>
                      <Link
                        href={`/items?highlight=${i.itemId}`}
                        className="hover:text-brand-600"
                      >
                        {i.name}
                      </Link>
                      {i.belowCost && (
                        <span className="ml-2 badge bg-amber-100 text-amber-700">
                          {t("inv.belowCost")}
                        </span>
                      )}
                      {i.negativeStockQuantity > 0 && (
                        <span className="ml-2 badge bg-rose-100 text-rose-700">
                          {t("inv.negativeStock")}
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      {formatNumber(i.quantity, 2)} {i.unit}
                    </td>
                    <td className="text-right">{formatPaise(i.ratePaise)}</td>
                    <td className="text-right font-medium">{formatPaise(i.valuePaise)}</td>
                    <td className="text-right text-slate-500">
                      {formatPaise(i.realisableValuePaise)}
                    </td>
                    <td className="text-right text-slate-500">{formatPaise(i.cogsPaise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold border-t-2">
                  <td>Total</td>
                  <td />
                  <td />
                  <td className="text-right">{formatPaise(summary.totals.valuePaise)}</td>
                  <td className="text-right">
                    {formatPaise(summary.totals.realisableValuePaise)}
                  </td>
                  <td className="text-right">{formatPaise(summary.totals.cogsPaise)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {view === "ageing" && (
        <div className="space-y-4">
          <div className="card card-padding overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("inv.ageing")}</th>
                  <th className="text-right">{t("inv.quantity")}</th>
                  <th className="text-right">{t("inv.value")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.ageing.map((b) => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td className="text-right">{formatNumber(b.quantity, 2)}</td>
                    <td className="text-right">{formatPaise(b.valuePaise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold border-t-2">
                  <td>Total</td>
                  <td className="text-right">
                    {formatNumber(
                      summary.ageing.reduce((s, b) => s + b.quantity, 0),
                      2
                    )}
                  </td>
                  <td className="text-right">
                    {formatPaise(summary.ageing.reduce((s, b) => s + b.valuePaise, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
            {/* Ageing reads receipt lots, which exist under FIFO. Say so, rather
                than letting a weighted-average user wonder where it came from. */}
            {summary.method !== "FIFO" && (
              <p className="text-xs text-slate-500 mt-3">
                Ages are taken from receipt lots (FIFO order). Your valuation method is weighted
                average, so the values above are the lot costs behind the same closing quantity.
              </p>
            )}
          </div>

          <div className="card card-padding overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("inv.item")}</th>
                  <th className="text-right">{t("inv.quantity")}</th>
                  <th className="text-right">{t("inv.value")}</th>
                  <th className="text-right">{t("inv.idleDays")}</th>
                </tr>
              </thead>
              <tbody>
                {withStock.map((i) => (
                  <tr key={i.itemId}>
                    <td>{i.name}</td>
                    <td className="text-right">
                      {formatNumber(i.quantity, 2)} {i.unit}
                    </td>
                    <td className="text-right">{formatPaise(i.valuePaise)}</td>
                    <td className="text-right">{i.idleDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "dead" && (
        <div className="card card-padding overflow-x-auto">
          <p className="text-sm text-slate-500 mb-3">
            Items holding stock with no issue for {policy.deadStockDays} days.
          </p>
          {deadItems.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing is sitting idle. </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("inv.item")}</th>
                  <th className="text-right">{t("inv.quantity")}</th>
                  <th className="text-right">{t("inv.value")}</th>
                  <th className="text-right">{t("inv.idleDays")}</th>
                  <th>{t("inv.lastSold")}</th>
                </tr>
              </thead>
              <tbody>
                {deadItems.map((i) => (
                  <tr key={i.itemId}>
                    <td>{i.name}</td>
                    <td className="text-right">
                      {formatNumber(i.quantity, 2)} {i.unit}
                    </td>
                    <td className="text-right font-medium">{formatPaise(i.valuePaise)}</td>
                    <td className="text-right">{i.idleDays}</td>
                    <td>
                      {i.neverSold ? (
                        <span className="badge bg-slate-100 text-slate-600">
                          {t("inv.neverSold")}
                        </span>
                      ) : (
                        formatDate(i.lastOutDate!)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold border-t-2">
                  <td colSpan={2}>Total tied up</td>
                  <td className="text-right">
                    {formatPaise(deadItems.reduce((s, i) => s + i.valuePaise, 0))}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {view === "expiry" && expiry && (
        <div className="card card-padding overflow-x-auto">
          {expiry.rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              No batch is expired or nearing expiry. Batch-tracked items only.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("inv.item")}</th>
                  <th>{t("inv.batch")}</th>
                  <th>{t("inv.expiryDate")}</th>
                  <th className="text-right">{t("inv.daysToExpiry")}</th>
                  <th className="text-right">{t("inv.quantity")}</th>
                  <th className="text-right">{t("inv.value")}</th>
                  <th>{t("count.status")}</th>
                </tr>
              </thead>
              <tbody>
                {expiry.rows.map((b) => (
                  <tr key={b.batchId}>
                    <td>{b.itemName}</td>
                    <td className="font-mono text-xs">{b.batchNo}</td>
                    <td>{b.expiryDate ? formatDate(b.expiryDate) : "—"}</td>
                    <td className="text-right">{b.daysToExpiry ?? "—"}</td>
                    <td className="text-right">
                      {formatNumber(b.quantity, 2)} {b.unit}
                    </td>
                    <td className="text-right">{formatPaise(b.valuePaise)}</td>
                    <td>
                      <span
                        className={`badge ${
                          b.status === "EXPIRED"
                            ? "bg-rose-100 text-rose-700"
                            : b.status === "EXPIRING_30"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {t(EXPIRY_LABEL_KEYS[b.status])}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold border-t-2">
                  <td colSpan={5}>Value at risk (expired + expiring)</td>
                  <td className="text-right">
                    {formatPaise(
                      expiry.totals.EXPIRED + expiry.totals.EXPIRING_30 + expiry.totals.EXPIRING_90
                    )}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="card card-padding">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={small ? "text-sm font-semibold mt-1" : "text-xl font-bold mt-1"}>{value}</p>
    </div>
  );
}

function Flag({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex gap-2 items-start">
      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-medium text-amber-900">{title}</p>
        <p className="text-xs text-amber-800">{detail}</p>
      </div>
    </div>
  );
}
