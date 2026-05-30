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
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "gradient-pan": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        shimmer: "shimmer 2.4s linear infinite",
        "slide-up": "slide-up 360ms cubic-bezier(0.22,1,0.36,1)",
        "scale-in": "scale-in 220ms cubic-bezier(0.22,1,0.36,1)",
        "fade-in": "fade-in 240ms ease-out",
        "gradient-pan": "gradient-pan 14s ease-in-out infinite",
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        "out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
