/**
 * Payment links, and the webhook handling that settles them.
 *
 * When a customer pays a link, the money must land in the books exactly once:
 * a Payment row, an updated invoice status, and a balanced ledger posting. The
 * two hazards are duplicate webhook deliveries and partial settlements, and both
 * are handled explicitly below.
 */

import { db } from "@/lib/db";
import {
  configuredGateway,
  createGatewayOrder,
  generateLinkToken,
  GatewayError,
  type VerifiedEvent,
} from "./gateway";
import { allocateDocumentNumber } from "../numbering";
import {
  ensureChartOfAccounts,
  ensurePartyLedger,
  postJournalEntry,
} from "../ledger";
import { buildPaymentPosting, LEDGER } from "@/lib/accounting";
import { refreshInvoiceStatus, ValidationError } from "../services/invoice.service";

const DEFAULT_EXPIRY_DAYS = 30;

export async function createPaymentLink(opts: {
  companyId: string;
  invoiceId: string;
  /** Defaults to the invoice's outstanding balance. */
  amountPaise?: number;
  expiryDays?: number;
}) {
  const invoice = await db.invoice.findFirst({
    where: { id: opts.invoiceId, companyId: opts.companyId },
    select: {
      id: true,
      number: true,
      status: true,
      grandTotalPaise: true,
      amountPaidPaise: true,
      party: { select: { name: true } },
    },
  });
  if (!invoice) throw new ValidationError("Invoice not found");
  if (invoice.status === "CANCELLED") {
    throw new ValidationError("This invoice is cancelled.");
  }

  const outstanding = invoice.grandTotalPaise - invoice.amountPaidPaise;
  if (outstanding <= 0) {
    throw new ValidationError("This invoice is already fully paid.");
  }

  const amountPaise = opts.amountPaise ?? outstanding;
  if (amountPaise <= 0) throw new ValidationError("Amount must be greater than zero");
  if (amountPaise > outstanding) {
    // Collecting more than is owed would leave the party ledger with an
    // unexplained credit.
    throw new ValidationError(
      `The outstanding amount on ${invoice.number} is less than the amount requested.`
    );
  }

  // Reuse an open link for the same amount instead of creating a second one, so
  // a customer cannot be sent two live links and pay both.
  const existing = await db.paymentLink.findFirst({
    where: {
      companyId: opts.companyId,
      invoiceId: invoice.id,
      status: "PENDING",
      amountPaise,
    },
  });
  if (existing) return existing;

  const token = generateLinkToken();
  const gateway = configuredGateway();

  let providerOrderId: string | null = null;
  try {
    const order = await createGatewayOrder({
      amountPaise,
      referenceId: token,
      description: `Invoice ${invoice.number} — ${invoice.party.name}`,
    });
    providerOrderId = order.providerOrderId;
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    throw new GatewayError("Could not create the payment order.");
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (opts.expiryDays ?? DEFAULT_EXPIRY_DAYS));

  return db.paymentLink.create({
    data: {
      companyId: opts.companyId,
      invoiceId: invoice.id,
      token,
      amountPaise,
      provider: gateway,
      providerOrderId,
      expiresAt,
    },
  });
}

export type WebhookOutcome =
  | { handled: true; action: "PAID"; paymentNumber: string; linkId: string }
  | { handled: true; action: "FAILED" | "REFUNDED" | "IGNORED"; reason: string }
  | { handled: false; reason: "DUPLICATE"; previousStatus: string };

/**
 * Process a verified webhook event.
 *
 * IDEMPOTENCY: the `WebhookEvent` row is inserted FIRST, inside the same
 * transaction as the settlement. Its unique (provider, eventId) constraint means a
 * duplicate delivery fails the insert and the whole transaction rolls back, so the
 * payment cannot be recorded twice. Checking-then-inserting would leave a race
 * between two concurrent deliveries of the same event.
 */
