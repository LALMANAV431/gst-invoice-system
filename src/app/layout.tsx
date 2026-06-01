import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import PwaSetup from "@/components/PwaSetup";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GST Books — Accounting & Invoicing SaaS",
  description: "Modern GST invoicing, inventory and accounting like Tally / Busy.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "GST Books" },
};

export const viewport: Viewport = {
  themeColor: "#1f3df5",
};

// Applies saved theme before paint to avoid flash of wrong theme
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans">
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              borderRadius: "12px",
              background: "#0f172a",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 500,
            },
          }}
        />
        {children}
        <PwaSetup />
      </body>
    </html>
  );
}
