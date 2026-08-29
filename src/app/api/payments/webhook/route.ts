import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  configuredGateway,
  InvalidSignatureError,
  parseWebhook,
} from "@/server/payments/gateway";
import { handleWebhookEvent } from "@/server/payments/link.service";

/**
 * Payment gateway webhook.
 *
 * PUBLICLY REACHABLE AND UNAUTHENTICATED — it has to be, because the gateway
 * calls it. Everything therefore rests on the HMAC signature, which is verified
 * against the RAW body before any parsing.
 *
 * RESPONSE CODES MATTER HERE more than usual, because they control retries:
 *   200 — processed, or a duplicate. Stop retrying.
 *   400 — bad signature or malformed. Retrying will not help.
 *   500 — our fault. Please retry.
 * Returning 500 for a bad signature would make a gateway retry a forged request
 * forever; returning 200 for a genuine failure would silently lose a payment.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const provider = configuredGateway();

  // The raw text is required: re-serialising parsed JSON changes key order and
  // whitespace, and the HMAC would never match.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Could not read the request body" }, { status: 400 });
  }

  if (!rawBody) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  let event;
  try {
    event = parseWebhook(rawBody, req.headers);
  } catch (e) {
    if (e instanceof InvalidSignatureError) {
      // Logged without the body: an unverified payload is attacker-controlled.
      console.warn(`[webhook] rejected ${provider} delivery: signature mismatch`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    console.warn(`[webhook] rejected ${provider} delivery: malformed payload`);
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  try {
    const result = await handleWebhookEvent(event, rawBody);

    if (!result.handled) {
      // A duplicate is a success from the gateway's point of view: it delivered,
      // we already have it, stop retrying.
      return NextResponse.json({
        ok: true,
        duplicate: true,
        previousStatus: result.previousStatus,
      });
    }

    return NextResponse.json({ ok: true, action: result.action });
  } catch (e) {
    // Record the failure so a lost payment is investigable, then ask for a retry.
    console.error("[webhook] processing failed:", e);
    try {
      await db.webhookEvent.create({
        data: {
          provider,
          eventId: `${event.eventId}:error:${Date.now()}`,
          eventType: event.eventType,
          status: "FAILED",
          payload: rawBody.slice(0, 20_000),
          error: e instanceof Error ? e.message : "unknown",
        },
      });
    } catch {
      // Nothing more we can do; the console entry above is the record.
    }
    return NextResponse.json({ error: "Processing failed, please retry" }, { status: 500 });
  }
}
