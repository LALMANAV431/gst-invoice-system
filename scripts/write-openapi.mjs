/**
 * Write docs/openapi.json from src/lib/openapi.ts.
 *
 * The TypeScript module is the source of truth (it is typechecked and kept in
 * sync with the routes by src/lib/openapi.test.ts). This produces a plain JSON
 * file for tooling that wants one: Swagger UI, Postman, client generators.
 *
 *   npm run docs:openapi
 *
 * CI runs it with --check, which fails if the committed file is stale, so the
 * JSON can never silently fall behind the module.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "docs", "openapi.json");
const check = process.argv.includes("--check");

// The spec module imports from "@/lib/...", which Node cannot resolve, so run it
// through tsx the same way the seed does.
const { openApiDocument } = await import("../src/lib/openapi.ts");

const json = JSON.stringify(openApiDocument, null, 2) + "\n";

if (check) {
  if (!existsSync(OUT)) {
    console.error(`docs/openapi.json is missing. Run: npm run docs:openapi`);
    process.exit(1);
  }
  const current = readFileSync(OUT, "utf8");
  if (current !== json) {
    console.error(
      "docs/openapi.json is out of date with src/lib/openapi.ts.\n" +
        "Run: npm run docs:openapi   and commit the result."
    );
    process.exit(1);
  }
  console.log("docs/openapi.json is up to date.");
} else {
  writeFileSync(OUT, json);
  const operations = Object.values(openApiDocument.paths).reduce(
    (n, item) => n + Object.keys(item).length,
    0
  );
  console.log(
    `Wrote docs/openapi.json — ${Object.keys(openApiDocument.paths).length} paths, ` +
      `${operations} operations, ${Object.keys(openApiDocument.components.schemas).length} schemas.`
  );
}
