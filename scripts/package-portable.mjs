/**
 * Assembles a ready-to-copy "GSTBooks-Portable" folder that runs from a USB
 * pendrive using only a portable Node.js runtime (no install).
 *
 * Usage:
 *   npm run build          # produces .next/standalone
 *   node scripts/package-portable.mjs
 *
 * Then copy the generated GSTBooks-Portable folder onto your pendrive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const out = path.join(root, "GSTBooks-Portable");
const appDir = path.join(out, "app");

function log(msg) {
  console.log(`  • ${msg}`);
}

function copy(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

// 1. Pre-flight: standalone build must exist
const standalone = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("\n[!] .next/standalone/server.js not found. Run `npm run build` first.\n");
  process.exit(1);
}

console.log("\nPackaging GST Books portable edition...\n");

// 2. Clean output
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });

// 3. Copy the standalone server (+ traced node_modules)
copy(standalone, appDir);
log("Copied standalone server");

// 4. Static assets and public folder (standalone does NOT include these)
copy(path.join(root, ".next", "static"), path.join(appDir, ".next", "static"));
copy(path.join(root, "public"), path.join(appDir, "public"));
log("Copied static + public assets");

// 5. Prisma: schema + ALL engines (incl. Windows) + a seed DB template
const prismaClientSrc = path.join(root, "node_modules", ".prisma", "client");
const prismaClientDest = path.join(appDir, "node_modules", ".prisma", "client");
copy(prismaClientSrc, prismaClientDest);
copy(path.join(root, "prisma", "schema.prisma"), path.join(appDir, "prisma", "schema.prisma"));
const seedDbSrc = path.join(root, "prisma", "dev.db");
if (fs.existsSync(seedDbSrc)) {
  copy(seedDbSrc, path.join(appDir, "prisma", "seed.db"));
  log("Bundled seed database template");
} else {
  log("WARNING: prisma/dev.db not found - run `npm run db:setup` to create a seed DB");
}
log("Bundled Prisma engines (Windows + Linux)");

// 6. Launcher scripts + README
const portableSrc = path.join(root, "scripts", "portable");
copy(path.join(portableSrc, "START-GST-Books.bat"), path.join(out, "START-GST-Books.bat"));
copy(path.join(portableSrc, "start-mac-linux.sh"), path.join(out, "start-mac-linux.sh"));
copy(path.join(portableSrc, "README.txt"), path.join(out, "README.txt"));
try {
  fs.chmodSync(path.join(out, "start-mac-linux.sh"), 0o755);
} catch {}
log("Added launchers + README");

// 7. Empty node/ folder with a hint
fs.mkdirSync(path.join(out, "node"), { recursive: true });
fs.writeFileSync(
  path.join(out, "node", "PUT-PORTABLE-NODE-HERE.txt"),
  "Download portable Node.js from https://nodejs.org/en/download\n" +
    "Unzip and place node.exe here so this path exists: node\\node.exe\n"
);

console.log("\n[OK] Portable package ready at: GSTBooks-Portable/");
console.log("     Copy that folder onto your USB pendrive.\n");
