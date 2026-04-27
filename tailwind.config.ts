import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ["var(--font-literata)", "Georgia", "serif"],
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        ink: "#0f1419",
        parchment: "#f4efe4",
        ember: "#c45c26",
        moss: "#2d5a4a",
        dusk: "#1a2433",
      },
    },
  },
  plugins: [],
} satisfies Config;
