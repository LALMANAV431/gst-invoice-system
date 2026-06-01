/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produces a self-contained server in .next/standalone so the app can run
  // from a USB pendrive with only a portable Node.js runtime (no install).
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"],
  },
};

module.exports = nextConfig;
