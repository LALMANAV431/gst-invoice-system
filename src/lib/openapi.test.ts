import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HTTP_METHODS,
  UNDOCUMENTED_ROUTES,
  documentedOperations,
  openApiDocument,
  type HttpMethod,
} from "./openapi";

/**
 * Keeps docs/openapi and the code in agreement.
 *
 * A hand-maintained API spec drifts, and a spec that lies is worse than none.
 * This walks the App Router directory, derives the real endpoint surface from the
 * files themselves, and fails if the spec and the code disagree in EITHER
 * direction:
 *
 *   - a route with no documentation  -> somebody shipped an undocumented endpoint
 *   - documentation with no route    -> the spec describes something imaginary
 *
 * So adding an endpoint without describing it breaks CI, which is the only
 * mechanism that actually keeps this kind of document current.
 */

const API_DIR = path.join(process.cwd(), "src", "app", "api");

interface RealRoute {
  /** OpenAPI-style path, e.g. /api/invoices/{id} */
  apiPath: string;
  file: string;
  methods: Set<HttpMethod>;
}

/** Recursively collect every route.ts under src/app/api. */
function collectRouteFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectRouteFiles(full, found);
    else if (entry.name === "route.ts" || entry.name === "route.tsx") found.push(full);
  }
  return found;
}

/**
 * Turn a file path into the URL it serves.
 * `src/app/api/invoices/[id]/route.ts` -> `/api/invoices/{id}`
 *
 * Route groups `(name)` are removed because they do not appear in the URL. If
 * catch-all segments are ever introduced they must be handled here rather than
 * silently mistranslated, hence the explicit failure.
 */
function fileToApiPath(file: string): string {
  const rel = path.relative(path.join(process.cwd(), "src", "app"), path.dirname(file));
  const segments = rel
    .split(path.sep)
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
    .map((s) => {
      if (s.startsWith("[[...") || s.startsWith("[...")) {
        throw new Error(
          `Catch-all route segment "${s}" is not handled by the OpenAPI sync test. ` +
            `Teach fileToApiPath() how to express it before shipping the route.`
        );
      }
      return s.startsWith("[") && s.endsWith("]") ? `{${s.slice(1, -1)}}` : s;
    });
  return "/" + segments.join("/");
}

