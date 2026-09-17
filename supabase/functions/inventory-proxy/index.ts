// وسيط المخزون: يحمل مفتاح المخزون بدل المتصفح.
//
// التطبيق صار يعمل في المتصفح، وأي مفتاح فيه مكشوف للجميع. فيمرّ كل استدعاء
// للمخزون من هنا: نتحقق أولاً أن المتصل موظف فعّال في قاعدة الصيانة، ثم نضيف
// المفتاح ونمرّر الطلب. المفتاح لا يغادر الخادم.
//
// المسارات المسموحة محصورة في قائمة صريحة — لا نمرّر أي مسار يطلبه المتصفح،
// وإلا صار الوسيط باباً مفتوحاً على كامل واجهة المخزون.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** ما يُسمح بتمريره، وبأي طريقة. */
const ALLOWED: Record<string, "GET" | "POST"> = {
  "branches": "GET",
  "customers/lookup": "GET",
  "customers": "POST",
  "items/lookup": "GET",
  "items/status": "POST",
  "health": "GET",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const INVENTORY_URL = Deno.env.get("INVENTORY_API_URL");
  const INVENTORY_KEY = Deno.env.get("INVENTORY_API_KEY");
  if (!INVENTORY_URL || !INVENTORY_KEY) return json({ error: "inventory_not_configured" }, 503);

  // ——— لا يمرّ إلا موظف فعّال ———
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);

  const { data: staff } = await admin
    .from("staff")
    .select("id, is_active")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  // حساب Auth بلا صف موظف فعّال لا يكفي — نفس شرط سياسات RLS.
  if (!staff || !staff.is_active) return json({ error: "forbidden" }, 403);

  // ——— التمرير ———
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/+/, "").split("/").slice(1).join("/").replace(/\/+$/, "");

  const expectedMethod = ALLOWED[route];
  if (!expectedMethod || expectedMethod !== req.method) return json({ error: "not_allowed", route }, 404);

  const target = `${INVENTORY_URL.replace(/\/+$/, "")}/${route}${url.search}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const upstream = await fetch(target, {
      method: req.method,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-api-key": INVENTORY_KEY },
      body: req.method === "POST" ? await req.text() : undefined,
    });
    clearTimeout(timer);

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    // انقطاع المخزون ليس خطأ في التطبيق — الواجهة تتحوّل للإدخال اليدوي.
    return json({ error: "inventory_unavailable" }, 502);
  }
});
