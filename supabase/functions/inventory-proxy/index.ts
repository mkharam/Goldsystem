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
    .select("id, is_active, role")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  // حساب Auth بلا صف موظف فعّال لا يكفي — نفس شرط سياسات RLS.
  if (!staff || !staff.is_active) return json({ error: "forbidden" }, 403);

  // ——— التمرير ———
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/+/, "").split("/").slice(1).join("/").replace(/\/+$/, "");

  // ——— دفع التذاكر إلى المخزون (صفحة «الصيانة» عند المدير) ———
  // المتصفح يرسل معرّفات فقط؛ نقرأ نحن التذاكر من قاعدتنا ونبني الحمولة، فلا يستطيع
  // موظف أن يدفع بيانات ملفّقة إلى المخزون. `all` للمدير فقط (مزامنة شاملة).
  if (route === "repairs/sync") {
    if (req.method !== "POST") return json({ error: "not_allowed", route }, 404);
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.ticket_ids) ? body.ticket_ids.filter((x: unknown) => typeof x === "string").slice(0, 100) : [];
    if (body?.all === true && staff.role !== "admin") return json({ error: "forbidden" }, 403);
    if (!body?.all && ids.length === 0) return json({ error: "no_tickets" }, 400);

    let q = admin
      .from("repair_tickets")
      .select(`*,
        customer:customers!repair_tickets_customer_id_fkey (full_name, phone, inventory_customer_id),
        branch:branches!repair_tickets_branch_id_fkey (inventory_branch_id),
        received_by_staff:staff!repair_tickets_received_by_fkey (full_name, inventory_staff_id),
        assigned_to_staff:staff!repair_tickets_assigned_to_fkey (full_name, inventory_staff_id)`)
      .order("received_at", { ascending: false });
    q = body?.all === true ? q.limit(500) : q.in("id", ids);
    const { data: rows, error } = await q;
    if (error) return json({ error: "read_failed" }, 500);

    const tickets = (rows ?? []).map((t: any) => ({
      id: t.id,
      ticket_number: t.ticket_number,
      branch_id: t.branch?.inventory_branch_id ?? null,
      customer_id: t.customer?.inventory_customer_id ?? null,
      customer_name: t.customer?.full_name ?? null,
      customer_phone: t.customer?.phone ?? null,
      received_by: t.received_by_staff?.inventory_staff_id ?? null,
      received_by_name: t.received_by_staff?.full_name ?? null,
      assigned_to: t.assigned_to_staff?.inventory_staff_id ?? null,
      assigned_to_name: t.assigned_to_staff?.full_name ?? null,
      product_id: t.inventory_product_id,
      item_code: t.item_code,
      item_name: t.item_name,
      item_type: t.item_type,
      karat: t.karat,
      weight_in_grams: t.weight_in_grams,
      weight_out_grams: t.weight_out_grams,
      problem_description: t.problem_description,
      work_done: t.work_done,
      estimated_cost: t.estimated_cost,
      final_cost: t.final_cost,
      status: t.status,
      received_at: t.received_at,
      promised_at: t.promised_at,
      ready_at: t.ready_at,
      delivered_at: t.delivered_at,
      cancelled_at: t.cancelled_at,
    }));
    if (tickets.length === 0) return json({ ok: true, synced: 0 });

    try {
      const upstream = await fetch(`${INVENTORY_URL.replace(/\/+$/, "")}/repairs/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": INVENTORY_KEY },
        body: JSON.stringify({ tickets }),
      });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch {
      return json({ error: "inventory_unavailable" }, 502);
    }
  }

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