export async function handleWebhookEvent(
  event: VerifiedEvent,
  rawPayload: string
): Promise<WebhookOutcome> {
  const provider = configuredGateway();

  // Fast path for an already-seen event, so retries are cheap and observable.
  const seen = await db.webhookEvent.findUnique({
    where: { provider_eventId: { provider, eventId: event.eventId } },
    select: { status: true },
  });
  if (seen) {
    return { handled: false, reason: "DUPLICATE", previousStatus: seen.status };
  }

  if (event.outcome !== "PAID") {
    // Still recorded, so a failed or refunded event is not re-processed and is
    // visible when investigating a dispute.
    await recordEvent(provider, event, rawPayload, "IGNORED");

    if (event.outcome === "FAILED" && event.referenceId) {
      await db.paymentLink
        .updateMany({
          where: { token: event.referenceId, status: "PENDING" },
          data: { providerPaymentId: event.providerPaymentId },
        })
        .catch(() => undefined);
    }

    return {
      handled: true,
      action: event.outcome === "OTHER" ? "IGNORED" : event.outcome,
      reason: `Event ${event.eventType} recorded without settlement.`,
    };
  }

  if (!event.referenceId) {
    await recordEvent(provider, event, rawPayload, "FAILED", "No reference id on the event");
    return { handled: true, action: "IGNORED", reason: "Event carried no reference id." };
  }

  const link = await db.paymentLink.findUnique({
    where: { token: event.referenceId },
    include: {
      invoice: { select: { id: true, number: true, companyId: true, partyId: true } },
      company: {
        select: { id: true, paymentPrefix: true, journalPrefix: true },
      },
    },
  });

  if (!link) {
    await recordEvent(provider, event, rawPayload, "FAILED", "Unknown payment link");
    return { handled: true, action: "IGNORED", reason: "No payment link matched." };
  }

  if (link.status === "PAID") {
    await recordEvent(provider, event, rawPayload, "IGNORED", "Link already paid");
    return { handled: false, reason: "DUPLICATE", previousStatus: "PAID" };
  }

  // Trust the gateway's amount when it sends one: it is what actually settled.
  // A partial settlement must not be recorded as full payment.
  const settledPaise = event.amountPaise ?? link.amountPaise;

  const party = await db.party.findUnique({
    where: { id: link.invoice.partyId },
    select: { id: true, name: true, type: true, balanceType: true },
  });
  if (!party) {
    await recordEvent(provider, event, rawPayload, "FAILED", "Party missing");
    return { handled: true, action: "IGNORED", reason: "Invoice party not found." };
  }

  const paymentNumber = await db.$transaction(async (tx) => {
    // Insert the event FIRST. A concurrent duplicate delivery violates the
    // unique constraint here and rolls the whole settlement back.
    await tx.webhookEvent.create({
      data: {
        provider,
        eventId: event.eventId,
        eventType: event.eventType,
        status: "PROCESSED",
        payload: rawPayload.slice(0, 20_000),
      },
    });

    const { number } = await allocateDocumentNumber(tx, {
      companyId: link.companyId,
      documentType: "PAYMENT",
      prefix: link.company.paymentPrefix,
      date: new Date(),
    });

    const payment = await tx.payment.create({
      data: {
        companyId: link.companyId,
        partyId: party.id,
        invoiceId: link.invoiceId,
        number,
        type: "RECEIVED",
        // Online collection lands in the bank, not the cash box.
        mode: "BANK",
        amountPaise: settledPaise,
        date: new Date(),
        reference: event.providerPaymentId,
        notes: `Online payment via ${provider} (link ${link.token.slice(0, 8)}…)`,
      },
    });

    await refreshInvoiceStatus(tx, link.invoiceId);

    await ensureChartOfAccounts(tx, link.companyId);
    const partyLedger = await ensurePartyLedger(tx, link.companyId, party);

    await postJournalEntry(tx, {
      companyId: link.companyId,
      userId: "system:webhook",
      posting: buildPaymentPosting({
        partyLedger: partyLedger.name,
        cashOrBankLedger: LEDGER.BANK,
        date: new Date(),
        number,
        paymentId: payment.id,
        amountPaise: settledPaise,
        type: "RECEIVED",
      }),
      voucherNo: number,
      journalPrefix: link.company.journalPrefix,
    });

    await tx.paymentLink.update({
      where: { id: link.id },
      data: {
        // Only PAID when the full amount settled; otherwise the link stays open
        // for the balance.
        status: settledPaise >= link.amountPaise ? "PAID" : "PENDING",
        paidPaise: settledPaise,
        paidAt: new Date(),
        providerPaymentId: event.providerPaymentId,
        paymentId: payment.id,
      },
    });

    return number;
  });

  return { handled: true, action: "PAID", paymentNumber, linkId: link.id };
}

async function recordEvent(
  provider: string,
  event: VerifiedEvent,
  rawPayload: string,
  status: string,
  error?: string
): Promise<void> {
  try {
    await db.webhookEvent.create({
      data: {
        provider,
        eventId: event.eventId,
        eventType: event.eventType,
        status,
        payload: rawPayload.slice(0, 20_000),
        error: error ?? null,
      },
    });
  } catch {
    // A duplicate here is the expected outcome of a retry, not a problem.
  }
}

/** Public view of a link, for the customer-facing pay page. */
export async function getPublicPaymentLink(token: string) {
  const link = await db.paymentLink.findUnique({
    where: { token },
    select: {
      id: true,
      token: true,
      status: true,
      amountPaise: true,
      paidPaise: true,
      provider: true,
      providerOrderId: true,
      expiresAt: true,
      invoice: {
        select: {
          number: true,
          date: true,
          grandTotalPaise: true,
        },
      },
      company: {
        select: { name: true, gstin: true, upiId: true },
      },
    },
  });

  if (!link) return null;

  const expired =
    link.status === "PENDING" && link.expiresAt !== null && link.expiresAt < new Date();

  return {
    ...link,
    // Computed rather than stored, so a link expires without needing a cron job.
    status: expired ? "EXPIRED" : link.status,
  };
}
