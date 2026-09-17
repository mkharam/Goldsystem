import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // مستخرجة من شعار "مخرّم": أخضر زمردي عميق وذهب معدني.
        // الأخضر هوية وأسطح، والذهب للفعل والإبراز — كما في الشعار نفسه.
        brand: {
          50: "#eef7f2",
          100: "#d3e8dd",
          200: "#9bc8b1",
          300: "#5aa384",
          400: "#2d7d5c",
          500: "#1a5b41",
          600: "#134531", // متوسط أخضر الشعار
          700: "#0f3a29",
          800: "#0c2e20",
          900: "#0a2318",
          950: "#06150f",
        },
        gold: {
          50: "#fbf5e8",
          100: "#f5e9cf",
          200: "#ecd4a3",
          300: "#e1bb76", // أفتح ذهب في الشعار
          400: "#d9b66a",
          500: "#c9a24a",
          600: "#af8d51", // متوسط ذهب الشعار
          700: "#a87d28",
          800: "#8a661c",
          900: "#6b4e15",
        },
      },
      fontFamily: {
        sans: ["Cairo", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
