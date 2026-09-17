import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  // على GitHub Pages يُقدَّم الموقع من /Goldsystem/ لا من الجذر، فتُبنى مسارات
  // الأصول على هذا الأساس. أي استضافة أخرى (تشغيل محلي، نطاق خاص) تقدّم من
  // الجذر، فالافتراضي "/".
  base: process.env.GH_PAGES_BASE || "/",
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: { host: "::", port: 8080 },
});
