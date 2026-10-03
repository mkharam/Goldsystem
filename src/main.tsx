import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerServiceWorker } from "./lib/pwa";
import { preconnectSupabase } from "./lib/supabase";
import "./index.css";
import "./lib/theme";

registerServiceWorker();
// فتح الاتصال بـ Supabase قبل أول طلب فعلي (تسجيل الدخول) — يُنهي TLS/DNS في
// الخلفية فلا ينتظرهما أول طلب بيانات، وهذا أهم ما يُشعَر به على اتصال ضعيف.
preconnectSupabase();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
