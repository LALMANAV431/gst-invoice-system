import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { toPaise } from "@/lib/money";
import { createPaymentLink } from "@/server/payments/link.service";
import { configuredGateway, gatewayIsLive, GatewayError } from "@/server/payments/gateway";
import { ValidationError } from "@/server/services/invoice.service";
import { parsePagination, paginated } from "@/lib/pagination";

const createSchema = z.object({
  invoiceId: z.string().min(1, "Invoice is required"),
  /** Rupees. Defaults to the invoice's outstanding balance. */
  amount: z.union([z.string(), z.number()]).optional(),
  expiryDays: z.coerce.number().int().min(1).max(365).optional(),
});

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { skip, take, page, pageSize } = parsePagination(req);
  const where = { companyId: ctx.company.id };

  const [rows, total] = await Promise.all([
    db.paymentLink.findMany({
      where,
      include: {
        invoice: {
          select: {
            id: true,
            number: true,
            party: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.paymentLink.count({ where }),
  ]);

  return NextResponse.json({
    ...paginated(rows, total, page, pageSize),
    gateway: configuredGateway(),
    live: gatewayIsLive(),
  });
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const link = await createPaymentLink({
      companyId: ctx.company.id,
      invoiceId: parsed.data.invoiceId,
      amountPaise: parsed.data.amount === undefined ? undefined : toPaise(parsed.data.amount),
      expiryDays: parsed.data.expiryDays,
    });

    await logAudit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "PaymentLink",
      entityId: link.id,
      changes: { invoiceId: link.invoiceId, amountPaise: link.amountPaise },
    });

    const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
    return NextResponse.json({
      ...link,
      url: `${base}/pay/${link.token}`,
      gateway: configuredGateway(),
      // The UI must say so when no real gateway is configured, or a shopkeeper
      // could send a customer a link that cannot take money.
      live: gatewayIsLive(),
    });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof GatewayError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    console.error("[payment-links] create failed:", e);
    return NextResponse.json({ error: "Could not create the payment link" }, { status: 500 });
  }
}
