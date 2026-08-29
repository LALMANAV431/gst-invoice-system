import { NextResponse } from "next/server";
import { openApiDocument } from "@/lib/openapi";

/**
 * Serve the OpenAPI description of this API.
 *
 * Public and unauthenticated: it describes the shape of the API, not any
 * tenant's data. Being reachable without a session is what lets Swagger UI,
 * Postman and client generators point straight at a deployment.
 *
 * The document is a static object, so this is cheap and cacheable.
 */
export async function GET() {
  return NextResponse.json(openApiDocument, {
    headers: {
      // Safe to cache: it only changes when the application is redeployed.
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
