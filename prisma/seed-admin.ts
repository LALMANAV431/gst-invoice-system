/**
 * Create a platform super-admin, explicitly.
 *
 * WHY THIS IS SEPARATE
 * --------------------
 * `prisma/seed.ts` used to create demo@gst.com / demo1234 with
 * `isSuperAdmin: true`. Those credentials are published in the README, so any
 * public deployment that ran the seed handed a stranger full platform control:
 * every tenant's data, plan changes, and user impersonation.
 *
 * Promoting an account to super-admin is now a deliberate act that requires a
 * password you choose.
 *
 * Usage:
 *   npm run db:seed:admin -- --email you@example.com --password '<strong-password>'
 *
 * If the email already exists the account is promoted in place; its password is
 * only changed when --password is supplied.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
}

/**
 * Reject passwords that would undermine the point of this script. A super-admin
 * credential protects every tenant's financial records.
 */
function validatePassword(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push("must be at least 12 characters");
  if (!/[a-z]/.test(password)) problems.push("must contain a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("must contain an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("must contain a digit");

  const weak = ["password", "admin", "demo", "1234", "qwerty", "gstbooks", "letmein"];
  if (weak.some((w) => password.toLowerCase().includes(w))) {
    problems.push("must not contain an obvious word like 'password', 'admin' or 'demo'");
  }
  return problems;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const password = arg("password");
  const name = arg("name") ?? "Platform Admin";

  if (!email) {
    console.error(
      "Missing --email.\n" +
        "Usage: npm run db:seed:admin -- --email you@example.com --password '<strong-password>'"
    );
    process.exit(1);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`"${email}" is not a valid email address.`);
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    const data: { isSuperAdmin: boolean; password?: string } = { isSuperAdmin: true };

    if (password) {
      const problems = validatePassword(password);
      if (problems.length) {
        console.error(`Password rejected: it ${problems.join(", ")}.`);
        process.exit(1);
      }
      data.password = await bcrypt.hash(password, 10);
    }

    await prisma.user.update({ where: { email }, data });
    console.log(`Promoted existing user ${email} to platform super-admin.`);
    if (!password) console.log("Password unchanged (no --password supplied).");
    return;
  }

  if (!password) {
    console.error(
      `No user exists with ${email}, so --password is required to create one.\n` +
        "Usage: npm run db:seed:admin -- --email you@example.com --password '<strong-password>'"
    );
    process.exit(1);
  }

  const problems = validatePassword(password);
  if (problems.length) {
    console.error(`Password rejected: it ${problems.join(", ")}.`);
    process.exit(1);
  }

  await prisma.user.create({
    data: {
      email,
      name,
      password: await bcrypt.hash(password, 10),
      isSuperAdmin: true,
    },
  });

  console.log(`Created platform super-admin ${email}.`);
  console.log("Sign in, then visit /admin.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
