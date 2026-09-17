import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ذهبي/أخضر — الذهبي للهوية والأفعال الأساسية، الأخضر للنجاح والتأكيد.
        gold: {
          50: "#fbf7ed",
          100: "#f5ebd2",
          200: "#ead4a2",
          300: "#deb96c",
          400: "#d4a144",
          500: "#c8912f",
          600: "#a97325",
          700: "#875620",
          800: "#714721",
          900: "#613c20",
        },
        brand: {
          50: "#eefbf3",
          100: "#d6f5e2",
          200: "#b0e9c9",
          300: "#7dd7a9",
          400: "#46bd84",
          500: "#22a268",
          600: "#158253",
          700: "#116844",
          800: "#105237",
          900: "#0e442f",
        },
      },
      fontFamily: {
        sans: ["var(--font-arabic)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
