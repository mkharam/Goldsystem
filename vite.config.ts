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
  build: {
    rollupOptions: {
      output: {
        // React/Router يتغيّران بندرة؛ Supabase أكثر تحديثاً من تبعية التطبيق نفسها.
        // فصلهما في حزم خاصة يجعل المتصفح يُبقي عليهما من الذاكرة المؤقتة بعد كل
        // تحديث للتطبيق، بدل إعادة تنزيل نفس مكتبات React مع كل نشر جديد.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
        },
      },
    },
  },
});
