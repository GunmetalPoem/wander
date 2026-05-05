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
        /** Momo Trust Display — page titles, hero lines, quest headers */
        serif: ['"Momo Trust Display"', "ui-sans-serif", "sans-serif"],
        /** SUSE — body copy, labels, controls */
        sans: ['"SUSE"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        ink: "#030306",
        parchment: "#e8e8ec",
        moss: "#2d5a4a",
        /** Legacy token — deep blue-gray; prefer void/coal for new UI */
        dusk: "#0a0a0f",
        /** Near-black surfaces */
        void: "#030303",
        coal: "#0a0a0c",
        mist: "#9a9aa3",
        /** Accent for chat / active states (reference: subtle neon on dark). */
        wander: {
          DEFAULT: "#34d399",
          muted: "rgba(52, 211, 153, 0.12)",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
