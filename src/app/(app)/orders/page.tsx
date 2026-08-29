import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatPaise } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/utils";
import { getTranslator, normaliseLocale } from "@/lib/i18n";
import { DOC_CONFIG, getGoodsReceivedNotInvoiced, type OrderDocType } from "@/server/services/order.service";
import { ClipboardList, Truck, ShoppingBag, PackageCheck, Plus, AlertTriangle } from "lucide-react";
import OrderActions from "./OrderActions";

export const dynamic = "force-dynamic";

const TABS: { docType: OrderDocType; icon: typeof ClipboardList }[] = [
  { docType: "SALES_ORDER", icon: ClipboardList },
  { docType: "DELIVERY_CHALLAN", icon: Truck },
  { docType: "PURCHASE_ORDER", icon: ShoppingBag },
  { docType: "GRN", icon: PackageCheck },
];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { docType?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const companyId = ctx.company.id;
  const { t } = getTranslator(normaliseLocale(ctx.user.locale));

  const active = (TABS.find((x) => x.docType === searchParams.docType)?.docType ??
    "SALES_ORDER") as OrderDocType;
  const config = DOC_CONFIG[active];

  const [documents, counts, grni] = await Promise.all([
    db.orderDocument.findMany({
      where: { companyId, docType: active },
      include: {
        party: { select: { id: true, name: true } },
        items: { select: { quantity: true, fulfilledQuantity: true } },
      },
      orderBy: { date: "desc" },
      take: 100,
    }),
    db.orderDocument.groupBy({
      by: ["docType"],
      where: { companyId, status: { not: "CANCELLED" }, convertedToId: null },
      _count: true,
    }),
    // Only relevant on the GRN tab, but cheap and it drives the warning banner.
    getGoodsReceivedNotInvoiced(companyId),
  ]);

  const pendingByType = new Map(counts.map((c) => [c.docType, c._count]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Orders &amp; Goods Movement</h1>
          <p className="text-sm text-slate-500">
            Commitments and stock movements. The ledger entry happens when these become an
            invoice or a purchase.
          </p>
        </div>
        <Link href={`/orders/new?docType=${active}`} className="btn-primary">
          <Plus className="h-4 w-4" /> New {config.label}
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const cfg = DOC_CONFIG[tab.docType];
          const pending = pendingByType.get(tab.docType) ?? 0;
          const isActive = tab.docType === active;
          return (
            <Link
              key={tab.docType}
              href={`/orders?docType=${tab.docType}`}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium ring-1 ring-inset transition-colors ${
                isActive
                  ? "bg-brand-600 text-white ring-brand-600"
                  : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {cfg.label}
              {pending > 0 && (
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    isActive ? "bg-white/20" : "bg-slate-100 dark:bg-slate-800"
                  }`}
                >
                  {pending}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/*
        With periodic inventory a GRN raises stock without creating a payable, so
        an un-invoiced GRN is a genuine reconciliation item, not a bug. Saying so
        is the difference between a known gap and a silent one.
      */}
      {active === "GRN" && grni.count > 0 && (
        <div className="card card-padding flex items-start gap-3 border-amber-300 bg-amber-50 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-amber-900">
            <div className="font-semibold">
              {grni.count} goods receipt{grni.count === 1 ? "" : "s"} not yet invoiced —{" "}
              {formatPaise(grni.totalPaise)}
            </div>
            <div className="text-xs text-amber-800">
              You hold these goods but have not recorded a payable for them. Convert each GRN
              once the supplier&apos;s bill arrives so the books match the stock.
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t("label.date")}</th>
              <th>{t("doc.number")}</th>
              <th>{config.partyType === "VENDOR" ? t("label.supplier") : t("label.customer")}</th>
              {config.needsTransport && <th>Vehicle</th>}
              <th className="text-right">Fulfilled</th>
              <th className="text-right">{t("label.total")}</th>
              <th>{t("label.status")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr>
                <td colSpan={config.needsTransport ? 8 : 7} className="py-10 text-center">
                  <div className="text-slate-500">No {config.label.toLowerCase()}s yet.</div>
                  <Link
                    href={`/orders/new?docType=${active}`}
                    className="mt-2 inline-flex text-sm text-brand-600 hover:underline"
                  >
                    Create the first one
                  </Link>
                </td>
              </tr>
            ) : (
              documents.map((d) => {
                const ordered = d.items.reduce((s, i) => s + i.quantity, 0);
                const done = d.items.reduce((s, i) => s + i.fulfilledQuantity, 0);
                const percent = ordered > 0 ? Math.round((done / ordered) * 100) : 0;
                return (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap">{formatDate(d.date)}</td>
                    <td className="whitespace-nowrap font-medium">{d.number}</td>
                    <td>{d.party.name}</td>
                    {config.needsTransport && (
                      <td className="text-xs text-slate-500">
                        {d.vehicleNumber || d.transporterName || "—"}
                      </td>
                    )}
                    <td className="text-right text-xs">
                      {config.stockEffect === "NONE"
                        ? `${formatNumber(done, 0)} / ${formatNumber(ordered, 0)} (${percent}%)`
                        : "—"}
                    </td>
                    <td className="text-right font-medium">{formatPaise(d.grandTotalPaise)}</td>
                    <td>
                      <StatusBadge status={d.status} converted={!!d.convertedToId} />
                    </td>
                    <td className="text-right">
                      <OrderActions
                        id={d.id}
                        number={d.number}
                        label={config.label}
                        convertsTo={config.convertsTo}
                        alreadyConverted={!!d.convertedToId}
                        cancelled={d.status === "CANCELLED"}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status, converted }: { status: string; converted: boolean }) {
  if (converted) return <span className="badge-emerald">Converted</span>;
  switch (status) {
    case "CANCELLED":
      return <span className="badge-rose">Cancelled</span>;
    case "COMPLETED":
      return <span className="badge-emerald">Completed</span>;
    case "PARTIAL":
      return <span className="badge-amber">Partial</span>;
    default:
      return <span className="badge-slate">Open</span>;
  }
}