/** Read the HTTP verbs a route file actually exports. */
function exportedMethods(file: string): Set<HttpMethod> {
  const source = fs.readFileSync(file, "utf8");
  const methods = new Set<HttpMethod>();
  for (const method of HTTP_METHODS) {
    const upper = method.toUpperCase();
    // `export async function GET(` or `export function GET(` or `export const GET =`
    const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${upper}\\b`);
    if (re.test(source)) methods.add(method);
  }
  return methods;
}

const realRoutes: RealRoute[] = collectRouteFiles(API_DIR)
  .map((file) => ({ apiPath: fileToApiPath(file), file, methods: exportedMethods(file) }))
  .sort((a, b) => a.apiPath.localeCompare(b.apiPath));

const documented = documentedOperations();

describe("route discovery", () => {
  it("finds the API directory and a plausible number of routes", () => {
    expect(fs.existsSync(API_DIR), `${API_DIR} should exist`).toBe(true);
    // Guards against the walker silently returning nothing and every other
    // assertion below passing vacuously.
    expect(realRoutes.length).toBeGreaterThan(50);
  });

  it("derives a path for every route file", () => {
    for (const route of realRoutes) {
      expect(route.apiPath, route.file).toMatch(/^\/api(\/|$)/);
    }
  });

  it("finds at least one exported HTTP method per route file", () => {
    const empty = realRoutes.filter((r) => r.methods.size === 0);
    expect(
      empty.map((r) => r.file),
      "a route.ts exporting no HTTP verb is dead code"
    ).toEqual([]);
  });
});

describe("every endpoint is documented", () => {
  it("has a spec entry, or an explicit reason for not having one", () => {
    const missing = realRoutes
      .filter((r) => !documented.has(r.apiPath) && !(r.apiPath in UNDOCUMENTED_ROUTES))
      .map((r) => r.apiPath);

    expect(
      missing,
      "These endpoints exist but are not in src/lib/openapi.ts. Document them, or add them " +
        "to UNDOCUMENTED_ROUTES with a reason."
    ).toEqual([]);
  });

  it("documents every HTTP method each route exports", () => {
    const gaps: string[] = [];
    for (const route of realRoutes) {
      if (route.apiPath in UNDOCUMENTED_ROUTES) continue;
      const spec = documented.get(route.apiPath);
      if (!spec) continue; // reported by the previous test
      for (const method of route.methods) {
        if (!spec.has(method)) gaps.push(`${method.toUpperCase()} ${route.apiPath}`);
      }
    }
    expect(gaps, "These methods are exported but not described").toEqual([]);
  });

  it("does not describe methods a route does not export", () => {
    const phantom: string[] = [];
    const byPath = new Map(realRoutes.map((r) => [r.apiPath, r]));
    for (const [apiPath, methods] of documented) {
      const route = byPath.get(apiPath);
      if (!route) continue; // reported below
      for (const method of methods) {
        if (!route.methods.has(method)) phantom.push(`${method.toUpperCase()} ${apiPath}`);
      }
    }
    expect(phantom, "The spec describes methods that no route implements").toEqual([]);
  });
});

describe("the spec describes nothing imaginary", () => {
  it("has a route file behind every documented path", () => {
    const real = new Set(realRoutes.map((r) => r.apiPath));
    // /api/openapi serves the document itself and is expected to exist.
    const phantom = [...documented.keys()].filter((p) => !real.has(p));
    expect(phantom, "Documented paths with no implementation").toEqual([]);
  });

  it("does not list a documented path as undocumented", () => {
    const contradictory = Object.keys(UNDOCUMENTED_ROUTES).filter((p) => documented.has(p));
    expect(contradictory, "A path cannot be both documented and excluded").toEqual([]);
  });

  it("gives a real reason for each exclusion", () => {
    for (const [route, reason] of Object.entries(UNDOCUMENTED_ROUTES)) {
      expect(reason.length, `${route} needs a proper reason`).toBeGreaterThan(30);
    }
  });

  it("only excludes routes that exist", () => {
    const real = new Set(realRoutes.map((r) => r.apiPath));
    const stale = Object.keys(UNDOCUMENTED_ROUTES).filter((p) => !real.has(p));
    expect(stale, "UNDOCUMENTED_ROUTES lists endpoints that no longer exist").toEqual([]);
  });
});

describe("spec quality", () => {
  const operations = Object.entries(openApiDocument.paths).flatMap(([apiPath, item]) =>
    HTTP_METHODS.filter((m) => (item as Record<string, unknown>)[m]).map((m) => ({
      id: `${m.toUpperCase()} ${apiPath}`,
      op: (item as Record<string, any>)[m],
    }))
  );

  it("gives every operation a summary and a tag", () => {
    for (const { id, op } of operations) {
      expect(op.summary?.length, `${id} needs a summary`).toBeGreaterThan(5);
      expect(op.tags?.length, `${id} needs a tag`).toBeGreaterThan(0);
    }
  });

  it("uses only tags declared at the top level", () => {
    const declared = new Set<string>(openApiDocument.tags.map((t) => t.name as string));
    for (const { id, op } of operations) {
      for (const tag of op.tags as string[]) {
        expect(declared.has(tag), `${id} uses undeclared tag "${tag}"`).toBe(true);
      }
    }
  });

  it("declares a success response for every operation", () => {
    for (const { id, op } of operations) {
      const codes = Object.keys(op.responses ?? {});
      expect(
        codes.some((c) => c.startsWith("2")),
        `${id} declares no 2xx response`
      ).toBe(true);
    }
  });

  it("declares 401 on everything except the deliberately public endpoints", () => {
    // These are reachable without a session by design: probes, the login flow,
    // and the gateway webhook whose authenticity comes from an HMAC signature.
    const PUBLIC = new Set([
      "GET /api/health",
      "GET /api/openapi",
      "POST /api/auth/login",
      "POST /api/auth/register",
      "POST /api/auth/logout",
      "POST /api/payments/webhook",
    ]);
    for (const { id, op } of operations) {
      if (PUBLIC.has(id)) {
        expect(op.security, `${id} is public and should declare empty security`).toEqual([]);
        continue;
      }
      const codes = Object.keys(op.responses ?? {});
      // Admin endpoints answer 403 to a signed-in non-admin; the rest 401.
      const guarded = codes.includes("401") || codes.includes("403");
      expect(guarded, `${id} declares neither 401 nor 403`).toBe(true);
    }
  });

  it("resolves every internal $ref", () => {
    const names = new Set(Object.keys(openApiDocument.components.schemas));
    const refs: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (key === "$ref" && typeof value === "string") refs.push(value);
        else walk(value);
      }
    };
    walk(openApiDocument);
    expect(refs.length, "the spec should actually reuse schemas").toBeGreaterThan(20);
    const broken = [...new Set(refs)].filter((r) => !names.has(r.replace("#/components/schemas/", "")));
    expect(broken, "dangling $ref").toEqual([]);
  });

  it("does not leave a schema defined but unused", () => {
    const refs = new Set<string>();
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (key === "$ref" && typeof value === "string") {
          refs.add(value.replace("#/components/schemas/", ""));
        } else walk(value);
      }
    };
    walk(openApiDocument.paths);
    walk(openApiDocument.components.schemas);
    const unused = Object.keys(openApiDocument.components.schemas).filter((n) => !refs.has(n));
    expect(unused, "unreferenced schemas are dead weight").toEqual([]);
  });

  it("is a valid-looking OpenAPI 3.1 document", () => {
    expect(openApiDocument.openapi).toBe("3.1.0");
    expect(openApiDocument.info.title).toBeTruthy();
    expect(openApiDocument.info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(openApiDocument.components.securitySchemes.sessionCookie).toBeTruthy();
    expect(Object.keys(openApiDocument.paths).length).toBeGreaterThan(50);
  });

  it("serialises to JSON without cycles", () => {
    // The document is served over HTTP and written to docs/openapi.json.
    expect(() => JSON.stringify(openApiDocument)).not.toThrow();
  });
});

describe("money and unit conventions are stated", () => {
  it("explains the paise convention in the description", () => {
    expect(openApiDocument.info.description).toMatch(/integer paise/i);
  });

  it("documents Paise as an integer, not a decimal", () => {
    const paise = openApiDocument.components.schemas.Paise as Record<string, unknown>;
    expect(paise.type).toBe("integer");
  });

  it("documents Quantity as a number, because trade units are fractional", () => {
    const qty = openApiDocument.components.schemas.Quantity as Record<string, unknown>;
    expect(qty.type).toBe("number");
  });
});
