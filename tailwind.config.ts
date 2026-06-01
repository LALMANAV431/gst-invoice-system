import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dae6ff",
          200: "#bccfff",
          300: "#8eaeff",
          400: "#5a82ff",
          500: "#355bff",
          600: "#1f3df5",
          700: "#1a2fd9",
          800: "#1c2bae",
          900: "#1d2a89",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 40px -10px rgba(31, 61, 245, 0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
